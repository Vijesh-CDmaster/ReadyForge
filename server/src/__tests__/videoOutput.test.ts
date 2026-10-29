import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { Asset } from '../models/Asset';
import { downloadAndStoreVideoOutput } from '../services/videoOutput';
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
});
