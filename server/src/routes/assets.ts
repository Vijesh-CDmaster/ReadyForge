import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { z } from 'zod';
import { Asset, IAsset, LICENSE_STATUSES } from '../models/Asset';
import { Project } from '../models/Project';
import { Workspace } from '../models/Workspace';
import { requireAuth, requireProject, AuthedRequest } from '../middleware/auth';
import { asyncHandler, validateBody, ApiError } from '../http';
import { audit, clientIp } from '../audit';
import { config } from '../config';

export const assetsRouter = Router();
assetsRouter.use(requireAuth);

fs.mkdirSync(config.upload.dir, { recursive: true });

const ALLOWED: Record<string, string> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/svg+xml': 'logo',
  'video/mp4': 'video',
  'video/webm': 'video',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'audio/ogg': 'audio',
  'font/ttf': 'font',
  'font/woff': 'font',
  'font/woff2': 'font',
  'application/pdf': 'document',
  'text/plain': 'document',
  'text/markdown': 'document',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.upload.dir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED[file.mimetype]) {
      return cb(new ApiError(415, `File type ${file.mimetype} is not allowed`) as unknown as Error);
    }
    cb(null, true);
  },
});

function serialize(a: IAsset) {
  return {
    id: a._id.toString(),
    projectId: a.projectId?.toString() || null,
    name: a.name,
    type: a.type,
    fileUrl: a.fileUrl,
    thumbnailUrl: a.thumbnailUrl,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    licenseStatus: a.licenseStatus,
    licenseType: a.licenseType,
    licenseOwner: a.licenseOwner,
    licenseExpiry: a.licenseExpiry,
    allowedChannels: a.allowedChannels,
    allowedRegions: a.allowedRegions,
    consentRequired: a.consentRequired,
    consentStatus: a.consentStatus,
    aiGenerated: a.aiGenerated,
    uploadedById: a.uploadedById.toString(),
    createdAt: a.createdAt,
  };
}

async function assertWorkspaceRole(req: AuthedRequest, workspaceId: unknown, roles: string[]): Promise<void> {
  const ws = await Workspace.findById(workspaceId);
  if (!ws) throw new ApiError(404, 'Workspace not found');
  const m = ws.members.find((x) => x.userId.toString() === req.user!._id.toString() && x.status === 'active');
  if (!m && req.user!.platformRole !== 'admin') throw new ApiError(403, 'Not a member of this workspace');
  if (m && m.role !== 'owner' && !roles.includes(m.role)) {
    throw new ApiError(403, `Requires one of roles: ${roles.join(', ')}`);
  }
}

/* upload */
assetsRouter.post(
  '/assets/upload',
  upload.single('file'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const file = req.file;
    if (!file) throw new ApiError(400, 'No file uploaded');

    const projectId = String(req.body.projectId || '');
    const project = projectId ? await Project.findById(projectId) : null;
    if (projectId && !project) {
      fs.unlink(file.path, () => undefined);
      throw new ApiError(404, 'Project not found');
    }
    const workspaceId = project?.workspaceId || req.body.workspaceId;
    if (!workspaceId) {
      fs.unlink(file.path, () => undefined);
      throw new ApiError(400, 'workspaceId or projectId is required');
    }

    try {
      await assertWorkspaceRole(req, workspaceId, ['designer', 'lead', 'writer', 'legal_reviewer']);
    } catch (err) {
      fs.unlink(file.path, () => undefined);
      throw err;
    }

    const type = (ALLOWED[file.mimetype] || 'other') as IAsset['type'];
    const asset = await Asset.create({
      workspaceId,
      projectId: project?._id,
      uploadedById: req.user!._id,
      name: req.body.name || file.originalname,
      type,
      fileUrl: `/uploads/${file.filename}`,
      thumbnailUrl: type === 'image' || type === 'logo' ? `/uploads/${file.filename}` : '',
      mimeType: file.mimetype,
      sizeBytes: file.size,
      licenseStatus: LICENSE_STATUSES.includes(req.body.licenseStatus) ? req.body.licenseStatus : 'unknown',
    });

    audit({
      workspaceId: String(workspaceId),
      projectId: project?._id.toString(),
      actorId: req.user!._id.toString(),
      action: 'asset.upload',
      entityType: 'asset',
      entityId: asset._id.toString(),
      after: { name: asset.name, type: asset.type, sizeBytes: asset.sizeBytes, licenseStatus: asset.licenseStatus },
      ipAddress: clientIp(req),
    });

    res.status(201).json({ asset: serialize(asset) });
  })
);

