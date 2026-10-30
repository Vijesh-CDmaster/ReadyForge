import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { connectTestDb, disconnectTestDb } from './helpers/db';
import { config } from '../config';
import { ensureStudioDemo, STUDIO_DEMO, StudioDemoSummary } from '../demoStudio';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { Project } from '../models/Project';
import { ProjectMember } from '../models/ProjectMember';
import { KnowledgeInput } from '../models/KnowledgeInput';
import { Conflict } from '../models/Conflict';
import { Asset } from '../models/Asset';
import { ProductionContract } from '../models/ProductionContract';
import { EditComposition } from '../models/EditComposition';
import { probeMediaFile } from '../services/ffmpegTools';
import { computeReadiness } from '../engines/readiness';
import { computeCostAtRisk } from '../engines/costAtRisk';
import type { IProject } from '../models/Project';
import type { IProductionContract } from '../models/ProductionContract';

const mediaDir = path.join(config.dataDir, 'test-studio', `${Date.now()}-${Math.round(Math.random() * 1e6)}`);
const bundledFfprobe = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'tools',
  'ffmpeg',
  'bin',
  process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
);

let first: StudioDemoSummary;

beforeAll(async () => {
  await connectTestDb();
  first = await ensureStudioDemo({ mediaDir, silent: true });
}, 60_000);

afterAll(async () => {
  await disconnectTestDb();
  await fsp.rm(mediaDir, { recursive: true, force: true });
});

