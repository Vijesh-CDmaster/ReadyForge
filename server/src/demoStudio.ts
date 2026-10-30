import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { HydratedDocument, Types } from 'mongoose';
import { config } from './config';
import { User, IUser } from './models/User';
import { Workspace } from './models/Workspace';
import { Project, IProject } from './models/Project';
import { ProjectMember } from './models/ProjectMember';
import { KnowledgeInput, IKnowledgeInput, InputType, SourceType } from './models/KnowledgeInput';
import { Conflict } from './models/Conflict';
import { Asset, IAsset } from './models/Asset';
import { ProductionContract, IProductionContract } from './models/ProductionContract';
import { EditComposition, ICompositionClip, ICompositionTrack } from './models/EditComposition';
import { computeReadiness } from './engines/readiness';
import { probeMediaFile } from './services/ffmpegTools';

/**
 * Idempotent Studio Demo seed.
 *
 * Creates a self-contained, render-authorized production project using the
 * real models and the real readiness engine. It never inserts a render task or
 * output asset; the operator renders through the normal UI/worker path.
 *
 * Development only: the caller must be a development/test environment.
 */

export const STUDIO_DEMO = {
  workspaceName: 'ReadyForge Studio',
  projectTitle: 'Studio Demo — Product Launch Film',
  demoEmail: 'demo@readyforge.ai',
  leadEmail: 'lead@readyforge.ai',
  demoPassword: 'demo1234',
  budgetAmount: 5000,
  currency: 'INR',
} as const;

const DEMO_SOURCE = 'studio-demo-seed:v1';

interface MediaInfo {
  durationSeconds: number;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

interface StudioMedia {
  warmVideo: { fileName: string; filePath: string; info: MediaInfo };
  inkVideo: { fileName: string; filePath: string; info: MediaInfo };
  score: { fileName: string; filePath: string; info: MediaInfo };
  generated: number;
  reused: number;
}

export interface StudioDemoOptions {
  mediaDir?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  demoEmail?: string;
  leadEmail?: string;
  /** Suppress the operator-facing summary (used by tests). */
  silent?: boolean;
}

export interface StudioDemoSummary {
  skipped: boolean;
  reason?: string;
  workspaceId: string;
  projectId: string;
  compositionId: string;
  contractId: string;
  readinessScore: number;
  authorized: boolean;
  blockers: string[];
  counts: {
    inputsApproved: number;
    inputsRejected: number;
    conflictsResolved: number;
    assets: number;
    tracks: number;
    clips: number;
  };
  created: string[];
  updated: string[];
  reused: string[];
  media: { generated: number; reused: number };
}

class StudioDemoMediaError extends Error {}

function log(options: StudioDemoOptions, message: string): void {
  if (!options.silent) console.log(`[studio-demo] ${message}`);
}

function warn(options: StudioDemoOptions, message: string): void {
  if (!options.silent) console.warn(`[studio-demo] ${message}`);
}

function resolveExecutable(configured: string, name: 'ffmpeg' | 'ffprobe'): string {
  if (configured && configured !== name) return configured;
  const root = path.resolve(__dirname, '..', '..');
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  const candidates = [
    path.join(root, 'tools', 'ffmpeg', 'bin', executable),
    path.join(root, '..', 'tools', 'ffmpeg', 'bin', executable),
  ];
  const bundled = candidates.find((candidate) => fs.existsSync(candidate));
  return bundled || configured || name;
}

function run(command: string, args: string[], timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4_000);
    });
    child.once('error', (error) => {
      finish(() => reject(new StudioDemoMediaError(`${command} could not start: ${error.message}`)));
    });
    child.once('close', (code) => {
      finish(() => {
        if (timedOut) reject(new StudioDemoMediaError(`${command} timed out after ${timeoutMs} ms`));
        else if (code === 0) resolve();
        else reject(new StudioDemoMediaError(`${command} exited with code ${code}: ${stderr.trim().slice(-700)}`));
      });
    });
  });
}

async function probe(filePath: string, ffprobePath: string): Promise<MediaInfo | null> {
  if (!fs.existsSync(filePath)) return null;
  const info = await probeMediaFile(filePath, { ffprobePath });
  if (!info) return null;
  return {
    durationSeconds: info.durationSeconds,
    width: info.width,
    height: info.height,
    hasVideo: info.hasVideo,
    hasAudio: info.hasAudio,
  };
}

