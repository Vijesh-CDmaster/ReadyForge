import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Types } from 'mongoose';
import { Asset } from '../models/Asset';
import { config } from '../config';
import { VideoProviderError } from './videoProvider';

const MAX_OUTPUT_BYTES = 250 * 1024 * 1024;

export async function storeRenderedVideoOutput(params: {
  sourcePath: string;
  taskId: Types.ObjectId;
  projectId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  uploadedById: Types.ObjectId;
  durationSeconds: number;
  width: number;
  height: number;
}): Promise<Types.ObjectId> {
  if (!Number.isFinite(params.durationSeconds) || params.durationSeconds <= 0 || params.width < 1 || params.height < 1) {
    throw new VideoProviderError('Rendered output metadata is invalid.', 'validation', false);
  }
  const stat = await fs.stat(params.sourcePath);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_OUTPUT_BYTES) {
    throw new VideoProviderError('Rendered output is empty or exceeds the size limit.', 'validation', false);
  }
  const fileName = `rendered-${params.taskId.toString()}-${crypto.randomUUID()}.mp4`;
  const filePath = path.resolve(config.upload.dir, fileName);
  await fs.mkdir(config.upload.dir, { recursive: true });
  try {
    await fs.copyFile(params.sourcePath, filePath, fs.constants.COPYFILE_EXCL);
    const asset = await Asset.create({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      uploadedById: params.uploadedById,
      name: fileName,
      type: 'video',
      fileUrl: `/uploads/${fileName}`,
      mimeType: 'video/mp4',
      sizeBytes: stat.size,
      sourceDurationSeconds: params.durationSeconds,
      licenseStatus: 'owned',
      aiGenerated: true,
    });
    return asset._id;
  } catch (error) {
    await fs.rm(filePath, { force: true });
    throw error;
  }
}

async function readBounded(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_OUTPUT_BYTES) {
    throw new VideoProviderError('Provider output exceeds the size limit.', 'validation', false);
  }
  if (!response.body) throw new VideoProviderError('Provider output was empty.', 'validation', false);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_OUTPUT_BYTES) {
        await reader.cancel();
        throw new VideoProviderError('Provider output exceeds the size limit.', 'validation', false);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function downloadAndStoreVideoOutput(params: {
  taskId: Types.ObjectId;
  projectId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  uploadedById: Types.ObjectId;
  outputUrl: string;
}): Promise<Types.ObjectId> {
  let response: Response;
  try {
    response = await fetch(params.outputUrl, { signal: AbortSignal.timeout(config.video.requestTimeoutMs) });
  } catch {
    throw new VideoProviderError('Provider output download failed.', 'network', true);
  }
  if (!response.ok) throw new VideoProviderError('Provider output download failed.', 'provider', true);
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType && contentType !== 'video/mp4' && contentType !== 'application/octet-stream') {
    throw new VideoProviderError('Provider output MIME type is not an allowed MP4 type.', 'validation', false);
  }
  const bytes = await readBounded(response);
  if (
    bytes.length < 12 ||
    bytes.subarray(4, 8).toString('ascii') !== 'ftyp' ||
    !bytes.subarray(8, 12).toString('ascii').match(/^(isom|iso[0-9]|mp4|avc[0-9]|M4V )$/)
  ) {
    throw new VideoProviderError('Provider output is not a valid MP4 file.', 'validation', false);
  }

  const fileName = `generated-${params.taskId.toString()}-${crypto.randomUUID()}.mp4`;
  const filePath = path.resolve(config.upload.dir, fileName);
  await fs.mkdir(config.upload.dir, { recursive: true });
  try {
    await fs.writeFile(filePath, bytes, { flag: 'wx' });
    const asset = await Asset.create({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      uploadedById: params.uploadedById,
      name: fileName,
      type: 'video',
      fileUrl: `/uploads/${fileName}`,
      mimeType: 'video/mp4',
      sizeBytes: bytes.length,
      licenseStatus: 'owned',
      aiGenerated: true,
    });
    return asset._id;
  } catch (error) {
    await fs.rm(filePath, { force: true });
    throw error;
  }
}

export async function removeStoredVideoAsset(assetId: Types.ObjectId): Promise<void> {
  const asset = await Asset.findOne({ _id: assetId, aiGenerated: true, type: 'video' });
  if (!asset) return;
  const fileName = path.basename(asset.fileUrl.replace(/^\/uploads\//, ''));
  const filePath = path.resolve(config.upload.dir, fileName);
  const uploadRoot = path.resolve(config.upload.dir);
  if (filePath === uploadRoot || !filePath.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new Error('Stored video asset path is invalid.');
  }
  await fs.rm(filePath, { force: true });
  await Asset.deleteOne({ _id: asset._id });
}
