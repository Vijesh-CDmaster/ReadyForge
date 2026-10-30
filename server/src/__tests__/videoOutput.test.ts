import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Types } from 'mongoose';
import { config } from '../config';
import { Asset } from '../models/Asset';
import { downloadAndStoreVideoOutput, storeRenderedVideoOutput } from '../services/videoOutput';
import { connectTestDb, disconnectTestDb, clearDb } from './helpers/db';

const ids = () => ({
  taskId: new Types.ObjectId(),
  projectId: new Types.ObjectId(),
  workspaceId: new Types.ObjectId(),
  uploadedById: new Types.ObjectId(),
});

beforeAll(async () => connectTestDb());
afterEach(async () => {
  vi.restoreAllMocks();
  await clearDb();
});
afterAll(async () => disconnectTestDb());

describe('protected video output storage', () => {
  it('rejects a response that is not an MP4', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(Buffer.from('not-video'), { status: 200 })
    ));
    await expect(downloadAndStoreVideoOutput({ ...ids(), outputUrl: 'https://provider.invalid/output' }))
      .rejects.toMatchObject({ kind: 'validation' });
  });

  it('rejects a provider MIME type that is not an allowed video type', async () => {
    const bytes = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('ftypisom'), Buffer.alloc(32)]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(bytes, { status: 200, headers: { 'content-type': 'text/html' } })
    ));
    await expect(downloadAndStoreVideoOutput({ ...ids(), outputUrl: 'https://provider.invalid/output' }))
      .rejects.toMatchObject({ kind: 'validation' });
  });

  it('stores valid MP4 output as an owned generated asset', async () => {
    const bytes = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('ftypisom'), Buffer.alloc(32)]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } })
    ));
    const created = await downloadAndStoreVideoOutput({ ...ids(), outputUrl: 'https://provider.invalid/output' });
    const asset = await Asset.findById(created);
    expect(asset).toMatchObject({ type: 'video', mimeType: 'video/mp4', licenseStatus: 'owned', aiGenerated: true });
  });

  it('stores a locally rendered MP4 through the same protected asset system', async () => {
    const identifiers = ids();
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.mkdir(config.upload.dir, { recursive: true });
    const sourcePath = path.join(config.dataDir, `render-source-${identifiers.taskId}.mp4`);
    await fs.writeFile(sourcePath, Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('ftypisom'), Buffer.alloc(64)]));

    const created = await storeRenderedVideoOutput({
      sourcePath,
      ...identifiers,
      durationSeconds: 4,
      width: 1280,
      height: 720,
    });
    const asset = await Asset.findById(created);
    expect(asset).toMatchObject({
      projectId: identifiers.projectId,
      workspaceId: identifiers.workspaceId,
      type: 'video',
      mimeType: 'video/mp4',
      sourceDurationSeconds: 4,
      licenseStatus: 'owned',
      aiGenerated: true,
    });
    if (!asset) throw new Error('Rendered asset was not persisted');
    const storedPath = path.join(config.upload.dir, path.basename(asset.fileUrl));
    expect((await fs.stat(storedPath)).size).toBeGreaterThan(0);

    await fs.rm(storedPath, { force: true });
    await fs.rm(sourcePath, { force: true });
  });

  it('rejects invalid rendered metadata before creating an asset', async () => {
    const identifiers = ids();
    await expect(
      storeRenderedVideoOutput({
        sourcePath: path.join(config.dataDir, 'missing.mp4'),
        ...identifiers,
        durationSeconds: 0,
        width: 1280,
        height: 720,
      })
    ).rejects.toMatchObject({ kind: 'validation' });
    expect(await Asset.countDocuments({ projectId: identifiers.projectId })).toBe(0);
  });
});