async function ensureVideo(
  outputPath: string,
  color: string,
  accent: string,
  ffmpegPath: string,
  ffprobePath: string
): Promise<{ info: MediaInfo; generated: boolean }> {
  const existing = await probe(outputPath, ffprobePath);
  if (existing?.hasVideo && existing.width === 1280 && existing.height === 720 && existing.durationSeconds >= 2.5) {
    return { info: existing, generated: false };
  }

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const tmp = `${outputPath}.tmp.mp4`;
  await fsp.rm(tmp, { force: true });
  await run(ffmpegPath, [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=1280x720:d=3:r=30`,
    '-vf',
    `drawbox=x=120:y=560:w=1040:h=8:color=${accent}:t=fill`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-movflags',
    '+faststart',
    '-an',
    '-y',
    tmp,
  ]);
  const info = await probe(tmp, ffprobePath);
  if (!info?.hasVideo || info.durationSeconds <= 0) {
    await fsp.rm(tmp, { force: true });
    throw new StudioDemoMediaError(`Generated video failed FFprobe validation: ${path.basename(outputPath)}`);
  }
  await fsp.rename(tmp, outputPath);
  return { info, generated: true };
}

async function ensureScore(
  outputPath: string,
  ffmpegPath: string,
  ffprobePath: string
): Promise<{ info: MediaInfo; generated: boolean }> {
  const existing = await probe(outputPath, ffprobePath);
  if (existing?.hasAudio && existing.durationSeconds >= 5.5) {
    return { info: existing, generated: false };
  }

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const tmp = `${outputPath}.tmp.wav`;
  await fsp.rm(tmp, { force: true });
  await run(ffmpegPath, [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=196:duration=6:sample_rate=48000',
    '-af',
    'volume=0.12,afade=t=in:st=0:d=0.8,afade=t=out:st=5.2:d=0.8',
    '-c:a',
    'pcm_s16le',
    '-y',
    tmp,
  ]);
  const info = await probe(tmp, ffprobePath);
  if (!info?.hasAudio || info.durationSeconds <= 0) {
    await fsp.rm(tmp, { force: true });
    throw new StudioDemoMediaError('Generated audio failed FFprobe validation.');
  }
  await fsp.rename(tmp, outputPath);
  return { info, generated: true };
}

async function ensureMedia(options: StudioDemoOptions): Promise<StudioMedia> {
  const mediaDir = path.resolve(options.mediaDir ?? config.upload.dir);
  const ffmpegPath = resolveExecutable(options.ffmpegPath ?? config.video.ffmpegPath, 'ffmpeg');
  const ffprobePath = resolveExecutable(options.ffprobePath ?? config.video.ffprobePath, 'ffprobe');

  const warmName = 'studio-demo-aurora-warm.mp4';
  const inkName = 'studio-demo-aurora-ink.mp4';
  const scoreName = 'studio-demo-score.wav';

  const warm = await ensureVideo(path.join(mediaDir, warmName), '0xE9DCC8', '0xB45B2A', ffmpegPath, ffprobePath);
  const ink = await ensureVideo(path.join(mediaDir, inkName), '0x17162A', '0xE9B872', ffmpegPath, ffprobePath);
  const score = await ensureScore(path.join(mediaDir, scoreName), ffmpegPath, ffprobePath);

  return {
    warmVideo: { fileName: warmName, filePath: path.join(mediaDir, warmName), info: warm.info },
    inkVideo: { fileName: inkName, filePath: path.join(mediaDir, inkName), info: ink.info },
    score: { fileName: scoreName, filePath: path.join(mediaDir, scoreName), info: score.info },
    generated: Number(warm.generated) + Number(ink.generated) + Number(score.generated),
    reused: Number(!warm.generated) + Number(!ink.generated) + Number(!score.generated),
  };
}

async function ensureUser(email: string, name: string): Promise<{ user: HydratedDocument<IUser>; created: boolean }> {
  const existing = await User.findOne({ email });
  if (existing) {
    let changed = false;
    if (!existing.isVerified) {
      existing.isVerified = true;
      changed = true;
    }
    if (name && existing.name !== name) {
      existing.name = name;
      changed = true;
    }
    if (changed) await existing.save();
    return { user: existing, created: false };
  }
  const user = await User.create({
    name,
    email,
    passwordHash: await bcrypt.hash(STUDIO_DEMO.demoPassword, 10),
    isVerified: true,
  });
  return { user, created: true };
}

async function ensureWorkspace(
  ownerId: Types.ObjectId,
  leadId: Types.ObjectId,
  created: string[],
  updated: string[],
  reused: string[]
) {
  let workspace = await Workspace.findOne({ name: STUDIO_DEMO.workspaceName, ownerId });
  if (!workspace) {
    workspace = await Workspace.create({
      name: STUDIO_DEMO.workspaceName,
      description: 'Development demo workspace for the ReadyForge Studio launch film.',
      ownerId,
      members: [
        { userId: ownerId, role: 'owner', status: 'active', joinedAt: new Date() },
        { userId: leadId, role: 'lead', status: 'active', joinedAt: new Date() },
      ],
      settings: { defaultCurrency: STUDIO_DEMO.currency, aiProviders: ['openai-compatible', 'local'], budgetApprovalThreshold: 1000 },
      brandDna: {
        brandName: 'Aurora',
        tone: 'Warm, precise, calm',
        bannedWords: ['revolutionary', 'guaranteed', 'overnight', 'hack'],
        colourPalette: ['#E9DCC8', '#17162A', '#B45B2A', '#E9B872'],
        logoRules: 'Wordmark only; never recolour; clear space equal to cap height.',
        targetAudience: 'Design-minded remote workers aged 25–45',
        legalRestrictions: ['No medical or sleep-benefit claims', 'Offer end date must be stated'],
      },
    });
    created.push('workspace');
  } else {
    const before = JSON.stringify({ description: workspace.description, brandDna: workspace.brandDna, settings: workspace.settings });
    workspace.description = 'Development demo workspace for the ReadyForge Studio launch film.';
    workspace.settings.defaultCurrency = STUDIO_DEMO.currency;
    workspace.settings.aiProviders = ['openai-compatible', 'local'];
    workspace.brandDna = {
      brandName: 'Aurora',
      tone: 'Warm, precise, calm',
      bannedWords: ['revolutionary', 'guaranteed', 'overnight', 'hack'],
      colourPalette: ['#E9DCC8', '#17162A', '#B45B2A', '#E9B872'],
      logoRules: 'Wordmark only; never recolour; clear space equal to cap height.',
      targetAudience: 'Design-minded remote workers aged 25–45',
      legalRestrictions: ['No medical or sleep-benefit claims', 'Offer end date must be stated'],
    };
    for (const member of [
      { userId: ownerId, role: 'owner' as const },
      { userId: leadId, role: 'lead' as const },
    ]) {
      const found = workspace.members.find((m) => m.userId.toString() === member.userId.toString());
      if (!found) workspace.members.push({ userId: member.userId, role: member.role, status: 'active', joinedAt: new Date() });
      else if (found.status !== 'active' || found.role !== member.role) {
        found.status = 'active';
        found.role = member.role;
      }
    }
    if (JSON.stringify({ description: workspace.description, brandDna: workspace.brandDna, settings: workspace.settings }) !== before) {
      await workspace.save();
      updated.push('workspace');
    } else {
      reused.push('workspace');
    }
  }
  return workspace;
}

interface InputSeed {
  title: string;
  type: InputType;
  content: string;
  sourceType?: SourceType;
  status: 'approved' | 'rejected';
  confidence?: number;
  tags?: string[];
}

const INPUT_SEEDS: InputSeed[] = [
  {
    title: 'Campaign objective',
    type: 'goal',
    content: 'Introduce the Aurora One desk lamp and drive 500 pre-orders before the 30 November launch.',
    status: 'approved',
    confidence: 1,
    tags: ['launch', 'pre-order'],
  },
  {
    title: 'Target audience',
    type: 'audience',
    content: 'Design-minded remote workers aged 25–45 who value a calm, focused workspace.',
    status: 'approved',
    confidence: 0.95,
  },
  {
    title: 'Product facts',
    type: 'fact',
    content:
      'Aurora One is a dimmable LED desk lamp with a 2700–5000K colour range, USB-C charging and a machined aluminium arm.',
    sourceType: 'approved_library',
    status: 'approved',
    confidence: 1,
  },
  {
    title: 'Pricing and offer',
    type: 'price',
    content: 'Aurora One retails at ₹4,999. Pre-orders placed before 30 November receive 10% off, not combinable with other offers.',
    sourceType: 'approved_library',
    status: 'approved',
    confidence: 1,
  },
  {
    title: 'Approved launch offer',
    type: 'price',
    content: '10% pre-order discount on ₹4,999, available until 30 November and not combinable with other offers.',
    status: 'approved',
    confidence: 1,
  },
  {
    title: 'Offer draft — 15% discount',
    type: 'price',
    content: 'Offer 15% off to everyone for the first week of launch.',
    status: 'rejected',
    confidence: 0.4,
  },
  {
    title: 'Creative direction',
    type: 'visual_rule',
    content: 'Warm off-white studio, deep ink shadows and an amber accent light. No lens flare, no hype typography.',
    status: 'approved',
    confidence: 1,
  },
  {
    title: 'Brand tone',
    type: 'tone',
    content: 'Warm, precise and calm. Avoid urgency language, superlatives and guarantees.',
    status: 'approved',
    confidence: 1,
  },
  {
    title: 'Legal restrictions',
    type: 'legal_rule',
    content:
      'Do not claim medical or sleep benefits. State the 30 November end date for the 10% offer and note that it cannot be combined.',
    status: 'approved',
    confidence: 1,
  },
  {
    title: 'Call to action',
    type: 'other',
    content: 'Reserve an Aurora One at aurora.example before 30 November.',
    status: 'approved',
    confidence: 1,
  },
  {
    title: 'Accessibility requirements',
    type: 'constraint',
    content: 'All titles must meet a 4.5:1 contrast ratio; include open captions on every scene.',
    status: 'approved',
    confidence: 1,
    tags: ['accessibility', 'captions'],
  },
  {
    title: 'Supported claim — launch discount',
    type: 'claim',
    content: 'Pre-orders placed before 30 November receive 10% off the ₹4,999 price.',
    status: 'approved',
    confidence: 0.95,
  },
];

async function ensureInputs(
  projectId: Types.ObjectId,
  workspaceId: Types.ObjectId,
  userId: Types.ObjectId,
  created: string[],
  updated: string[],
  reused: string[]
) {
  const inputs: Array<{ doc: IKnowledgeInput; seed: InputSeed }> = [];
  for (const seed of INPUT_SEEDS) {
    const existing = await KnowledgeInput.findOne({ projectId, title: seed.title });
    if (!existing) {
      const doc = await KnowledgeInput.create({
        projectId,
        workspaceId,
        createdById: userId,
        type: seed.type,
        title: seed.title,
        content: seed.content,
        sourceType: seed.sourceType ?? 'user_input',
        sourceReference: DEMO_SOURCE,
        status: seed.status,
        confidence: seed.confidence ?? 1,
        tags: seed.tags ?? [],
        approvedById: seed.status === 'approved' ? userId : undefined,
        approvedAt: seed.status === 'approved' ? new Date() : undefined,
        history: [
          {
            version: 1,
            title: seed.title,
            content: seed.content,
            status: seed.status,
            changedById: userId,
            changedAt: new Date(),
          },
        ],
      });
      inputs.push({ doc, seed });
      created.push(`input:${seed.title}`);
      continue;
    }

    const changed =
      existing.type !== seed.type ||
      existing.content !== seed.content ||
      existing.status !== seed.status ||
      existing.sourceReference !== DEMO_SOURCE ||
      existing.tags.join('|') !== (seed.tags ?? []).join('|');
    if (changed) {
      existing.type = seed.type;
      existing.content = seed.content;
      existing.status = seed.status;
      existing.sourceType = seed.sourceType ?? 'user_input';
      existing.sourceReference = DEMO_SOURCE;
      existing.confidence = seed.confidence ?? 1;
      existing.tags = seed.tags ?? [];
      if (seed.status === 'approved') {
        existing.approvedById = existing.approvedById ?? userId;
        existing.approvedAt = existing.approvedAt ?? new Date();
      } else {
        existing.approvedById = undefined;
        existing.approvedAt = undefined;
      }
      existing.version += 1;
      existing.history.push({
        version: existing.version,
        title: seed.title,
        content: seed.content,
        status: seed.status,
        changedById: userId,
        changedAt: new Date(),
      });
      await existing.save();
      updated.push(`input:${seed.title}`);
    } else {
      reused.push(`input:${seed.title}`);
    }
    inputs.push({ doc: existing, seed });
  }
  return inputs;
}

async function ensureConflict(
  projectId: Types.ObjectId,
  workspaceId: Types.ObjectId,
  userId: Types.ObjectId,
  inputAId: Types.ObjectId,
  inputBId: Types.ObjectId,
  created: string[],
  updated: string[],
  reused: string[]
) {
  const title = 'Launch offer discount disagreement';
  const description =
    'The rejected 15% draft contradicts the approved 10% pre-order offer. Only one discount can be published.';
  const existing = await Conflict.findOne({ projectId, title });
  if (!existing) {
    const doc = await Conflict.create({
      projectId,
      workspaceId,
      title,
      description,
      severity: 'high',
      status: 'resolved',
      inputAId,
      inputBId,
      conflictType: 'pricing',
      detectedBy: 'system',
      assignedToId: userId,
      recommendedAction: 'Keep the approved 10% offer; reject the 15% draft and state the 30 November end date.',
      impactIfUnresolved: 'Contradictory pricing would create a consumer-protection and trust risk.',
      resolution:
        'Owner decision: publish the approved 10% offer. The 15% draft is rejected and must not appear in the film.',
      resolvedById: userId,
      resolvedAt: new Date(),
    });
    created.push('conflict');
    return doc;
  }

  const changed = existing.status !== 'resolved' || existing.severity !== 'high' || existing.resolution !==
    'Owner decision: publish the approved 10% offer. The 15% draft is rejected and must not appear in the film.';
  if (changed) {
    existing.status = 'resolved';
    existing.severity = 'high';
    existing.inputAId = inputAId;
    existing.inputBId = inputBId;
    existing.resolution =
      'Owner decision: publish the approved 10% offer. The 15% draft is rejected and must not appear in the film.';
    existing.resolvedById = existing.resolvedById ?? userId;
    existing.resolvedAt = existing.resolvedAt ?? new Date();
    await existing.save();
    updated.push('conflict');
  } else {
    reused.push('conflict');
  }
  return existing;
}

async function upsertAsset(
  params: {
    projectId: Types.ObjectId;
    workspaceId: Types.ObjectId;
    userId: Types.ObjectId;
    name: string;
    type: IAsset['type'];
    mimeType: string;
    fileName: string;
    filePath: string;
    info: MediaInfo;
  },
  created: string[],
  updated: string[],
  reused: string[]
) {
  const stat = await fsp.stat(params.filePath);
  const fields = {
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    uploadedById: params.userId,
    name: params.name,
    type: params.type,
    fileUrl: `/uploads/${params.fileName}`,
    thumbnailUrl: '',
    mimeType: params.mimeType,
    sizeBytes: stat.size,
    sourceDurationSeconds: params.info.durationSeconds,
    licenseStatus: 'owned' as const,
    licenseType: 'Generated in-project fixture for the ReadyForge Studio demo (development only)',
    licenseOwner: 'ReadyForge Studio',
    allowedChannels: ['demo', 'internal'],
    allowedRegions: ['global'],
    consentRequired: false,
    consentStatus: 'not_required' as const,
    aiGenerated: false,
  };
  const existing = await Asset.findOne({ projectId: params.projectId, name: params.name });
  if (!existing) {
    const asset = await Asset.create(fields);
    created.push(`asset:${params.name}`);
    return asset;
  }
  const changed =
    existing.fileUrl !== fields.fileUrl ||
    existing.sizeBytes !== fields.sizeBytes ||
    existing.sourceDurationSeconds !== fields.sourceDurationSeconds ||
    existing.licenseStatus !== fields.licenseStatus ||
    existing.licenseOwner !== fields.licenseOwner;
  if (changed) {
    Object.assign(existing, fields);
    await existing.save();
    updated.push(`asset:${params.name}`);
  } else {
    reused.push(`asset:${params.name}`);
  }
  return existing;
}

function contractFields(args: {
  projectId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  demoId: Types.ObjectId;
  leadId: Types.ObjectId;
  claimIds: Types.ObjectId[];
  assetIds: Types.ObjectId[];
}) {
  return {
    objective: 'Introduce the Aurora One desk lamp and drive 500 pre-orders before 30 November.',
    audience: 'Design-minded remote workers aged 25–45 who value a calm, focused workspace.',
    tone: 'Warm, precise and calm.',
    keyMessage: 'Focus, beautifully.',
    callToAction: 'Reserve an Aurora One at aurora.example before 30 November.',
    approvedClaimIds: args.claimIds,
    approvedAssetIds: args.assetIds,
    brandRules: [
      'Warm off-white studio, deep ink shadows and an amber accent; no lens flare or hype typography.',
      'Tone is warm, precise and calm; never use urgency language or superlatives.',
      'Legal: no medical or sleep-benefit claims; state the 30 November offer end date and no combinability.',
    ],
    accessibilityRequirements: ['Open captions on every scene', 'Titles meet a 4.5:1 contrast ratio'],
    localisationRequirements: [],
    contentPlan: {
      outline: [
        'Warm studio reveal of the Aurora One.',
        'Detail: dimming range, USB-C and the machined arm.',
        'Offer: 10% pre-order discount before 30 November.',
        'CTA: reserve at aurora.example.',
      ],
      script:
        'A warm pool of light reveals the Aurora One on a quiet desk. The arm turns; the light shifts from 2700K to 5000K. Titles: Focus, beautifully. Pre-order before 30 November and save 10%.',
      storyboard: [
        {
          sceneNumber: 1,
          title: 'Reveal',
          description: 'Warm studio, lamp off, then a soft amber glow.',
          visualDirection: 'Slow push in; warm off-white background, deep ink shadows.',
          voiceover: 'Meet Aurora One.',
          durationSeconds: 2,
          status: 'approved' as const,
        },
        {
          sceneNumber: 2,
          title: 'Precision',
          description: 'Macro details of the arm, dial and USB-C port.',
          visualDirection: 'Clean cuts on the beat; no lens flare.',
          voiceover: 'Light that follows your focus.',
          durationSeconds: 2.5,
          status: 'approved' as const,
        },
        {
          sceneNumber: 3,
          title: 'Offer and CTA',
          description: 'Title card with the 10% offer and end date.',
          visualDirection: 'High-contrast type, amber accent, open captions.',
          voiceover: 'Pre-order before 30 November and save 10%.',
          durationSeconds: 1.5,
          status: 'approved' as const,
        },
      ],
    },
    modelRoutingPlan: [
      {
        task: 'script-generation',
        preferredModel: 'Qwen/Qwen2.5-0.5B-Instruct',
        fallbackModel: 'readyforge-rules',
        estimatedCost: 12,
        reason: 'Short launch script constrained to approved facts.',
      },
      {
        task: 'storyboard-generation',
        preferredModel: 'Qwen/Qwen2.5-0.5B-Instruct',
        fallbackModel: 'readyforge-rules',
        estimatedCost: 18,
        reason: 'Three scenes using only cleared fixtures.',
      },
    ],
    budgetLimit: STUDIO_DEMO.budgetAmount,
    requiredApprovals: [
      {
        userId: args.demoId,
        role: 'owner',
        status: 'approved' as const,
        decidedAt: new Date(),
        comment: 'Claims, pricing and legal constraints match the ledger.',
      },
      {
        userId: args.leadId,
        role: 'lead',
        status: 'approved' as const,
        decidedAt: new Date(),
        comment: 'Approved for the local demo render.',
      },
    ],
    blockers: [] as string[],
    createdById: args.demoId,
    approvedAt: new Date(),
  };
}

function contractIsReady(contract: IProductionContract): boolean {
  return (
    contract.status === 'locked' &&
    Boolean(contract.contentPlan.script.trim()) &&
    contract.contentPlan.storyboard.length > 0 &&
    contract.requiredApprovals.length > 0 &&
    contract.requiredApprovals.every((approval) => approval.status === 'approved')
  );
}

async function ensureContract(
  args: {
    projectId: Types.ObjectId;
    workspaceId: Types.ObjectId;
    demoId: Types.ObjectId;
    leadId: Types.ObjectId;
    claimIds: Types.ObjectId[];
    assetIds: Types.ObjectId[];
  },
  created: string[],
  updated: string[],
  reused: string[]
) {
  const latest = await ProductionContract.findOne({ projectId: args.projectId, status: { $ne: 'superseded' } }).sort('-version');
  const fields = contractFields(args);

  if (latest && contractIsReady(latest)) {
    reused.push('contract');
    return latest;
  }

  if (latest && latest.status === 'locked') {
    // A locked contract that predates the demo requirements cannot be edited;
    // supersede it and create the next version with a complete plan.
    latest.status = 'superseded';
    await latest.save();
    updated.push('contract:superseded');
  }

  let contract = latest;
  if (!contract || contract.status === 'superseded') {
    const version = (latest?.version ?? 0) + 1;
    contract = await ProductionContract.create({
      projectId: args.projectId,
      workspaceId: args.workspaceId,
      version,
      status: 'approved',
      ...fields,
    });
    created.push('contract');
  } else {
    Object.assign(contract, fields, { status: 'approved' });
    await contract.save();
    updated.push('contract');
  }

  // Mirror POST /projects/:id/contract/lock: only an approved contract with
  // all required approvals can be locked.
  if (contract.status !== 'approved') {
    throw new Error(`Studio Demo contract is ${contract.status}; cannot lock.`);
  }
  if (!contract.requiredApprovals.every((approval) => approval.status === 'approved')) {
    throw new Error('Studio Demo contract has pending approvals; refusing to lock.');
  }
  contract.status = 'locked';
  await contract.save();
  return contract;
}

function desiredTracks(): ICompositionTrack[] {
  return [
    { trackId: 'video-1', name: 'Picture', type: 'video', order: 0, muted: false, hidden: false, locked: false, volume: 1 },
    { trackId: 'audio-1', name: 'Score', type: 'audio', order: 1, muted: false, hidden: false, locked: false, volume: 1 },
    { trackId: 'text-1', name: 'Titles', type: 'text', order: 2, muted: false, hidden: false, locked: false, volume: 1 },
  ];
}

function desiredClips(args: {
  warmId: Types.ObjectId;
  inkId: Types.ObjectId;
  scoreId: Types.ObjectId;
}): ICompositionClip[] {
  return [
    {
      assetId: args.warmId,
      trackId: 'video-1',
      trackType: 'video',
      timelineStartSeconds: 0,
      sourceInSeconds: 0,
      sourceOutSeconds: 3,
      durationSeconds: 3,
      order: 0,
    },
    {
      assetId: args.inkId,
      trackId: 'video-1',
      trackType: 'video',
      timelineStartSeconds: 3,
      sourceInSeconds: 0,
      sourceOutSeconds: 3,
      durationSeconds: 3,
      order: 1,
      transitionIn: { type: 'fade-black', durationSeconds: 0.7 },
    },
    {
      assetId: args.scoreId,
      trackId: 'audio-1',
      trackType: 'audio',
      timelineStartSeconds: 0,
      sourceInSeconds: 0,
      sourceOutSeconds: 6,
      durationSeconds: 6,
      order: 0,
      audio: { volume: 0.8, fadeInSeconds: 0.8, fadeOutSeconds: 0.8 },
    },
    {
      trackId: 'text-1',
      trackType: 'text',
      timelineStartSeconds: 0.3,
      sourceInSeconds: 0,
      sourceOutSeconds: 0,
      durationSeconds: 5.2,
      order: 0,
      text: {
        content: 'AURORA ONE\nFocus, beautifully.',
        x: 0.14,
        y: 0.36,
        width: 0.72,
        alignment: 'left',
        fontFamily: 'sans',
        fontSize: 64,
        fontColor: '#FFFFFF',
        backgroundColor: '#141428',
        backgroundOpacity: 0.35,
        textOpacity: 1,
        bold: true,
        italic: false,
        shadow: true,
        outline: false,
        outlineColor: '#000000',
        outlineWidth: 2,
        zIndex: 20,
        animation: {
          version: 1,
          entrance: { type: 'fade', durationSeconds: 0.7, delaySeconds: 0.2, easing: 'ease-out' },
          exit: { type: 'fade', durationSeconds: 0.6, delaySeconds: 0, easing: 'ease-in' },
        },
      },
    },
  ];
}

async function ensureComposition(
  args: {
    projectId: Types.ObjectId;
    workspaceId: Types.ObjectId;
    demoId: Types.ObjectId;
    warmId: Types.ObjectId;
    inkId: Types.ObjectId;
    scoreId: Types.ObjectId;
  },
  created: string[],
  updated: string[],
  reused: string[]
) {
  const existing = await EditComposition.findOne({ projectId: args.projectId });
  const tracks = desiredTracks();
  const clips = desiredClips(args);

  if (!existing) {
    const composition = await EditComposition.create({
      projectId: args.projectId,
      workspaceId: args.workspaceId,
      ownerId: args.demoId,
      schemaVersion: 2,
      tracks,
      clips,
    });
    created.push('composition');
    return composition;
  }

  // Never overwrite a composition a judge has edited; only repair an empty or
  // incomplete seed result.
  if (existing.clips.length >= 4 && existing.tracks.length >= 3) {
    reused.push('composition');
    return existing;
  }
  existing.schemaVersion = 2;
  existing.tracks = tracks;
  existing.clips = clips;
  await existing.save();
  updated.push('composition');
  return existing;
}

export async function ensureStudioDemo(options: StudioDemoOptions = {}): Promise<StudioDemoSummary> {
  if (config.isProd) {
    throw new Error('The Studio Demo seed is disabled when NODE_ENV=production.');
  }

  const created: string[] = [];
  const updated: string[] = [];
  const reused: string[] = [];
  const demoEmail = options.demoEmail ?? STUDIO_DEMO.demoEmail;
  const leadEmail = options.leadEmail ?? STUDIO_DEMO.leadEmail;

  const demoResult = await ensureUser(demoEmail, 'Demo Owner');
  if (demoResult.created) created.push('user:demo');
  else reused.push('user:demo');
  const demo = demoResult.user;

  const leadResult = await ensureUser(leadEmail, 'Leah Lead');
  if (leadResult.created) created.push('user:lead');
  else reused.push('user:lead');
  const lead = leadResult.user;

  const workspace = await ensureWorkspace(demo._id, lead._id, created, updated, reused);

  let project = await Project.findOne({ workspaceId: workspace._id, title: STUDIO_DEMO.projectTitle });
  const projectFields = {
    description: 'A 6-second launch film for the Aurora One desk lamp, produced in the ReadyForge Studio demo.',
    projectType: 'video' as const,
    mode: 'team' as const,
    status: 'ready' as const,
    objective: 'Introduce the Aurora One desk lamp and drive 500 pre-orders before 30 November.',
    audience: 'Design-minded remote workers aged 25–45 who value a calm, focused workspace.',
    tone: 'Warm, precise and calm.',
    callToAction: 'Reserve an Aurora One at aurora.example before 30 November.',
    successMetric: '500 pre-orders before 30 November.',
    deadline: project?.deadline && project.deadline.getTime() > Date.now() ? project.deadline : new Date(Date.now() + 21 * 86_400_000),
    currentStage: 'final' as const,
    createdById: demo._id,
  };

  if (!project) {
    project = await Project.create({
      workspaceId: workspace._id,
      title: STUDIO_DEMO.projectTitle,
      ...projectFields,
      budget: {
        amount: STUDIO_DEMO.budgetAmount,
        currency: STUDIO_DEMO.currency,
        spent: 0,
        remaining: STUDIO_DEMO.budgetAmount,
      },
    });
    created.push('project');
  } else {
    const before = JSON.stringify({
      description: project.description,
      objective: project.objective,
      audience: project.audience,
      tone: project.tone,
      callToAction: project.callToAction,
      status: project.status,
      currentStage: project.currentStage,
      budget: { amount: project.budget.amount, currency: project.budget.currency },
    });
    Object.assign(project, projectFields);
    project.budget.amount = STUDIO_DEMO.budgetAmount;
    project.budget.currency = STUDIO_DEMO.currency;
    project.budget.remaining = Math.max(project.budget.remaining, STUDIO_DEMO.budgetAmount - project.budget.spent);
    const after = JSON.stringify({
      description: project.description,
      objective: project.objective,
      audience: project.audience,
      tone: project.tone,
      callToAction: project.callToAction,
      status: project.status,
      currentStage: project.currentStage,
      budget: { amount: project.budget.amount, currency: project.budget.currency },
    });
    if (before !== after) {
      await project.save();
      updated.push('project');
    } else {
      reused.push('project');
    }
  }

  for (const member of [
    { userId: demo._id, workspaceRole: 'owner', projectRole: 'owner', responsibilities: ['Owner', 'Final approval'] },
    { userId: lead._id, workspaceRole: 'lead', projectRole: 'lead', responsibilities: ['Production lead', 'Approvals'] },
  ]) {
    const existingMember = await ProjectMember.findOne({ projectId: project._id, userId: member.userId });
    if (!existingMember) {
      await ProjectMember.create({
        projectId: project._id,
        ...member,
        status: 'active',
        joinedAt: new Date(),
      });
      created.push(`member:${member.projectRole}`);
    } else {
      reused.push(`member:${member.projectRole}`);
    }
  }

  const inputs = await ensureInputs(project._id, workspace._id, demo._id, created, updated, reused);

  let media: StudioMedia;
  try {
    media = await ensureMedia(options);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warn(options, `media unavailable — Studio Demo not completed: ${reason}`);
    return {
      skipped: true,
      reason,
      workspaceId: workspace._id.toString(),
      projectId: project._id.toString(),
      compositionId: '',
      contractId: '',
      readinessScore: 0,
      authorized: false,
      blockers: [`media_unavailable: ${reason}`],
      counts: { inputsApproved: 0, inputsRejected: 0, conflictsResolved: 0, assets: 0, tracks: 0, clips: 0 },
      created,
      updated,
      reused,
      media: { generated: 0, reused: 0 },
    };
  }

  const warmAsset = await upsertAsset(
    {
      projectId: project._id,
      workspaceId: workspace._id,
      userId: demo._id,
      name: 'aurora-one-warm.mp4',
      type: 'video',
      mimeType: 'video/mp4',
      fileName: media.warmVideo.fileName,
      filePath: media.warmVideo.filePath,
      info: media.warmVideo.info,
    },
    created,
    updated,
    reused
  );
  const inkAsset = await upsertAsset(
    {
      projectId: project._id,
      workspaceId: workspace._id,
      userId: demo._id,
      name: 'aurora-one-ink.mp4',
      type: 'video',
      mimeType: 'video/mp4',
      fileName: media.inkVideo.fileName,
      filePath: media.inkVideo.filePath,
      info: media.inkVideo.info,
    },
    created,
    updated,
    reused
  );
  const scoreAsset = await upsertAsset(
    {
      projectId: project._id,
      workspaceId: workspace._id,
      userId: demo._id,
      name: 'aurora-one-score.wav',
      type: 'audio',
      mimeType: 'audio/wav',
      fileName: media.score.fileName,
      filePath: media.score.filePath,
      info: media.score.info,
    },
    created,
    updated,
    reused
  );

  const approvedInputs = inputs.filter((item) => item.doc.status === 'approved').map((item) => item.doc);
  const rejectedInputs = inputs.filter((item) => item.doc.status === 'rejected');
  const claim = inputs.find((item) => item.seed.title === 'Supported claim — launch discount')!.doc;
  const draftOffer = inputs.find((item) => item.seed.title === 'Offer draft — 15% discount')!.doc;
  const approvedOffer = inputs.find((item) => item.seed.title === 'Approved launch offer')!.doc;

  await ensureConflict(
    project._id,
    workspace._id,
    demo._id,
    approvedOffer._id,
    draftOffer._id,
    created,
    updated,
    reused
  );

  const contract = await ensureContract(
    {
      projectId: project._id,
      workspaceId: workspace._id,
      demoId: demo._id,
      leadId: lead._id,
      claimIds: [claim._id],
      assetIds: [warmAsset._id, inkAsset._id, scoreAsset._id],
    },
    created,
    updated,
    reused
  );

  const composition = await ensureComposition(
    {
      projectId: project._id,
      workspaceId: workspace._id,
      demoId: demo._id,
      warmId: warmAsset._id,
      inkId: inkAsset._id,
      scoreId: scoreAsset._id,
    },
    created,
    updated,
    reused
  );

  const [freshInputs, conflicts, assets] = await Promise.all([
    KnowledgeInput.find({ projectId: project._id }),
    Conflict.find({ projectId: project._id }),
    Asset.find({ projectId: project._id, workspaceId: workspace._id }),
  ]);
  const readiness = computeReadiness({
    project: project.toObject() as unknown as IProject,
    inputs: freshInputs,
    conflicts,
    assets,
    contract: contract.toObject() as unknown as IProductionContract,
    requiredStage: 'final',
  });
  const authorized = readiness.productionAuthorization.authorized;
  const blockers = readiness.productionAuthorization.blockers.map((blocker) => `${blocker.code}: ${blocker.message}`);

  if (!authorized) {
    throw new Error(`Studio Demo is not render-authorized: ${blockers.join(' | ')}`);
  }

  // Persist the score the dashboard and project header read. Readiness itself is
  // still recomputed live by the authorization gates; this keeps the stored
  // summary consistent with that fresh evaluation.
  if (project.readinessScore !== readiness.score) {
    project.readinessScore = readiness.score;
    await project.save();
  }

  const describe = (items: string[]) => {
    const groups = new Map<string, number>();
    for (const item of items) {
      const key = item.includes(':') ? item.slice(0, item.indexOf(':')) : item;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    return Array.from(groups, ([key, count]) => `${key}×${count}`).join(', ') || 'none';
  };

  log(options, `reconcile: ${created.length} created, ${updated.length} updated, ${reused.length} reused`);
  log(options, `created: ${describe(created)}`);
  log(options, `updated: ${describe(updated)}`);
  log(options, `reused: ${describe(reused)}`);
  log(options, `workspace "${STUDIO_DEMO.workspaceName}" (${created.includes('workspace') ? 'created' : reused.includes('workspace') ? 'reused' : 'updated'})`);
  log(options, `project "${STUDIO_DEMO.projectTitle}" (${created.includes('project') ? 'created' : 'reused'})`);
  log(options, `media: ${media.generated} generated, ${media.reused} reused; all FFprobe-valid`);
  log(options, `ledger: ${approvedInputs.length} approved, ${rejectedInputs.length} rejected; conflict resolved`);
  log(options, `contract v${contract.version} locked; readiness ${readiness.score}/100; authorized=true`);
  log(options, `composition: ${composition.tracks.length} tracks, ${composition.clips.length} clips, revision ${composition.__v}`);
  log(options, `login: ${demoEmail} / ${STUDIO_DEMO.demoPassword} (development only)`);
  log(options, `open: http://localhost:5173/app/projects/${project._id}/editor`);

  return {
    skipped: false,
    workspaceId: workspace._id.toString(),
    projectId: project._id.toString(),
    compositionId: composition._id.toString(),
    contractId: contract._id.toString(),
    readinessScore: readiness.score,
    authorized,
    blockers,
    counts: {
      inputsApproved: approvedInputs.length,
      inputsRejected: rejectedInputs.length,
      conflictsResolved: conflicts.filter((conflict) => conflict.status === 'resolved').length,
      assets: assets.length,
      tracks: composition.tracks.length,
      clips: composition.clips.length,
    },
    created,
    updated,
    reused,
    media: { generated: media.generated, reused: media.reused },
  };
}

if (require.main === module) {
  (async () => {
    const { connectDb, disconnectDb } = await import('./db');
    await connectDb();
    const summary = await ensureStudioDemo();
    await disconnectDb();
    if (summary.skipped) {
      console.error(`[studio-demo] skipped: ${summary.reason}`);
      process.exit(1);
    }
    if (!summary.authorized) {
      console.error(`[studio-demo] not render-authorized: ${summary.blockers.join(' | ')}`);
      process.exit(1);
    }
    process.exit(0);
  })().catch((error) => {
    console.error('[studio-demo] failed:', error);
    process.exit(1);
  });
}
