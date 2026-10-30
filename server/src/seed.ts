import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { User } from './models/User';
import { Workspace } from './models/Workspace';
import { Project } from './models/Project';
import { ProjectMember } from './models/ProjectMember';
import { KnowledgeInput } from './models/KnowledgeInput';
import { Conflict } from './models/Conflict';
import { Asset } from './models/Asset';
import { Notification } from './models/Notification';
import { ensureDemoPipeline, topUpDemoPipeline } from './demoPipeline';
import { ensureStudioDemo } from './demoStudio';
import { config } from './config';

const UPLOADS = path.resolve(config.upload.dir);

function writeLogo() {
  fs.mkdirSync(UPLOADS, { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="96" viewBox="0 0 320 96">
  <rect width="320" height="96" rx="16" fill="#12101F"/>
  <circle cx="48" cy="48" r="22" fill="#5B4BFF"/>
  <path d="M40 58 L48 34 L56 58 M43 50 H53" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>
  <text x="84" y="60" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#F5F3FF">Inkloom</text>
</svg>`;
  fs.writeFileSync(path.join(UPLOADS, 'inkloom-logo.svg'), svg);
  return '/uploads/inkloom-logo.svg';
}

function writeProductImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FFF3E2"/><stop offset="1" stop-color="#FFD9A0"/>
  </linearGradient></defs>
  <rect width="480" height="320" fill="url(#g)"/>
  <rect x="180" y="90" width="120" height="150" rx="14" fill="#5B4BFF"/>
  <rect x="196" y="72" width="88" height="26" rx="8" fill="#3D31B8"/>
  <text x="240" y="170" text-anchor="middle" font-family="Arial" font-size="20" font-weight="700" fill="#fff">Cedar &amp;</text>
  <text x="240" y="196" text-anchor="middle" font-family="Arial" font-size="20" font-weight="700" fill="#fff">Amber</text>
</svg>`;
  fs.writeFileSync(path.join(UPLOADS, 'candle-product.svg'), svg);
  return '/uploads/candle-product.svg';
}

function writeSilentWav(): string {
  // 1 second of silence — a valid, playable WAV file for the demo music track
  const sampleRate = 8000;
  const dataSize = sampleRate;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  buf.fill(128, 44); // mid-point = silence for 8-bit PCM
  fs.writeFileSync(path.join(UPLOADS, 'demo-track.wav'), buf);
  return '/uploads/demo-track.wav';
}

async function ensureSeedStudioDemo(): Promise<void> {
  const studio = await ensureStudioDemo();
  if (studio.skipped) {
    throw new Error(`Studio Demo could not be prepared: ${studio.reason ?? 'unknown media error'}`);
  }
}

export async function seed(): Promise<void> {
  const existing = await User.findOne({ email: 'demo@readyforge.ai' });
  if (existing) {
    // Older demo databases may lack the contract/generation stage — backfill it.
    await topUpDemoPipeline();
    // The Studio Demo is idempotent and is also added to existing demo databases.
    await ensureSeedStudioDemo();
    console.log('[seed] demo data already present — Studio Demo reconciled');
    return;
  }

  const passwordHash = await bcrypt.hash('demo1234', 10);
  const demo = await User.create({
    name: 'Demo Owner',
    email: 'demo@readyforge.ai',
    passwordHash,
    isVerified: true,
  });
  const lead = await User.create({
    name: 'Leah Lead',
    email: 'lead@readyforge.ai',
    passwordHash,
    isVerified: true,
  });

  const workspace = await Workspace.create({
    name: 'Inkloom Marketing Team',
    description: 'Product marketing for Inkloom — campaign planning SaaS.',
    ownerId: demo._id,
    members: [
      { userId: demo._id, role: 'owner', status: 'active', joinedAt: new Date() },
      { userId: lead._id, role: 'lead', status: 'active', joinedAt: new Date() },
    ],
    settings: { defaultCurrency: 'INR', aiProviders: ['openai-compatible'], budgetApprovalThreshold: 1000 },
  });

  /* ---------------- team project ---------------- */
  const teamProject = await Project.create({
    workspaceId: workspace._id,
    createdById: lead._id,
    title: 'Product Launch Video',
    description: '60-second launch video for the new Inkloom Campaign Planner.',
    projectType: 'video',
    status: 'collecting_inputs',
    mode: 'team',
    objective: 'Drive free-trial signups for the Campaign Planner launch',
    audience: 'Marketing leads at 10–100 person SaaS companies',
    tone: 'Confident, minimal',
    successMetric: '200 trial signups in the first 30 days',
    budget: { amount: 5000, currency: 'INR', spent: 0, remaining: 5000 },
  });

  await ProjectMember.create([
    {
      projectId: teamProject._id,
      userId: lead._id,
      workspaceRole: 'lead',
      projectRole: 'lead',
      responsibilities: ['Project lead', 'Final approvals'],
      status: 'active',
    },
    {
      projectId: teamProject._id,
      userId: demo._id,
      workspaceRole: 'owner',
      projectRole: 'writer',
      responsibilities: ['Script', 'Subject-matter facts'],
      status: 'active',
    },
  ]);

  const inputRows = [
    { type: 'fact', title: 'Product name', content: 'Inkloom Campaign Planner', status: 'approved', sourceType: 'approved_library', confidence: 1 },
    { type: 'price', title: 'Pricing', content: 'Starter plan ₹499/month, Pro plan ₹1,499/month', status: 'approved', sourceType: 'approved_library', confidence: 1 },
    { type: 'fact', title: 'Customer result', content: 'Teams cut campaign setup time by 32% (survey of 42 customers, Q2 2025).', status: 'approved', sourceType: 'uploaded_document', confidence: 0.9 },
    { type: 'claim', title: 'Supported claim', content: 'Inkloom helps teams cut campaign setup time by 32%.', status: 'approved', sourceType: 'approved_library', confidence: 0.95 },
    { type: 'claim', title: 'Restricted claim', content: 'Inkloom guarantees a 10x return in 30 days.', status: 'rejected', sourceType: 'user_input', confidence: 0.3 },
    { type: 'audience', title: 'Primary audience', content: 'Marketing leads at 10–100 person SaaS companies', status: 'approved', sourceType: 'user_input', confidence: 0.9 },
    { type: 'goal', title: 'Writer: trial offer', content: 'Offer a free trial to everyone.', status: 'draft', sourceType: 'user_input', confidence: 0.6 },
    { type: 'constraint', title: 'Lead: trial eligibility', content: 'Free trial is enterprise-only.', status: 'draft', sourceType: 'user_input', confidence: 0.8 },
    { type: 'visual_rule', title: 'Brand colours', content: 'Warm off-white background with Inkloom violet #5B4BFF accents.', status: 'approved', sourceType: 'user_input', confidence: 1 },
    { type: 'constraint', title: 'Accessibility', content: 'Captions required on all video scenes; minimum contrast ratio 4.5:1.', status: 'approved', sourceType: 'user_input', confidence: 1, tags: ['accessibility'] },
  ];

  const created = await KnowledgeInput.create(
    inputRows.map((r, idx) => ({
      ...r,
      tags: (r as { tags?: string[] }).tags || [],
      projectId: teamProject._id,
      workspaceId: workspace._id,
      createdById: idx < 6 ? lead._id : demo._id,
      approvedById: r.status === 'approved' ? demo._id : undefined,
      approvedAt: r.status === 'approved' ? new Date() : undefined,
    }))
  );

  const writerInput = created.find((i) => i.title === 'Writer: trial offer')!;
  const leadInput = created.find((i) => i.title === 'Lead: trial eligibility')!;

  const conflict = await Conflict.create({
    projectId: teamProject._id,
    workspaceId: workspace._id,
    title: 'Offer eligibility contradiction',
    description:
      '"Offer a free trial to everyone." (writer) contradicts "Free trial is enterprise-only." (lead). Only one eligibility rule can be true.',
    severity: 'high',
    conflictType: 'pricing',
    status: 'open',
    detectedBy: 'system',
    assignedToId: lead._id,
    inputAId: writerInput._id,
    inputBId: leadInput._id,
    recommendedAction: 'Decide the authoritative trial policy, then approve one input and reject the other.',
    impactIfUnresolved: 'Generated video would state contradictory offer terms — a trust and compliance risk.',
  });

  await Notification.create({
    userId: lead._id,
    workspaceId: workspace._id,
    projectId: teamProject._id,
    type: 'conflict_assigned',
    title: 'Conflict assigned: Offer eligibility contradiction',
    message: 'Writer says "free trial for everyone"; lead says "enterprise-only". Your decision is required.',
    link: `/app/projects/${teamProject._id}/conflicts`,
  });

  /* ---------------- assets ---------------- */
  const logoUrl = writeLogo();
  const productUrl = writeProductImage();
  const musicUrl = writeSilentWav();

  const assets = await Asset.create([
    {
      workspaceId: workspace._id,
      projectId: teamProject._id,
      uploadedById: demo._id,
      name: 'inkloom-logo.svg',
      type: 'logo',
      fileUrl: logoUrl,
      thumbnailUrl: logoUrl,
      mimeType: 'image/svg+xml',
      sizeBytes: fs.statSync(path.join(UPLOADS, 'inkloom-logo.svg')).size,
      licenseStatus: 'licensed',
      licenseType: 'Brand-owned trademark',
      licenseOwner: 'Inkloom Inc.',
      allowedChannels: ['all'],
      allowedRegions: ['global'],
    },
    {
      workspaceId: workspace._id,
      projectId: teamProject._id,
      uploadedById: demo._id,
      name: 'candle-product.svg',
      type: 'image',
      fileUrl: productUrl,
      thumbnailUrl: productUrl,
      mimeType: 'image/svg+xml',
      sizeBytes: fs.statSync(path.join(UPLOADS, 'candle-product.svg')).size,
      licenseStatus: 'owned',
      licenseOwner: 'Inkloom Inc.',
      allowedChannels: ['all'],
      allowedRegions: ['global'],
    },
    {
      workspaceId: workspace._id,
      projectId: teamProject._id,
      uploadedById: lead._id,
      name: 'demo-track.wav',
      type: 'audio',
      fileUrl: musicUrl,
      mimeType: 'audio/wav',
      sizeBytes: fs.statSync(path.join(UPLOADS, 'demo-track.wav')).size,
      licenseStatus: 'unknown',
      consentRequired: false,
      consentStatus: 'not_required',
    },
  ]);

  /* ---------------- contract, generation history, verification, reviews ---------------- */
  await ensureDemoPipeline({
    workspaceId: workspace._id,
    projectId: teamProject._id,
    objective: teamProject.objective ?? '',
    audience: teamProject.audience ?? '',
    tone: teamProject.tone ?? '',
    demoId: demo._id,
    leadId: lead._id,
    approvedInputIds: created.filter((i) => i.status === 'approved').map((i) => i._id),
    claimInputId: created.find((i) => i.title === 'Supported claim')!._id,
    audienceInputId: created.find((i) => i.title === 'Primary audience')!._id,
    // Only licensed/owned assets enter the contract — the unknown-licence track is excluded on purpose.
    clearedAssetIds: [assets[0]._id, assets[1]._id],
  });

  /* ---------------- solo project ---------------- */
  const soloProject = await Project.create({
    workspaceId: workspace._id,
    createdById: demo._id,
    title: 'Handmade Candle Shop Ad',
    description: 'Make a 20-second ad for my handmade candle shop.',
    projectType: 'ad',
    status: 'collecting_inputs',
    mode: 'solo',
    objective: 'Drive online orders for the summer scent launch',
    audience: 'Gift buyers aged 25–45 who shop small businesses',
    budget: { amount: 900, currency: 'INR', spent: 0, remaining: 900 },
    deadline: new Date(Date.now() + 7 * 86_400_000),
  });

  await ProjectMember.create({
    projectId: soloProject._id,
    userId: demo._id,
    workspaceRole: 'owner',
    projectRole: 'owner',
    responsibilities: ['Solo creator'],
    status: 'active',
  });

  await KnowledgeInput.create([
    {
      projectId: soloProject._id,
      workspaceId: workspace._id,
      createdById: demo._id,
      type: 'fact',
      title: 'Product',
      content: 'Handmade soy candle — Cedar & Amber, ₹649, 40-hour burn time.',
      status: 'approved',
      sourceType: 'user_input',
      confidence: 1,
      approvedById: demo._id,
      approvedAt: new Date(),
    },
    {
      projectId: soloProject._id,
      workspaceId: workspace._id,
      createdById: demo._id,
      type: 'asset_requirement',
      title: 'Brand assets',
      content: 'Use the Inkloom-style violet palette and the shop logo.',
      status: 'draft',
      sourceType: 'user_input',
      confidence: 0.7,
    },
  ]);

  await ensureSeedStudioDemo();

  console.log('[seed] demo data created');
  console.log('[seed]   demo@readyforge.ai / demo1234 (owner)');
  console.log('[seed]   lead@readyforge.ai / demo1234 (lead)');
  console.log(`[seed]   workspace: Inkloom Marketing Team — projects: "${teamProject.title}", "${soloProject.title}"`);
  console.log(`[seed]   conflict: ${conflict.title} (assigned to lead)`);
}

if (require.main === module) {
  (async () => {
    const { connectDb, disconnectDb } = await import('./db');
    await connectDb();
    await seed();
    await disconnectDb();
    process.exit(0);
  })().catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  });
}
