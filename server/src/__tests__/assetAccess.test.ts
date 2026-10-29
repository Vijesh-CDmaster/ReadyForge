import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createApp } from '../index';
import { config } from '../config';
import { Asset } from '../models/Asset';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { signAccessToken } from '../middleware/auth';
import { connectTestDb, disconnectTestDb, clearDb } from './helpers/db';

let server: http.Server;
let baseUrl: string;

async function request(path: string, token?: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

beforeAll(async () => {
  await connectTestDb();
  server = createApp().listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearDb();
  await fs.mkdir(config.upload.dir, { recursive: true });
});

describe('protected asset files', () => {
  it('requires authentication and allows an authorized project member to preview an asset', async () => {
    const user = await User.create({
      name: 'Asset Owner',
      email: `asset-owner-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash('test-password', 4),
    });
    const workspace = await Workspace.create({
      name: 'Asset Workspace',
      ownerId: user._id,
      members: [{ userId: user._id, role: 'owner', status: 'active' }],
    });
    const project = await Project.create({
      workspaceId: workspace._id,
      createdById: user._id,
      title: 'Asset Project',
      projectType: 'video',
    });
    const form = new FormData();
    form.append('file', new Blob(['private asset'], { type: 'text/plain' }), 'private.txt');
    form.append('projectId', project._id.toString());
    const upload = await fetch(`${baseUrl}/api/assets/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${signAccessToken(user)}` },
      body: form,
    });
    expect(upload.status).toBe(201);
    const uploaded = (await upload.json()) as { asset: { id: string; fileUrl: string } };
    const asset = await Asset.findById(uploaded.asset.id);
    if (!asset) throw new Error('Uploaded asset was not persisted');

    const unauthenticated = await request(`/api/assets/${asset._id}/file`);
    expect(unauthenticated.status).toBe(401);

    const authorized = await request(`/api/assets/${asset._id}/file`, signAccessToken(user));
    expect(authorized.status).toBe(200);
    expect(await authorized.text()).toBe('private asset');
    expect(authorized.headers.get('cache-control')).toContain('private');

    const direct = await request(asset.fileUrl);
    expect(direct.status).toBe(404);
    await fs.rm(`${config.upload.dir}\\${asset.fileUrl.split('/').pop()}`, { force: true });
  });

  it('hides assets from users outside the workspace and rejects invalid or traversal identifiers', async () => {
    const owner = await User.create({
      name: 'Owner',
      email: `asset-owner-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash('test-password', 4),
    });
    const outsider = await User.create({
      name: 'Outsider',
      email: `asset-outsider-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash('test-password', 4),
    });
    const workspace = await Workspace.create({
      name: 'Private Workspace',
      ownerId: owner._id,
      members: [{ userId: owner._id, role: 'owner', status: 'active' }],
    });
    const project = await Project.create({
      workspaceId: workspace._id,
      createdById: owner._id,
      title: 'Private Project',
      projectType: 'video',
    });
    const fileName = `asset-traversal-${Date.now()}.txt`;
    await fs.writeFile(`${config.upload.dir}\\${fileName}`, 'private asset');
    const asset = await Asset.create({
      workspaceId: workspace._id,
      projectId: project._id,
      uploadedById: owner._id,
      name: 'Private asset',
      type: 'document',
      fileUrl: `/uploads/${fileName}`,
      mimeType: 'text/plain',
    });

    const denied = await request(`/api/assets/${asset._id}/file`, signAccessToken(outsider));
    expect(denied.status).toBe(404);

    const invalid = await request('/api/assets/not-an-id/file', signAccessToken(owner));
    expect(invalid.status).toBe(404);

    asset.fileUrl = '/uploads/../server/.env';
    await asset.save();
    const traversal = await request(`/api/assets/${asset._id}/file`, signAccessToken(owner));
    expect(traversal.status).toBe(404);

    await fs.rm(`${config.upload.dir}\\${fileName}`, { force: true });
  });
});
