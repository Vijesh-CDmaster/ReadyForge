/**
 * Genuine local render verification.
 *
 * Requires FFMPEG_PATH and FFPROBE_PATH pointing at real executables.
 * Uses an isolated in-memory MongoDB, the real Express API, the real
 * VideoJobWorker, real FFmpeg encoding, and the real protected asset route.
 *
 * Run: FFMPEG_PATH=... FFPROBE_PATH=... npx tsx scripts/verify-render.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

// This script is intended to run from the repository root.
const root = process.cwd();
const stamp = Date.now();
const artifactsDir = path.join(root, 'server', '.data', `verify-render-${stamp}`);
const fixturesDir = path.join(artifactsDir, 'fixtures');
const outputFile = path.join(artifactsDir, 'rendered-output.mp4');
const resultFile = path.join(artifactsDir, 'result.json');

const ffmpegPath = process.env.FFMPEG_PATH || '';
const ffprobePath = process.env.FFPROBE_PATH || '';
if (!ffmpegPath || !ffprobePath) {
  throw new Error('Set FFMPEG_PATH and FFPROBE_PATH to real executables before running this script.');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
};

function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await fs.mkdir(fixturesDir, { recursive: true });
  const videoFixture = path.join(fixturesDir, 'fixture-video.mp4');
  const audioFixture = path.join(fixturesDir, 'fixture-audio.wav');
  const corruptFixture = path.join(fixturesDir, 'corrupt.mp4');

  console.log('[1/12] Creating real FFmpeg fixtures');
  await run(ffmpegPath, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
    '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart',
    videoFixture,
  ]);
  await run(ffmpegPath, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=2',
    '-c:a', 'pcm_s16le', audioFixture,
  ]);
  await fs.writeFile(corruptFixture, 'this is deliberately not a valid MP4 file');
  const fixtureProbe = JSON.parse(
    (
      await run(ffprobePath, [
        '-v', 'error',
        '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate',
        '-of', 'json',
        videoFixture,
      ])
    ).stdout
  );
  console.log('  fixture:', JSON.stringify(fixtureProbe));

  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('readyforge_verify');
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET = 'verify-access-secret';
  process.env.JWT_REFRESH_SECRET = 'verify-refresh-secret';
  process.env.SEED_ON_START = 'false';
  process.env.FFMPEG_PATH = ffmpegPath;
  process.env.FFPROBE_PATH = ffprobePath;

  const { connectDb, disconnectDb } = await import('../server/src/db');
  const { createApp } = await import('../server/src/index');
  const { VideoJobWorker } = await import('../server/src/services/videoJobs');
  const { getVideoRenderingTools } = await import('../server/src/services/ffmpegTools');
  const { config } = await import('../server/src/config');
  const { User } = await import('../server/src/models/User');
  const { Workspace } = await import('../server/src/models/Workspace');
  const { Project } = await import('../server/src/models/Project');
  const { ProductionContract } = await import('../server/src/models/ProductionContract');
  const { Asset } = await import('../server/src/models/Asset');
  const { GenerationTask } = await import('../server/src/models/GenerationTask');
  const { BudgetReservation } = await import('../server/src/models/BudgetReservation');
  const { signAccessToken } = await import('../server/src/middleware/auth');

  await connectDb();
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const user = await User.create({
    name: 'Render Verification Owner',
    email: `verify-render-${stamp}@example.com`,
    passwordHash: await bcrypt.hash('verify-password', 4),
  });
  const outsider = await User.create({
    name: 'Render Verification Outsider',
    email: `verify-outsider-${stamp}@example.com`,
    passwordHash: await bcrypt.hash('verify-password', 4),
  });
  const workspace = await Workspace.create({
    name: 'Render Verification Workspace',
    ownerId: user._id,
    members: [{ userId: user._id, role: 'owner', status: 'active' }],
  });
  const project = await Project.create({
    workspaceId: workspace._id,
    createdById: user._id,
    title: 'Genuine Render Verification',
    description: 'Authorized genuine local render verification project',
    projectType: 'video',
    status: 'draft',
    mode: 'solo',
    objective: 'Verify genuine local FFmpeg rendering',
    audience: 'Verification reviewers',
    tone: 'Clear',
    callToAction: 'Watch the verified output',
    deadline: new Date(Date.now() + 86400_000),
    currentStage: 'final',
    budget: { amount: 100, currency: 'INR', spent: 0, remaining: 100 },
  });
  await ProductionContract.create({
    projectId: project._id,
    workspaceId: workspace._id,
    createdById: user._id,
    status: 'locked',
    version: 1,
    requiredApprovals: [],
    objective: 'Verify genuine local rendering',
    audience: 'Verification reviewers',
    tone: 'Clear',
    keyMessage: 'A genuine local MP4 render',
    callToAction: 'Watch the verified output',
    contentPlan: {
      outline: ['Opening'],
      script: 'A complete production script for genuine render verification.',
      storyboard: [
        {
          sceneNumber: 1,
          title: 'Opening',
          description: 'Opening shot',
          durationSeconds: 2,
          status: 'approved',
        },
      ],
    },
  });
  const token = signAccessToken(user);

  const jsonRequest = async (
    pathname: string,
    method: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...extraHeaders,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      /* non-JSON */
    }
    return { status: response.status, body: parsed as any };
  };

  const uploadAsset = async (filePath: string, name: string, mimeType: string) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(await fs.readFile(filePath))], { type: mimeType }), name);
    form.append('projectId', project._id.toString());
    form.append('licenseStatus', 'owned');
    const response = await fetch(`${baseUrl}/api/assets/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const body = (await response.json()) as any;
    assert(response.status === 201, `upload ${name} failed: ${response.status} ${JSON.stringify(body)}`);
    return body.asset;
  };

  const waitForJob = async (jobId: string, timeoutMs = 120_000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const result = await jsonRequest(`/api/video-jobs/${jobId}`, 'GET');
      if (result.status === 200 && ['succeeded', 'failed', 'cancelled'].includes(result.body.job.status)) {
        return result.body.job;
      }
      await sleep(250);
    }
    throw new Error(`Timed out waiting for render job ${jobId}`);
  };

  const saveComposition = async (clips: unknown[]) => {
    const result = await jsonRequest(`/api/projects/${project._id}/composition`, 'PUT', {
      schemaVersion: 1,
      clips,
    });
    assert(result.status === 200, `composition save failed: ${result.status} ${JSON.stringify(result.body)}`);
    return result.body.composition;
  };

  const worker = new VideoJobWorker();
  try {
    const tools = await getVideoRenderingTools({ refresh: true });
    assert(tools.available, `capability service reports rendering unavailable: ${tools.message}`);
    console.log('[2/12] Capability service available:', JSON.stringify({
      ffmpeg: tools.ffmpeg.version,
      ffprobe: tools.ffprobe.version,
      missingCodecs: tools.missingCodecs,
    }));

    console.log('[3/12] Importing fixtures through the authorized upload API');
    const videoAsset = await uploadAsset(videoFixture, 'fixture-video.mp4', 'video/mp4');
    const audioAsset = await uploadAsset(audioFixture, 'fixture-audio.wav', 'audio/wav');
    assert(videoAsset.sourceDurationSeconds > 1.5, `video duration was not probed: ${JSON.stringify(videoAsset)}`);
    assert(audioAsset.sourceDurationSeconds > 1.5, `audio duration was not probed: ${JSON.stringify(audioAsset)}`);
    console.log('  imported:', JSON.stringify({
      video: { id: videoAsset.id, duration: videoAsset.sourceDurationSeconds, license: videoAsset.licenseStatus },
      audio: { id: audioAsset.id, duration: audioAsset.sourceDurationSeconds, license: audioAsset.licenseStatus },
    }));

    console.log('[4/12] Saving a valid video + audio composition');
    const composition = await saveComposition([
      {
        assetId: videoAsset.id,
        trackId: 'video-1',
        trackType: 'video',
        timelineStartSeconds: 0,
        sourceInSeconds: 0,
        sourceOutSeconds: 2,
      },
      {
        assetId: audioAsset.id,
        trackId: 'audio-1',
        trackType: 'audio',
        timelineStartSeconds: 0,
        sourceInSeconds: 0,
        sourceOutSeconds: 2,
      },
    ]);
    assert(composition.clips.every((clip: any) => clip.durationSeconds > 0), 'composition clips lack trusted durations');

    console.log('[5/12] Submitting render through the authorized API');
    const renderKey = `verify-success-${stamp}`;
    const submit = await jsonRequest(`/api/projects/${project._id}/renders`, 'POST', {}, {
      'Idempotency-Key': renderKey,
    });
    assert(submit.status === 202, `render submit failed: ${submit.status} ${JSON.stringify(submit.body)}`);
    const jobId = submit.body.job.id;
    worker.start();

    console.log('[6/12] Waiting for the real worker and FFmpeg process');
    const job = await waitForJob(jobId);
    assert(job.status === 'succeeded', `render failed: ${JSON.stringify(job)}`);
    assert(job.outputAssetId, 'render succeeded without an output asset');
    console.log('  worker result:', JSON.stringify({
      status: job.status,
      legacyStatus: job.legacyStatus,
      progress: job.progress,
      outputAssetId: job.outputAssetId,
    }));

    console.log('[7/12] Retrieving protected output through the authorized asset endpoint');
    const unauthenticated = await fetch(`${baseUrl}/api/assets/${job.outputAssetId}/file`);
    assert(unauthenticated.status === 401, `unauthenticated output retrieval returned ${unauthenticated.status}`);
    const outputResponse = await fetch(`${baseUrl}/api/assets/${job.outputAssetId}/file`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(outputResponse.status === 200, `authorized output retrieval returned ${outputResponse.status}`);
    assert(
      (outputResponse.headers.get('content-type') || '').includes('video/mp4'),
      `unexpected output content type: ${outputResponse.headers.get('content-type')}`
    );
    const outputBytes = Buffer.from(await outputResponse.arrayBuffer());
    await fs.writeFile(outputFile, outputBytes);
    const outsiderResponse = await fetch(`${baseUrl}/api/assets/${job.outputAssetId}/file`, {
      headers: { Authorization: `Bearer ${signAccessToken(outsider)}` },
    });
    assert(outsiderResponse.status === 404, `outsider output retrieval returned ${outsiderResponse.status}`);

    console.log('[8/12] Inspecting the retrieved MP4 with FFprobe');
    const probe = JSON.parse(
      (
        await run(ffprobePath, [
          '-v', 'error',
          '-show_entries',
          'format=format_name,duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,sample_rate,channels',
          '-of', 'json',
          outputFile,
        ])
      ).stdout
    );
    const videoStream = (probe.streams || []).find((stream: any) => stream.codec_type === 'video');
    const audioStream = (probe.streams || []).find((stream: any) => stream.codec_type === 'audio');
    assert(String(probe.format?.format_name || '').includes('mp4'), 'output container is not MP4');
    assert(Number(probe.format?.duration) > 1.5, 'output duration is unexpectedly short');
    assert(videoStream?.codec_name === 'h264', `unexpected video codec: ${videoStream?.codec_name}`);
    assert(videoStream?.width === 1280 && videoStream?.height === 720, 'unexpected output resolution');
    const fpsParts = String(videoStream?.avg_frame_rate || videoStream?.r_frame_rate || '').split('/').map(Number);
    const fps = fpsParts.length === 2 && fpsParts[1] ? fpsParts[0] / fpsParts[1] : Number(fpsParts[0]);
    assert(Math.abs(fps - 30) < 0.1, `unexpected frame rate: ${videoStream?.avg_frame_rate}`);
    assert(audioStream?.codec_name === 'aac', `unexpected audio codec: ${audioStream?.codec_name}`);
    assert(Number(audioStream?.channels) === 2, 'output audio is not stereo');
    assert(Number(audioStream?.sample_rate) === 48000, 'output audio is not 48 kHz');
    assert(outputBytes.length > 0, 'retrieved output file is empty');

    console.log('[9/12] Checking task, budget, asset, and temp cleanup state');
    const taskDoc = await GenerationTask.findById(jobId);
    assert(taskDoc?.status === 'requires_approval', `unexpected terminal DB status: ${taskDoc?.status}`);
    assert(taskDoc?.outputAssetId?.toString() === job.outputAssetId, 'task output asset mismatch');
    const outputAsset = await Asset.findById(job.outputAssetId);
    assert(outputAsset?.aiGenerated === true, 'output asset is not marked generated');
    assert(outputAsset?.mimeType === 'video/mp4', 'output asset MIME type is not video/mp4');
    assert(outputAsset?.licenseStatus === 'owned', 'output asset is not owned');
    assert((outputAsset?.sizeBytes || 0) === outputBytes.length, 'stored asset size does not match retrieved bytes');
    const reservation = await BudgetReservation.findOne({ generationTaskId: taskDoc?._id });
    assert(reservation?.status === 'settled', `reservation status is ${reservation?.status}`);
    assert(reservation?.actualAmount === 0, 'reservation did not settle at actual cost zero');
    const projectAfter = await Project.findById(project._id);
    assert(projectAfter?.budget.spent === 0, `project budget spent is ${projectAfter?.budget.spent}`);
    const successWorkDir = path.join(config.dataDir, 'renders', jobId);
    assert(!(await exists(successWorkDir)), 'successful render temp directory was not cleaned');

    console.log('[10/12] Verifying duplicate submission is idempotent');
    const duplicate = await jsonRequest(`/api/projects/${project._id}/renders`, 'POST', {}, {
      'Idempotency-Key': renderKey,
    });
    assert(duplicate.status === 200, `duplicate submit returned ${duplicate.status}`);
    assert(duplicate.body.duplicate === true, 'duplicate submit was not flagged');
    assert(duplicate.body.job.id === jobId, 'duplicate submit created a different task');
    const duplicateTaskCount = await GenerationTask.countDocuments({ projectId: project._id });
    const duplicateOutputAssetCount = await Asset.countDocuments({ projectId: project._id, aiGenerated: true });
    const duplicateReservationCount = await BudgetReservation.countDocuments({ generationTaskId: taskDoc?._id });
    assert(duplicateTaskCount === 1, 'duplicate task was created');
    assert(duplicateOutputAssetCount === 1, 'duplicate output asset was created');
    assert(duplicateReservationCount === 1, 'duplicate reservation was created');

    console.log('[11/12] Exercising genuine FFmpeg failure and cleanup');
    const corruptAsset = await uploadAsset(corruptFixture, 'corrupt.mp4', 'video/mp4');
    await Asset.updateOne({ _id: corruptAsset.id }, { $set: { sourceDurationSeconds: 2 } });
    await saveComposition([
      {
        assetId: corruptAsset.id,
        trackId: 'video-1',
        trackType: 'video',
        timelineStartSeconds: 0,
        sourceInSeconds: 0,
        sourceOutSeconds: 2,
      },
    ]);
    const failureSubmit = await jsonRequest(`/api/projects/${project._id}/renders`, 'POST', {}, {
      'Idempotency-Key': `verify-failure-${stamp}`,
    });
    assert(failureSubmit.status === 202, `failure render submit returned ${failureSubmit.status}`);
    const failedJob = await waitForJob(failureSubmit.body.job.id);
    assert(failedJob.status === 'failed', `corrupt render unexpectedly returned ${failedJob.status}`);
    const failedTask = await GenerationTask.findById(failureSubmit.body.job.id);
    assert(failedTask?.status === 'failed', 'failed render task did not reach failed status');
    assert(!failedTask?.outputAssetId, 'failed render published an output asset');
    assert((failedJob.errorMessage || '').includes('Video rendering failed'), `unexpected failure message: ${failedJob.errorMessage}`);
    const failedReservation = await BudgetReservation.findOne({ generationTaskId: failedTask?._id });
    assert(failedReservation?.status === 'refunded', `failed reservation status is ${failedReservation?.status}`);
    assert(
      !(await exists(path.join(config.dataDir, 'renders', failureSubmit.body.job.id))),
      'failed render temp directory was not cleaned'
    );

    console.log('[12/12] Exercising genuine render timeout and cleanup');
    await saveComposition([
      {
        assetId: videoAsset.id,
        trackId: 'video-1',
        trackType: 'video',
        timelineStartSeconds: 0,
        sourceInSeconds: 0,
        sourceOutSeconds: 2,
      },
      {
        assetId: audioAsset.id,
        trackId: 'audio-1',
        trackType: 'audio',
        timelineStartSeconds: 0,
        sourceInSeconds: 0,
        sourceOutSeconds: 2,
      },
    ]);
    const originalTimeout = config.video.renderTimeoutMs;
    config.video.renderTimeoutMs = 1;
    let timeoutJob: any;
    try {
      const timeoutSubmit = await jsonRequest(`/api/projects/${project._id}/renders`, 'POST', {}, {
        'Idempotency-Key': `verify-timeout-${stamp}`,
      });
      assert(timeoutSubmit.status === 202, `timeout render submit returned ${timeoutSubmit.status}`);
      timeoutJob = await waitForJob(timeoutSubmit.body.job.id, 60_000);
      assert(timeoutJob.status === 'failed', `timeout render unexpectedly returned ${timeoutJob.status}`);
      const timeoutTask = await GenerationTask.findById(timeoutSubmit.body.job.id);
      assert(timeoutTask?.errorCode === 'VIDEO_TIMEOUT', `unexpected timeout error code: ${timeoutTask?.errorCode}`);
      assert((timeoutTask?.errorMessage || '').includes('timed out'), `unexpected timeout message: ${timeoutTask?.errorMessage}`);
      assert(!timeoutTask?.outputAssetId, 'timed-out render published an output asset');
      const timeoutReservation = await BudgetReservation.findOne({ generationTaskId: timeoutTask?._id });
      assert(timeoutReservation?.status === 'refunded', `timeout reservation status is ${timeoutReservation?.status}`);
      assert(
        !(await exists(path.join(config.dataDir, 'renders', timeoutSubmit.body.job.id))),
        'timed-out render temp directory was not cleaned'
      );
    } finally {
      config.video.renderTimeoutMs = originalTimeout;
    }

    const missingTools = await getVideoRenderingTools({
      refresh: true,
      ffmpegPath: path.join(fixturesDir, 'missing-ffmpeg.exe'),
      ffprobePath: path.join(fixturesDir, 'missing-ffprobe.exe'),
      ffmpegConfigured: true,
      ffprobeConfigured: true,
    });
    assert(missingTools.available === false, 'missing executables were reported as available');

    const summary = {
      tooling: {
        ffmpegPath,
        ffprobePath,
        ffmpegVersion: tools.ffmpeg.version,
        ffprobeVersion: tools.ffprobe.version,
        missingCodecs: tools.missingCodecs,
        missingExecutableReportedUnavailable: !missingTools.available,
      },
      fixtureProbe,
      composition: {
        id: composition.id,
        revision: composition.revision,
        clips: composition.clips,
      },
      worker: {
        apiStatus: job.status,
        dbStatus: taskDoc?.status,
        progress: job.progress,
        outputAssetId: job.outputAssetId,
      },
      outputAsset: outputAsset ? {
        id: outputAsset._id.toString(),
        type: outputAsset.type,
        mimeType: outputAsset.mimeType,
        sizeBytes: outputAsset.sizeBytes,
        sourceDurationSeconds: outputAsset.sourceDurationSeconds,
        licenseStatus: outputAsset.licenseStatus,
        aiGenerated: outputAsset.aiGenerated,
      } : null,
      protectedRetrieval: {
        unauthenticatedStatus: unauthenticated.status,
        authorizedStatus: outputResponse.status,
        outsiderStatus: outsiderResponse.status,
        contentType: outputResponse.headers.get('content-type'),
        cacheControl: outputResponse.headers.get('cache-control'),
        retrievedBytes: outputBytes.length,
      },
      ffprobe: probe,
      computed: {
        durationSeconds: Number(probe.format?.duration),
        fileSizeBytes: outputBytes.length,
        frameRate: fps,
        width: videoStream?.width,
        height: videoStream?.height,
        videoCodec: videoStream?.codec_name,
        audioCodec: audioStream?.codec_name,
        audioChannels: Number(audioStream?.channels),
        audioSampleRate: Number(audioStream?.sample_rate),
        container: probe.format?.format_name,
      },
      duplicate: {
        status: duplicate.status,
        duplicate: duplicate.body.duplicate,
        sameTaskId: duplicate.body.job.id === jobId,
        taskCount: duplicateTaskCount,
        outputAssetCount: duplicateOutputAssetCount,
        reservationCount: duplicateReservationCount,
        reservationStatus: reservation?.status,
        projectBudgetSpent: projectAfter?.budget.spent,
      },
      failure: {
        status: failedJob.status,
        errorCode: failedTask?.errorCode,
        errorMessage: failedJob.errorMessage,
        publishedOutput: Boolean(failedTask?.outputAssetId),
        reservationStatus: failedReservation?.status,
        tempDirRemoved: !(await exists(path.join(config.dataDir, 'renders', failureSubmit.body.job.id))),
      },
      timeout: {
        status: timeoutJob?.status,
        errorCode: (await GenerationTask.findById(timeoutJob?.id))?.errorCode,
        errorMessage: timeoutJob?.errorMessage,
        publishedOutput: Boolean((await GenerationTask.findById(timeoutJob?.id))?.outputAssetId),
        tempDirRemoved: !(await exists(path.join(config.dataDir, 'renders', timeoutJob?.id))),
      },
      artifacts: { outputFile, resultFile, fixturesDir },
      generatedAt: new Date().toISOString(),
    };
    await fs.writeFile(resultFile, JSON.stringify(summary, null, 2));
    console.log('\n=== VERIFICATION SUMMARY ===');
    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nOutput MP4: ${outputFile}`);
    console.log(`Result JSON: ${resultFile}`);
  } finally {
    await worker.stop().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectDb().catch(() => undefined);
    await mongo.stop().catch(() => undefined);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