describe('Studio Demo seed', () => {
  it('creates one coherent, render-authorized demo project', async () => {
    expect(first.skipped).toBe(false);
    expect(first.authorized).toBe(true);
    expect(first.blockers).toEqual([]);
    expect(first.readinessScore).toBe(100);
    expect(first.media).toEqual({ generated: 3, reused: 0 });
    expect(first.counts).toMatchObject({
      inputsApproved: 11,
      inputsRejected: 1,
      conflictsResolved: 1,
      assets: 3,
      tracks: 3,
      clips: 4,
    });

    const demo = await User.findOne({ email: STUDIO_DEMO.demoEmail });
    const lead = await User.findOne({ email: STUDIO_DEMO.leadEmail });
    expect(demo).not.toBeNull();
    expect(lead).not.toBeNull();

    const workspace = await Workspace.findOne({ name: STUDIO_DEMO.workspaceName, ownerId: demo!._id });
    expect(workspace).not.toBeNull();
    expect(workspace!.members.filter((member) => member.status === 'active').length).toBeGreaterThanOrEqual(2);

    const project = await Project.findOne({ workspaceId: workspace!._id, title: STUDIO_DEMO.projectTitle });
    expect(project).not.toBeNull();
    expect(project!.projectType).toBe('video');
    expect(project!.status).toBe('ready');
    expect(project!.currentStage).toBe('final');
    expect(project!.budget.amount).toBe(STUDIO_DEMO.budgetAmount);
    expect(project!.deadline).toBeInstanceOf(Date);
    expect(project!.readinessScore).toBe(first.readinessScore);
    expect(project!.readinessScore).toBeGreaterThan(0);

    const members = await ProjectMember.find({ projectId: project!._id });
    expect(members.map((member) => member.projectRole).sort()).toEqual(['lead', 'owner']);

    const approved = await KnowledgeInput.find({ projectId: project!._id, status: 'approved' });
    const rejected = await KnowledgeInput.find({ projectId: project!._id, status: 'rejected' });
    expect(approved.length).toBe(11);
    expect(rejected.length).toBe(1);
    expect(approved.filter((input) => input.type === 'audience')).toHaveLength(1);
    expect(approved.filter((input) => input.type === 'goal').length).toBeGreaterThanOrEqual(1);
    expect(approved.filter((input) => input.type === 'fact').length).toBeGreaterThanOrEqual(1);

    const conflicts = await Conflict.find({ projectId: project!._id });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].status).toBe('resolved');
    expect(conflicts[0].resolution).toBeTruthy();
    expect(conflicts[0].resolvedById?.toString()).toBe(demo!._id.toString());

    const assets = await Asset.find({ projectId: project!._id });
    expect(assets).toHaveLength(3);
    for (const asset of assets) {
      expect(asset.licenseStatus).toBe('owned');
      expect(asset.licenseOwner).toBe('ReadyForge Studio');
      expect(asset.sourceDurationSeconds).toBeGreaterThan(0);
      const stored = path.join(mediaDir, path.basename(asset.fileUrl));
      expect(fs.existsSync(stored)).toBe(true);
      expect(fs.statSync(stored).size).toBeGreaterThan(1_000);
    }

    const contract = await ProductionContract.findOne({ projectId: project!._id });
    expect(contract).not.toBeNull();
    expect(contract!.status).toBe('locked');
    expect(contract!.version).toBe(1);
    expect(contract!.contentPlan.script.trim().length).toBeGreaterThan(0);
    expect(contract!.contentPlan.storyboard.length).toBeGreaterThanOrEqual(3);
    expect(contract!.requiredApprovals.length).toBeGreaterThanOrEqual(2);
    expect(contract!.requiredApprovals.every((approval) => approval.status === 'approved')).toBe(true);
    expect(contract!.approvedAssetIds).toHaveLength(3);

    const composition = await EditComposition.findOne({ projectId: project!._id });
    expect(composition).not.toBeNull();
    expect(composition!.schemaVersion).toBe(2);
    expect(composition!.tracks).toHaveLength(3);
    expect(composition!.clips).toHaveLength(4);
    expect(composition!.tracks.map((track) => track.order)).toEqual([0, 1, 2]);
    const videoClips = composition!.clips.filter((clip) => clip.trackType === 'video');
    expect(videoClips).toHaveLength(2);
    expect(videoClips[1].transitionIn?.type).toBe('fade-black');
    expect(composition!.clips.some((clip) => clip.trackType === 'audio')).toBe(true);
    expect(composition!.clips.some((clip) => clip.trackType === 'text' && clip.text?.content.includes('AURORA'))).toBe(true);

    const readiness = computeReadiness({
      project: project!.toObject() as unknown as IProject,
      inputs: approved,
      conflicts,
      assets,
      contract: contract!.toObject() as unknown as IProductionContract,
      requiredStage: 'final',
    });
    expect(readiness.productionAuthorization.authorized).toBe(true);
    expect(readiness.score).toBe(100);

    // Readiness and Cost-at-Risk must quote the same price for the same
    // project and stage, and the stage-price correction must not shift the
    // demo's authorization or score.
    const cost = computeCostAtRisk({
      project: project!.toObject() as unknown as IProject,
      inputs: approved,
      conflicts,
      assets,
    });
    expect(cost.plannedCost).toBe(1000);
    expect(readiness.categories.find((category) => category.key === 'budget')?.reason).toBe(
      'Remaining 5000 covers planned 1000'
    );
  });

  it('generates FFmpeg/FFprobe-compatible media fixtures', async () => {
    expect(first.skipped).toBe(false);
    const assets = await Asset.find({ projectId: first.projectId });
    const ffprobePath = fs.existsSync(bundledFfprobe) ? bundledFfprobe : config.video.ffprobePath;

    for (const asset of assets) {
      const stored = path.join(mediaDir, path.basename(asset.fileUrl));
      const info = await probeMediaFile(stored, { ffprobePath });
      expect(info, `${asset.name} must be probeable`).not.toBeNull();
      expect(info!.durationSeconds).toBeGreaterThan(2);
      if (asset.type === 'video') {
        expect(info!.hasVideo).toBe(true);
        expect(info!.width).toBe(1280);
        expect(info!.height).toBe(720);
      }
      if (asset.type === 'audio') {
        expect(info!.hasAudio).toBe(true);
      }
    }
  });

  it('is idempotent: repeated runs reuse every entity and preserve the composition revision', async () => {
    const projectBefore = await Project.findOne({ title: STUDIO_DEMO.projectTitle });
    const compositionBefore = await EditComposition.findOne({ projectId: projectBefore!._id });
    const countsBefore = {
      users: await User.countDocuments(),
      workspaces: await Workspace.countDocuments(),
      projects: await Project.countDocuments(),
      inputs: await KnowledgeInput.countDocuments(),
      conflicts: await Conflict.countDocuments(),
      assets: await Asset.countDocuments(),
      contracts: await ProductionContract.countDocuments(),
      compositions: await EditComposition.countDocuments(),
    };
    const revisionBefore = compositionBefore!.__v;

    const second = await ensureStudioDemo({ mediaDir, silent: true });

    expect(second.skipped).toBe(false);
    expect(second.authorized).toBe(true);
    expect(second.created).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.projectId).toBe(first.projectId);
    expect(second.compositionId).toBe(first.compositionId);
    expect(second.contractId).toBe(first.contractId);
    expect(second.media).toEqual({ generated: 0, reused: 3 });

    expect({
      users: await User.countDocuments(),
      workspaces: await Workspace.countDocuments(),
      projects: await Project.countDocuments(),
      inputs: await KnowledgeInput.countDocuments(),
      conflicts: await Conflict.countDocuments(),
      assets: await Asset.countDocuments(),
      contracts: await ProductionContract.countDocuments(),
      compositions: await EditComposition.countDocuments(),
    }).toEqual(countsBefore);

    const compositionAfter = await EditComposition.findOne({ projectId: projectBefore!._id });
    expect(compositionAfter!.__v).toBe(revisionBefore);
  });

  it('refuses to run in production', async () => {
    const previous = config.isProd;
    (config as { isProd: boolean }).isProd = true;
    try {
      await expect(ensureStudioDemo({ mediaDir, silent: true })).rejects.toThrow(/production/i);
    } finally {
      (config as { isProd: boolean }).isProd = previous;
    }
  });
});
