import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import http from 'node:http';
import { Types } from 'mongoose';
import { createApp } from '../index';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { Project } from '../models/Project';
import { ProductionContract } from '../models/ProductionContract';
import { GenerationTask } from '../models/GenerationTask';
import { Asset } from '../models/Asset';
import { Conflict } from '../models/Conflict';
import { BudgetReservation } from '../models/BudgetReservation';
import { signAccessToken } from '../middleware/auth';
import { processRealProviderJob, revalidateVideoJobAuthorization, submitVideoJob, VideoJobWorker } from '../services/videoJobs';
import { evaluateProductionAuthorization } from '../services/productionAuthorization';
import { VideoProvider, VideoProviderError } from '../services/videoProvider';
import { connectTestDb, disconnectTestDb, clearDb } from './helpers/db';

let server: http.Server;
let baseUrl: string;

async function setup() {
  const user = await User.create({
    name: 'Video Owner',
    email: `video-${Date.now()}-${Math.random()}@example.com`,
    passwordHash: await bcrypt.hash('test-password', 4),
  });
  const workspace = await Workspace.create({
    name: 'Video Workspace',
    ownerId: user._id,
    members: [{ userId: user._id, role: 'owner', status: 'active' }],
  });
  const project = await Project.create({
    workspaceId: workspace._id,
    createdById: user._id,
    title: 'Mock Video Project',
    description: 'Authorized mock video project',
    projectType: 'video',
    status: 'draft',
    mode: 'solo',
    objective: 'Demonstrate the project',
    audience: 'Test viewers',
    tone: 'Clear',
    callToAction: 'Watch now',
    deadline: new Date(Date.now() + 86400_000),
    currentStage: 'final',
    budget: { amount: 100, currency: 'INR', spent: 0, remaining: 100 },
  });
  const contract = await ProductionContract.create({
    projectId: project._id,
    workspaceId: workspace._id,
    createdById: user._id,
    status: 'locked',
    version: 3,
    objective: 'Test',
    audience: 'Test viewers',
    tone: 'Clear',
    keyMessage: 'A valid production contract',
    callToAction: 'Watch now',
    contentPlan: {
      outline: ['Opening'],
      script: 'A complete production script.',
      storyboard: [{ sceneNumber: 1, title: 'Opening', description: 'Opening shot', durationSeconds: 5, status: 'approved' }],
    },
  });
  return { user, workspace, project, contract };
}