/* list by project */
assetsRouter.get(
  '/projects/:id/assets',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const list = await Asset.find({ projectId: req.project!._id }).sort('-createdAt');
    res.json(list.map(serialize));
  })
);

/* update metadata */
const patchSchema = z.object({
  name: z.string().max(300).optional(),
  type: z.enum(['image', 'video', 'audio', 'font', 'logo', 'document', 'other']).optional(),
  aiGenerated: z.boolean().optional(),
  consentRequired: z.boolean().optional(),
  consentStatus: z.enum(['not_required', 'pending', 'approved', 'rejected']).optional(),
});

assetsRouter.patch(
  '/assets/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const asset = await Asset.findById(req.params.id);
    if (!asset) throw new ApiError(404, 'Asset not found');
    await assertWorkspaceRole(req, asset.workspaceId, ['designer', 'lead', 'legal_reviewer']);
    const body = validateBody(patchSchema, req.body);
    const before = { name: asset.name, consentStatus: asset.consentStatus };
    Object.assign(asset, body);
    await asset.save();
    audit({
      workspaceId: String(asset.workspaceId),
      projectId: asset.projectId?.toString(),
      actorId: req.user!._id.toString(),
      action: 'asset.update',
      entityType: 'asset',
      entityId: asset._id.toString(),
      before,
      after: body,
      ipAddress: clientIp(req),
    });
    res.json({ asset: serialize(asset) });
  })
);

/* delete */
assetsRouter.delete(
  '/assets/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const asset = await Asset.findById(req.params.id);
    if (!asset) throw new ApiError(404, 'Asset not found');
    await assertWorkspaceRole(req, asset.workspaceId, ['designer', 'lead', 'owner']);
    const fileName = path.basename(asset.fileUrl);
    const filePath = path.join(config.upload.dir, fileName);
    if (fs.existsSync(filePath)) fs.unlink(filePath, () => undefined);
    await asset.deleteOne();
    audit({
      workspaceId: String(asset.workspaceId),
      projectId: asset.projectId?.toString(),
      actorId: req.user!._id.toString(),
      action: 'asset.delete',
      entityType: 'asset',
      entityId: req.params.id,
      before: { name: asset.name },
      ipAddress: clientIp(req),
    });
    res.json({ ok: true });
  })
);

/* set licence */
const licenseSchema = z.object({
  licenseStatus: z.enum(LICENSE_STATUSES),
  licenseType: z.string().max(300).optional(),
  licenseOwner: z.string().max(300).optional(),
  licenseExpiry: z.string().datetime().nullable().optional(),
  allowedChannels: z.array(z.string().max(100)).optional(),
  allowedRegions: z.array(z.string().max(100)).optional(),
  consentRequired: z.boolean().optional(),
  consentStatus: z.enum(['not_required', 'pending', 'approved', 'rejected']).optional(),
});

