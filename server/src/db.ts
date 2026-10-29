import mongoose from 'mongoose';
import fs from 'node:fs';
import { config } from './config';

let memoryServer: import('mongodb-memory-server').MongoMemoryServer | null = null;

export async function connectDb(): Promise<void> {
  let uri = config.mongoUri;

  if (!uri) {
    if (config.isProd) {
      throw new Error('MONGODB_URI must be set in production. Refusing to use the local database fallback.');
    }
    // Local/dev: start a persistent in-memory MongoDB stored under server/.data
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const dbPath = `${config.dataDir}/mongo`;
    fs.mkdirSync(dbPath, { recursive: true });
    memoryServer = await MongoMemoryServer.create({
      instance: { dbPath, storageEngine: 'wiredTiger' },
    });
    uri = memoryServer.getUri('readyforge');
    console.log(`[db] MONGODB_URI not set — using local MongoDB at ${dbPath}`);
    if (config.isProd) {
      console.warn(
        '[db] WARNING: running in production without MONGODB_URI — data lives in a local '
          + 'fallback store and will not survive a redeploy. Set MONGODB_URI for production.'
      );
    }
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  console.log('[db] connected');
}

export function isDbReady(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}