async function waitForStatus(id: Types.ObjectId, status: string, timeout = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const task = await GenerationTask.findById(id);
    if (task?.status === status) return task;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${status}`);
}

function fakeProvider(onSubmit: () => void): VideoProvider {
  return {
    id: 'fake',
    async estimateCost() {
      return { amount: 0, currency: 'INR' };
    },
    async submit() {
      onSubmit();
      return { providerJobId: 'fake-job', status: 'submitted', estimatedCost: 0, currency: 'INR' };
    },
    async getStatus() {
      return {
        providerJobId: 'fake-job',
        status: 'failed',
        error: new VideoProviderError('Fake provider failure', 'provider', false),
      };
    },
  };
}

async function attachReservation(
  task: InstanceType<typeof GenerationTask>,
  project: InstanceType<typeof Project>,
  options: { status?: string; amount?: number; currency?: string; projectId?: Types.ObjectId; taskId?: Types.ObjectId } = {}
) {
  const reservation = await BudgetReservation.create({
    projectId: options.projectId || project._id,
    generationTaskId: options.taskId || task._id,
    key: `video:test-${task._id.toString()}-${Math.random()}`,
    estimatedAmount: options.amount ?? task.estimatedCost,
    actualAmount: 0,
    currency: options.currency || 'INR',
    status: options.status || 'reserved',
  });
  task.budgetReservationId = reservation._id;
  task.costCurrency = options.currency || 'INR';
  await task.save();
  return reservation;
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

beforeEach(async () => clearDb());

describe('durable mock video jobs', () => {
  it('rejects final video-job submission when category evidence is missing', async () => {
    const { user, workspace, project } = await setup();
    project.description = 'Food recipe video';
    await project.save();

    await expect(
      submitVideoJob({
        projectId: project._id,
        workspaceId: workspace._id,
        userId: user._id,
        stage: 'final',
        mode: 'success',
        idempotencyKey: 'missing-food-evidence',
      })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('food_ingredients_quantities') });
  });

  it('rejects pending required contract approvals', async () => {
    const { user, workspace, project, contract } = await setup();
    contract.requiredApprovals = [{ userId: user._id, role: 'reviewer', status: 'pending' }];
    await contract.save();

    await expect(
      submitVideoJob({
        projectId: project._id,
        workspaceId: workspace._id,
        userId: user._id,
        stage: 'final',
        mode: 'success',
        idempotencyKey: 'pending-approval',
      })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('pending_contract_approvals') });
  });

  it('rejects restricted assets and high-severity conflicts for final jobs', async () => {
    const { user, workspace, project } = await setup();
    await Asset.create({
      workspaceId: workspace._id,
      projectId: project._id,
      uploadedById: user._id,
      name: 'Restricted image',
      type: 'image',
      fileUrl: '/uploads/restricted.png',
      mimeType: 'image/png',
      licenseStatus: 'restricted',
    });
    await expect(
      submitVideoJob({
        projectId: project._id,
        workspaceId: workspace._id,
        userId: user._id,
        stage: 'final',
        mode: 'success',
        idempotencyKey: 'restricted-asset',
      })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('unlicensed_asset') });

    await Asset.deleteMany({ projectId: project._id });
    await Conflict.create({
      projectId: project._id,
      workspaceId: workspace._id,
      title: 'Unresolved final conflict',
      description: 'The final claim is disputed.',
      severity: 'critical',
      status: 'open',
      conflictType: 'factual',
      detectedBy: 'system',
    });
    await expect(
      submitVideoJob({
        projectId: project._id,
        workspaceId: workspace._id,
        userId: user._id,
        stage: 'final',
        mode: 'success',
        idempotencyKey: 'critical-conflict',
      })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('critical_conflict') });
  });

  it('does not block concept authorization with final-stage category evidence', async () => {
    const { user, workspace, project, contract } = await setup();
    project.currentStage = 'concept';
    project.description = 'Food recipe concept';
    await project.save();
    await Asset.create({
      workspaceId: workspace._id,
      projectId: project._id,
      uploadedById: user._id,
      name: 'Concept reference',
      type: 'image',
      fileUrl: '/uploads/concept.png',
      mimeType: 'image/png',
      licenseStatus: 'restricted',
    });
    const authorization = evaluateProductionAuthorization({
      project,
      inputs: [],
      conflicts: [],
      assets: await Asset.find({ projectId: project._id }),
      contract,
      stage: 'concept',
    });
    expect(authorization.authorized).toBe(true);
  });

  it('rejects invalid real-provider worker evidence before provider submission', async () => {
    const { user, workspace, project, contract } = await setup();
    const expired = await Asset.create({
      workspaceId: workspace._id,
      projectId: project._id,
      uploadedById: user._id,
      name: 'Expired worker asset',
      type: 'image',
      fileUrl: '/uploads/expired-boundary.png',
      mimeType: 'image/png',
      licenseStatus: 'expired',
    });
    const task = await GenerationTask.create({
      projectId: project._id,
      workspaceId: workspace._id,
      contractId: contract._id,
      contractVersion: contract.version,
      createdById: user._id,
      taskType: 'final',
      stage: 'final',
      status: 'running',
      leaseId: 'boundary-worker',
      leaseExpiresAt: new Date(Date.now() + 30_000),
      idempotencyKey: 'boundary-invalid',
    });
    await attachReservation(task, project);
    let submitCalls = 0;
    const provider = fakeProvider(() => {
      submitCalls += 1;
    });

    await expect(processRealProviderJob(task, project, contract, 'boundary-worker', provider)).rejects.toMatchObject({
      kind: 'validation',
    });
    expect(submitCalls).toBe(0);
    await expired.deleteOne();
  });

  it('rejects a queued job when the current budget no longer covers its stored estimate', async () => {
    const { user, workspace, project, contract } = await setup();
    const task = await GenerationTask.create({
      projectId: project._id,
      workspaceId: workspace._id,
      contractId: contract._id,
      contractVersion: contract.version,
      createdById: user._id,
      taskType: 'final',
      stage: 'final',
      status: 'running',
      leaseId: 'budget-invalid',
      leaseExpiresAt: new Date(Date.now() + 30_000),
      idempotencyKey: 'budget-invalid',
      estimatedCost: 20,
      costCurrency: 'INR',
    });
    const reservation = await BudgetReservation.create({
      projectId: project._id,
      generationTaskId: task._id,
      key: 'video:budget-invalid',
      estimatedAmount: 20,
      actualAmount: 0,
      currency: 'INR',
      status: 'reserved',
    });
    task.budgetReservationId = reservation._id;
    await task.save();
    project.budget.amount = 10;
    project.budget.spent = 10;
    project.budget.remaining = 0;
    await project.save();

    let submitCalls = 0;
    const provider = fakeProvider(() => {
      submitCalls += 1;
    });
    await expect(processRealProviderJob(task, project, contract, 'budget-invalid', provider)).rejects.toMatchObject({
      kind: 'validation',
      message: expect.stringContaining('budget_exceeded'),
    });
    expect(submitCalls).toBe(0);
  });

  it('allows a queued job to reach the provider when its reserved estimate remains funded', async () => {
    const { user, workspace, project, contract } = await setup();
    const task = await GenerationTask.create({
      projectId: project._id,
      workspaceId: workspace._id,
      contractId: contract._id,
      contractVersion: contract.version,
      createdById: user._id,
      taskType: 'final',
      stage: 'final',
      status: 'running',
      leaseId: 'budget-valid',
      leaseExpiresAt: new Date(Date.now() + 30_000),
      idempotencyKey: 'budget-valid',
      estimatedCost: 20,
      costCurrency: 'INR',
    });
    const reservation = await BudgetReservation.create({
      projectId: project._id,
      generationTaskId: task._id,
      key: 'video:budget-valid',
      estimatedAmount: 20,
      actualAmount: 0,
      currency: 'INR',
      status: 'reserved',
    });
    task.budgetReservationId = reservation._id;
    await task.save();
    project.budget.spent = 20;
    project.budget.remaining = 80;
    await project.save();

    let submitCalls = 0;
    const provider = fakeProvider(() => {
      submitCalls += 1;
    });
    await expect(processRealProviderJob(task, project, contract, 'budget-valid', provider)).rejects.toMatchObject({
      kind: 'provider',
    });
    expect(submitCalls).toBe(1);
  });

  it.each([
    ['pending', 'pending'],
    ['settling', 'settling'],
    ['settled', 'settled'],
    ['refunding', 'refunding'],
    ['refunded', 'refunded'],
    ['manual_review', 'manual_review'],
    ['released', 'released'],
    ['unsupported', 'unsupported'],
  ])('fails closed for a %s reservation state', async (_label, status) => {
    const { user, workspace, project, contract } = await setup();
    const task = await GenerationTask.create({
      projectId: project._id,
      workspaceId: workspace._id,
      contractId: contract._id,
      contractVersion: contract.version,
      createdById: user._id,
      taskType: 'final',
      stage: 'final',
      status: 'running',
      leaseId: `invalid-state-${status}`,
      leaseExpiresAt: new Date(Date.now() + 30_000),
      idempotencyKey: `invalid-state-${status}`,
      estimatedCost: 20,
      costCurrency: 'INR',
    });
    if (status === 'released' || status === 'unsupported') {
      const reservation = {
        projectId: project._id,
        generationTaskId: task._id,
        key: `video:invalid-state-${status}`,
        estimatedAmount: 20,
        actualAmount: 0,
        currency: 'INR',
        status,
      };
      const inserted = await BudgetReservation.collection.insertOne(reservation);
      task.budgetReservationId = inserted.insertedId;
      await task.save();
    } else {
      await attachReservation(task, project, { status });
    }
    await expect(
      processRealProviderJob(task, project, contract, task.leaseId!, fakeProvider(() => undefined))
    ).rejects.toMatchObject({
      kind: 'validation',
      message: expect.stringContaining('invalid_budget_reservation'),
    });
  });

  it('fails closed for missing, mismatched, and invalid reservation invariants', async () => {
    const cases = [
      { name: 'missing reservation id', taskChange: (task: any) => { task.budgetReservationId = undefined; }, expected: 'invalid_budget_reservation' },
      { name: 'reservation not found', taskChange: (task: any) => { task.budgetReservationId = new Types.ObjectId(); }, expected: 'invalid_budget_reservation' },
      { name: 'wrong task', reservation: { taskId: new Types.ObjectId() }, expected: 'invalid_budget_reservation' },
      { name: 'wrong project', reservation: { projectId: new Types.ObjectId() }, expected: 'invalid_budget_reservation' },
      { name: 'amount mismatch', reservation: { amount: 19 }, expected: 'invalid_budget_reservation' },
      { name: 'currency mismatch', reservation: { currency: 'USD' }, expected: 'budget_currency_mismatch' },
    ];
    for (const testCase of cases) {
      const { user, workspace, project, contract } = await setup();
      const task = await GenerationTask.create({
        projectId: project._id,
        workspaceId: workspace._id,
        contractId: contract._id,
        contractVersion: contract.version,
        createdById: user._id,
        taskType: 'final',
        stage: 'final',
        status: 'running',
        leaseId: `invariant-${testCase.name}`,
        leaseExpiresAt: new Date(Date.now() + 30_000),
        idempotencyKey: `invariant-${testCase.name}`,
        estimatedCost: 20,
        costCurrency: 'INR',
      });
      if (testCase.taskChange) {
        testCase.taskChange(task);
        await task.save();
      } else {
        await attachReservation(task, project, {
          amount: testCase.reservation?.amount,
          currency: testCase.reservation?.currency,
          taskId: testCase.reservation?.taskId,
          projectId: testCase.reservation?.projectId,
        });
      }
      await expect(
        processRealProviderJob(task, project, contract, task.leaseId!, fakeProvider(() => undefined))
      ).rejects.toMatchObject({
        kind: 'validation',
        message: expect.stringContaining(testCase.expected),
      });
    }
  });

  it.each([NaN, Infinity, -1])('fails closed for an invalid stored estimate: %s', async (estimate) => {
    const { user, workspace, project, contract } = await setup();
    const task = await GenerationTask.create({
      projectId: project._id,
      workspaceId: workspace._id,
      contractId: contract._id,
      contractVersion: contract.version,
      createdById: user._id,
      taskType: 'final',
      stage: 'final',
      status: 'running',
      leaseId: `invalid-estimate-${String(estimate)}`,
      leaseExpiresAt: new Date(Date.now() + 30_000),
      idempotencyKey: `invalid-estimate-${String(estimate)}`,
      estimatedCost: 20,
      costCurrency: 'INR',
    });
    await attachReservation(task, project);
    const executionTask = task.toObject();
    executionTask.estimatedCost = estimate;
    await expect(
      processRealProviderJob(executionTask, project, contract, task.leaseId!, fakeProvider(() => undefined))
    ).rejects.toMatchObject({
      kind: 'validation',
      message: expect.stringContaining('invalid_budget_estimate'),
    });
  });

  it('rejects a queued job when a required approval becomes pending', async () => {
    const { user, workspace, project, contract } = await setup();
    contract.requiredApprovals = [{ userId: user._id, role: 'reviewer', status: 'pending' }];
    await contract.save();
    const task = await GenerationTask.create({
      projectId: project._id,
      workspaceId: workspace._id,
      contractId: contract._id,
      contractVersion: contract.version,
      createdById: user._id,
      taskType: 'final',
      stage: 'final',
      status: 'running',
      leaseId: 'approval-invalid',
      leaseExpiresAt: new Date(Date.now() + 30_000),
      idempotencyKey: 'approval-invalid',
    });
    await attachReservation(task, project);
    let submitCalls = 0;
    const provider = fakeProvider(() => {
      submitCalls += 1;
    });
    await expect(processRealProviderJob(task, project, contract, 'approval-invalid', provider)).rejects.toMatchObject({
      kind: 'validation',
      message: expect.stringContaining('pending_contract_approvals'),
    });
    expect(submitCalls).toBe(0);
  });

  it('rejects a queued job when a high-severity conflict is introduced', async () => {
    const { user, workspace, project, contract } = await setup();
    await Conflict.create({
      projectId: project._id,
      workspaceId: workspace._id,
      title: 'New final conflict',
      description: 'A new conflict appeared after queueing.',
      severity: 'high',
      status: 'open',
      conflictType: 'factual',
      detectedBy: 'system',
    });
    const task = await GenerationTask.create({
      projectId: project._id,
      workspaceId: workspace._id,
      contractId: contract._id,
      contractVersion: contract.version,
      createdById: user._id,
      taskType: 'final',
      stage: 'final',
      status: 'running',
      leaseId: 'conflict-invalid',
      leaseExpiresAt: new Date(Date.now() + 30_000),
      idempotencyKey: 'conflict-invalid',
    });
    await attachReservation(task, project);
    let submitCalls = 0;
    const provider = fakeProvider(() => {
      submitCalls += 1;
    });
    await expect(processRealProviderJob(task, project, contract, 'conflict-invalid', provider)).rejects.toMatchObject({
      kind: 'validation',
      message: expect.stringContaining('high_conflict'),
    });
    expect(submitCalls).toBe(0);
  });

  it('rejects a superseded queued contract before provider submission', async () => {
    const { user, workspace, project, contract } = await setup();
    contract.status = 'superseded';
    await contract.save();
    const task = await GenerationTask.create({
      projectId: project._id,
      workspaceId: workspace._id,
      contractId: contract._id,
      contractVersion: contract.version,
      createdById: user._id,
      taskType: 'final',
      stage: 'final',
      status: 'running',
      leaseId: 'contract-invalid',
      leaseExpiresAt: new Date(Date.now() + 30_000),
      idempotencyKey: 'contract-invalid',
    });
    await attachReservation(task, project);
    let submitCalls = 0;
    const provider = fakeProvider(() => {
      submitCalls += 1;
    });
    await expect(processRealProviderJob(task, project, contract, 'contract-invalid', provider)).rejects.toMatchObject({
      kind: 'validation',
    });
    expect(submitCalls).toBe(0);
  });

  it('does not mark a project ready when contract approval leaves authorization blockers', async () => {
    const { user, project, contract } = await setup();
    project.description = 'Food recipe video';
    await project.save();
    contract.status = 'pending_approval';
    contract.requiredApprovals = [];
    await contract.save();

    const response = await fetch(`${baseUrl}/api/projects/${project._id}/contract/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${signAccessToken(user)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const freshProject = await Project.findById(project._id);
    expect(freshProject?.status).toBe('blocked');
  });

  it('allows valid real-provider worker evidence to reach the provider', async () => {
    const { user, workspace, project, contract } = await setup();
    const task = await GenerationTask.create({
      projectId: project._id,
      workspaceId: workspace._id,
      contractId: contract._id,
      contractVersion: contract.version,
      createdById: user._id,
      taskType: 'final',
      stage: 'final',
      status: 'running',
      leaseId: 'boundary-valid',
      leaseExpiresAt: new Date(Date.now() + 30_000),
      idempotencyKey: 'boundary-valid',
    });
    await attachReservation(task, project);
    let submitCalls = 0;
    const provider = fakeProvider(() => {
      submitCalls += 1;
    });

    await expect(processRealProviderJob(task, project, contract, 'boundary-valid', provider)).rejects.toMatchObject({
      kind: 'provider',
    });
    expect(submitCalls).toBe(1);
  });

  it('revalidates queued mock jobs before execution when evidence changes', async () => {
    const { user, workspace, project } = await setup();
    const { task } = await submitVideoJob({
      projectId: project._id,
      workspaceId: workspace._id,
      userId: user._id,
      stage: 'final',
      mode: 'success',
      idempotencyKey: 'revalidate-before-worker',
    });
    await Asset.create({
      workspaceId: workspace._id,
      projectId: project._id,
      uploadedById: user._id,
      name: 'Expired image',
      type: 'image',
      fileUrl: '/uploads/expired.png',
      mimeType: 'image/png',
      licenseStatus: 'expired',
    });
    const worker = new VideoJobWorker();
    worker.start();
    const failed = await waitForStatus(task._id, 'failed');
    await worker.stop();
    expect(failed.errorMessage).toContain('unlicensed_asset');
  });

  it('revalidates persisted evidence for the real-provider worker boundary', async () => {
    const { user, workspace, project, contract } = await setup();
    await Asset.create({
      workspaceId: workspace._id,
      projectId: project._id,
      uploadedById: user._id,
      name: 'Expired image',
      type: 'image',
      fileUrl: '/uploads/expired-worker.png',
      mimeType: 'image/png',
      licenseStatus: 'expired',
    });
    const task = await GenerationTask.create({
      projectId: project._id,
      workspaceId: workspace._id,
      contractId: contract._id,
      contractVersion: contract.version,
      createdById: user._id,
      taskType: 'final',
      stage: 'final',
      status: 'running',
      leaseId: 'boundary-revalidation',
      leaseExpiresAt: new Date(Date.now() + 30_000),
      idempotencyKey: 'boundary-revalidation',
    });
    await attachReservation(task, project);
    const authorization = await revalidateVideoJobAuthorization(
      task,
      project,
      contract
    );
    expect(authorization.authorized).toBe(false);
    expect(authorization.blockers.some((blocker) => blocker.code === 'unlicensed_asset')).toBe(true);
  });

  it('creates an idempotent queued job and rejects conflicting key reuse', async () => {
    const { user, workspace, project } = await setup();
    const first = await submitVideoJob({
      projectId: project._id,
      workspaceId: workspace._id,
      userId: user._id,
      stage: 'final',
      mode: 'success',
      idempotencyKey: 'same-key',
    });
    const duplicate = await submitVideoJob({
      projectId: project._id,
      workspaceId: workspace._id,
      userId: user._id,
      stage: 'final',
      mode: 'success',
      idempotencyKey: 'same-key',
    });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.task._id.toString()).toBe(first.task._id.toString());
    await expect(
      submitVideoJob({
        projectId: project._id,
        workspaceId: workspace._id,
        userId: user._id,
        stage: 'final',
        mode: 'permanent_failure',
        idempotencyKey: 'same-key',
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('processes a success once and preserves review compatibility without charging budget', async () => {
    const { user, workspace, project } = await setup();
    const { task } = await submitVideoJob({
      projectId: project._id,
      workspaceId: workspace._id,
      userId: user._id,
      stage: 'final',
      mode: 'success',
      idempotencyKey: 'success-key',
    });
    const reservationsBeforeWorker = await BudgetReservation.countDocuments({ generationTaskId: task._id });
    expect(reservationsBeforeWorker).toBe(1);
    expect(task.budgetReservationId).toBeDefined();
    const workerA = new VideoJobWorker();
    const workerB = new VideoJobWorker();
    workerA.start();
    workerB.start();
    const completed = await waitForStatus(task._id, 'requires_approval');
    await workerA.stop();
    await workerB.stop();
    expect(completed.progress).toBe(100);
    expect(completed.reviewStatus).toBe('pending');
    expect(completed.mockOutput).toBe(true);
    expect(completed.outputText).toContain('NOT A PLAYABLE MP4');
    const freshProject = await Project.findById(project._id);
    expect(freshProject?.budget.spent).toBe(0);
    expect(await BudgetReservation.countDocuments({ generationTaskId: task._id })).toBe(1);
  });

  it('does not let an expired lease overwrite a newer worker result', async () => {
    const { user, workspace, project, contract } = await setup();
    const task = await GenerationTask.create({
      projectId: project._id,
      workspaceId: workspace._id,
      contractId: contract._id,
      contractVersion: contract.version,
      createdById: user._id,
      taskType: 'final',
      stage: 'final',
      status: 'running',
      leaseId: 'old-worker',
      leaseExpiresAt: new Date(Date.now() - 1000),
      heartbeatAt: new Date(Date.now() - 1000),
      mockOutput: true,
      providerMode: 'success',
    });
    await attachReservation(task, project);
    const worker = new VideoJobWorker();
    worker.start();
    const recovered = await waitForStatus(task._id, 'requires_approval');
    await worker.stop();
    expect(recovered.outputText).toContain('NOT A PLAYABLE MP4');
    expect(recovered.leaseId).toBeUndefined();
  });

  it('requires authentication and prevents cross-workspace job access', async () => {
    const { user, workspace, project } = await setup();
    const created = await submitVideoJob({
      projectId: project._id,
      workspaceId: workspace._id,
      userId: user._id,
      stage: 'final',
      mode: 'success',
      idempotencyKey: 'auth-key',
    });
    const unauthenticated = await fetch(`${baseUrl}/api/video-jobs/${created.task._id}`);
    expect(unauthenticated.status).toBe(401);

    const outsider = await User.create({
      name: 'Outsider',
      email: `outsider-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash('test-password', 4),
    });
    const denied = await fetch(`${baseUrl}/api/video-jobs/${created.task._id}`, {
      headers: { Authorization: `Bearer ${signAccessToken(outsider)}` },
    });
    expect(denied.status).toBe(403);
  });
});
