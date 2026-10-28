import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

/**
 * Fully isolated test database: a private mongod instance per test file run.
 * It never touches the development or production connection string.
 */
let mongod: MongoMemoryServer | null = null;

export async function connectTestDb(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('readyforge_test'));
}

export async function disconnectTestDb(): Promise<void> {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
}

export async function clearDb(): Promise<void> {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((c) => c.deleteMany({})));
}