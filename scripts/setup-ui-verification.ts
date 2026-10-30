/**
 * Seeds a separate, fully authorized project for browser render verification.
 * It does not modify the demo project or weaken any production control.
 *
 * Usage: npx tsx scripts/setup-ui-verification.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { connectDb, disconnectDb } from '../server/src/db';
import { User } from '../server/src/models/User';
import { Workspace } from '../server/src/models/Workspace';
import { Project } from '../server/src/models/Project';
import { Asset } from '../server/src/models/Asset';
import { ProductionContract } from '../server/src/models/ProductionContract';
import { ProjectMember } from '../server/src/models/ProjectMember';
import { EditComposition } from '../server/src/models/EditComposition';
import { config } from '../server/src/config';

const FIXTURE_DIR = path.join(config.dataDir, 'verify-render-1793350334625', 'fixtures');
const TITLE = 'UI Verification · Local Render';

async function main() {
  await connectDb();
  const user = await User.findOne({ email: 'demo@readyforge.ai' });
  if (!user) throw new Error('Demo user not found — start the API once so the demo seed runs.');
  const workspace = await Workspace.findOne({ 'members.userId': user._id });
  if (!workspace) throw new Error('Demo workspace not found.');

  const previous = await Project.find({ title: TITLE, workspaceId: workspace._id }).select('_id');
  if (previous.length) {
    const ids = previous.map((p) => p._id);
    await Promise.all([
      ProductionContract.deleteMany({ projectId: { $in: ids } }),
      ProjectMember.deleteMany({ projectId: { $in: ids } }),
      EditComposition.deleteMany({ projectId: { $in: ids } }),
      Project.deleteMany({ _id: { $in: ids } }),
    ]);
  }
  await Asset.deleteMany({ name: { $in: ['ui-fixture-video.mp4', 'ui-fixture-audio.wav'] }, workspaceId: workspace._id });

  const project = await Project.create({
    workspaceId: workspace._id,
    createdById: user._id,
    title: TITLE,
    description: 'Isolated project used to verify the real browser editor and local FFmpeg render path.',
    projectType: 'video',
    status: 'ready',
    mode: 'solo',
    objective: 'Verify the browser editing and local rendering workflow',
    audience: 'QA reviewers',
    tone: 'Clear',
    callToAction: 'Watch the verified output',
    successMetric: 'A genuine MP4 produced from the editor UI',
    deadline: new Date(Date.now() + 86_400_000),
    budget: { amount: 1000, currency: 'INR', spent: 0, remaining: 1000 },
    currentStage: 'final',
  });

  await ProjectMember.create({
    projectId: project._id,
    userId: user._id,
    workspaceRole: workspace.members.find((m) => m.userId.toString() === user._id.toString())?.role || 'owner',
    projectRole: 'lead',
    responsibilities: ['Verification owner'],
    status: 'active',
  });

  const copy = async (source: string, target: string) => {
    await fs.copyFile(path.join(FIXTURE_DIR, source), path.join(config.upload.dir, target));
    const stat = await fs.stat(path.join(config.upload.dir, target));
    return stat.size;
  };
  const stamp = Date.now();
  const videoName = `${stamp}-ui-fixture-video.mp4`;
  const audioName = `${stamp}-ui-fixture-audio.wav`;
  const videoBytes = await copy('fixture-video.mp4', videoName);
  const audioBytes = await copy('fixture-audio.wav', audioName);

  const base = {
    workspaceId: workspace._id,
    projectId: project._id,
    uploadedById: user._id,
    licenseStatus: 'owned' as const,
    licenseType: 'Project-owned test fixture',
    allowedChannels: [],
    allowedRegions: [],
    consentRequired: false,
    consentStatus: 'not_required' as const,
    aiGenerated: false,
  };
  const video = await Asset.create({
    ...base,
    name: 'ui-fixture-video.mp4',
    type: 'video',
    fileUrl: `/uploads/${videoName}`,
    mimeType: 'video/mp4',
    sizeBytes: videoBytes,
    sourceDurationSeconds: 2,
  });
  const audio = await Asset.create({
    ...base,
    name: 'ui-fixture-audio.wav',
    type: 'audio',
    fileUrl: `/uploads/${audioName}`,
    mimeType: 'audio/wav',
    sizeBytes: audioBytes,
    sourceDurationSeconds: 2,
  });

  await ProductionContract.create({
    projectId: project._id,
    workspaceId: workspace._id,
    version: 1,
    status: 'locked',
    objective: project.objective!,
    audience: project.audience!,
    tone: project.tone!,
    keyMessage: 'A genuine local render from the browser editor',
    callToAction: project.callToAction!,
    approvedClaimIds: [],
    approvedAssetIds: [video._id, audio._id],
    brandRules: [],
    accessibilityRequirements: [],
    localisationRequirements: [],
    contentPlan: {
      outline: ['Opening'],
      script: 'A two second verification clip renders locally with FFmpeg.',
      storyboard: [
        {
          sceneNumber: 1,
          title: 'Opening',
          description: 'Verification fixture',
          durationSeconds: 2,
          status: 'approved',
        },
      ],
    },
    modelRoutingPlan: [],
    budgetLimit: project.budget.amount,
    requiredApprovals: [],
    blockers: [],
    createdById: user._id,
    approvedAt: new Date(),
  });

  console.log(JSON.stringify({
    projectId: project._id.toString(),
    workspaceId: workspace._id.toString(),
    title: project.title,
    assets: { video: video._id.toString(), audio: audio._id.toString() },
  }, null, 2));
  await disconnectDb();
}

main().catch(async (error) => {
  console.error(error);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
