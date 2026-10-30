/**
 * Throwaway self-test for seed(): runs against a fresh in-memory MongoDB so
 * Atlas is never touched. Delete after use, or keep for manual verification:
 *   npx tsx seed-selftest.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

async function main() {
  const mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('readyforge_seed_selftest'));

  const { seed } = await import('./src/seed');
  await seed();

  const { User } = await import('./src/models/User');
  const { Workspace } = await import('./src/models/Workspace');
  const { Project } = await import('./src/models/Project');
  const { KnowledgeInput } = await import('./src/models/KnowledgeInput');
  const { Conflict } = await import('./src/models/Conflict');
  const { Asset } = await import('./src/models/Asset');
  const { ProductionContract } = await import('./src/models/ProductionContract');
  const { GenerationTask } = await import('./src/models/GenerationTask');
  const { VerificationReport } = await import('./src/models/VerificationReport');
  const { Review } = await import('./src/models/Review');

  const [users, workspaces, projects, inputs, conflicts, assets, contracts, tasks, reports, reviews] =
    await Promise.all([
      User.countDocuments(),
      Workspace.countDocuments(),
      Project.countDocuments(),
      KnowledgeInput.countDocuments(),
      Conflict.countDocuments(),
      Asset.countDocuments(),
      ProductionContract.countDocuments(),
      GenerationTask.countDocuments(),
      VerificationReport.countDocuments(),
      Review.countDocuments(),
    ]);

  const contract = await ProductionContract.findOne({ status: 'approved' });
  const checks = (await VerificationReport.findOne({}))?.checks.map((c) => c.checkType) ?? [];

  const expected = { users: 2, workspaces: 2, projects: 3, inputs: 24, conflicts: 2, assets: 6, contracts: 2, tasks: 2, reports: 1, reviews: 2 };
  const actual = { users, workspaces, projects, inputs, conflicts, assets, contracts, tasks, reports, reviews };

  let failed = 0;
  for (const [k, v] of Object.entries(expected)) {
    const got = (actual as Record<string, number>)[k];
    const ok = got === v;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${k}: expected ${v}, got ${got}`);
  }

  const contractOk = contract && contract.approvedAssetIds.length === 2 && contract.approvedClaimIds.length > 0;
  console.log(`${contractOk ? 'PASS' : 'FAIL'} contract approved with 2 cleared assets + claims`);
  if (!contractOk) failed++;

  const checksOk = ['claim_verification', 'intent_alignment', 'brand_fit', 'rights', 'accessibility'].every((t) => checks.includes(t as never));
  console.log(`${checksOk ? 'PASS' : 'FAIL'} verification report has all 5 checks (${checks.join(', ')})`);
  if (!checksOk) failed++;

  // Idempotency: running again must be a no-op.
  await seed();
  const contractsAfter = await ProductionContract.countDocuments();
  console.log(`${contractsAfter === 2 ? 'PASS' : 'FAIL'} seed idempotent (contracts still ${contractsAfter})`);
  if (contractsAfter !== 2) failed++;
  const studio = await ProductionContract.findOne({ status: 'locked' });
  console.log(`${studio ? 'PASS' : 'FAIL'} Studio Demo contract locked`);
  if (!studio) failed++;

  await mongoose.disconnect();
  await mem.stop();
  console.log(failed === 0 ? '\nSEED SELFTEST: ALL PASS' : `\nSEED SELFTEST: ${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});