assetsRouter.post(
  '/assets/:id/license',
  asyncHandler(async (req: AuthedRequest, res) => {
    const asset = await Asset.findById(req.params.id);
    if (!asset) throw new ApiError(404, 'Asset not found');
    await assertWorkspaceRole(req, asset.workspaceId, ['designer', 'lead', 'legal_reviewer', 'owner']);
    const body = validateBody(licenseSchema, req.body);

    const before = { licenseStatus: asset.licenseStatus, licenseType: asset.licenseType };
    asset.licenseStatus = body.licenseStatus;
    asset.licenseType = body.licenseType;
    asset.licenseOwner = body.licenseOwner;
    asset.licenseExpiry = body.licenseExpiry ? new Date(body.licenseExpiry) : undefined;
    if (body.allowedChannels) asset.allowedChannels = body.allowedChannels;
    if (body.allowedRegions) asset.allowedRegions = body.allowedRegions;
    if (body.consentRequired !== undefined) asset.consentRequired = body.consentRequired;
    if (body.consentStatus) asset.consentStatus = body.consentStatus;
    await asset.save();

    audit({
      workspaceId: String(asset.workspaceId),
      projectId: asset.projectId?.toString(),
      actorId: req.user!._id.toString(),
      action: 'asset.license_update',
      entityType: 'asset',
      entityId: asset._id.toString(),
      before,
      after: { licenseStatus: asset.licenseStatus, licenseType: asset.licenseType },
      ipAddress: clientIp(req),
    });

    res.json({ asset: serialize(asset) });
  })
);

/* rights verification (risk check, not legal advice) */
assetsRouter.post(
  '/assets/:id/verify-rights',
  asyncHandler(async (req: AuthedRequest, res) => {
    const asset = await Asset.findById(req.params.id);
    if (!asset) throw new ApiError(404, 'Asset not found');

    const checks: Array<{ check: string; status: 'passed' | 'warning' | 'failed'; message: string }> = [];
    const now = Date.now();

    if (asset.licenseStatus === 'owned') {
      checks.push({ check: 'license_status', status: 'passed', message: 'Asset is marked as owned.' });
    } else if (asset.licenseStatus === 'licensed') {
      checks.push({ check: 'license_status', status: 'passed', message: `Licensed (${asset.licenseType || 'type not specified'}).` });
    } else if (asset.licenseStatus === 'unknown') {
      checks.push({ check: 'license_status', status: 'failed', message: 'Licence status unknown — this asset is blocked from final generation until documented.' });
    } else if (asset.licenseStatus === 'restricted') {
      checks.push({ check: 'license_status', status: 'failed', message: 'Restricted asset — cannot be used in final generation.' });
    } else if (asset.licenseStatus === 'expired') {
      checks.push({ check: 'license_status', status: 'failed', message: 'Licence has expired — renewal required before use.' });
    }

    if (asset.licenseExpiry) {
      const days = Math.round((asset.licenseExpiry.getTime() - now) / 86_400_000);
      if (days < 0) checks.push({ check: 'expiry', status: 'failed', message: `Licence expired ${Math.abs(days)} day(s) ago.` });
      else if (days <= 30) checks.push({ check: 'expiry', status: 'warning', message: `Licence expires in ${days} day(s).` });
      else checks.push({ check: 'expiry', status: 'passed', message: `Licence valid for ${days} more days.` });
    }

    if (asset.consentRequired && asset.consentStatus !== 'approved') {
      checks.push({ check: 'consent', status: 'failed', message: `Consent required but status is "${asset.consentStatus}".` });
    } else if (asset.consentRequired) {
      checks.push({ check: 'consent', status: 'passed', message: 'Required consent is approved.' });
    }

    if (asset.aiGenerated) {
      checks.push({ check: 'ai_disclosure', status: 'warning', message: 'Asset is AI-generated and must be labelled as such.' });
    }

    const failed = checks.filter((c) => c.status === 'failed').length;
    const warned = checks.filter((c) => c.status === 'warning').length;
    const status = failed ? 'failed' : warned ? 'warning' : 'passed';

    audit({
      workspaceId: String(asset.workspaceId),
      projectId: asset.projectId?.toString(),
      actorId: req.user!._id.toString(),
      actorType: 'system',
      action: 'asset.verify_rights',
      entityType: 'asset',
      entityId: asset._id.toString(),
      after: { status },
      ipAddress: clientIp(req),
    });

    res.json({
      status,
      checks,
      disclaimer: 'This is a risk check, not legal advice.',
      assetId: asset._id.toString(),
    });
  })
);
