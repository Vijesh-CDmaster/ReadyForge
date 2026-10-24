import { aiJson, AiResult } from './client';
import { IProject } from '../models/Project';
import { IProductionContract, IStoryboardScene } from '../models/ProductionContract';

/**
 * Draft-ladder generators.
 *
 * Text generation goes through the OpenAI-compatible client, which in this deployment
 * points at our own local service (ai-service: Qwen2.5-0.5B on this machine) and falls
 * back to deterministic builders when the service is down — so a stage always produces
 * usable output and the `source` field tells the UI which path produced it.
 *
 * The preview and final "renders" are deliberately simulated (no video pipeline in MVP);
 * they build a concrete, reviewable document and are labelled as simulated everywhere.
 */

/** Planned cost per ladder stage, in project currency — mirrored from the contract's model routing plan. */
export const STAGE_COST: Record<string, number> = {
  concept: 5,
  script: 40,
  storyboard: 60,
  preview: 30,
  final: 80,
};

export const STAGE_LABEL: Record<string, string> = {
  concept: 'Concept outline',
  script: 'Script',
  storyboard: 'Storyboard',
  preview: 'Low-cost preview',
  final: 'Final render',
};

const TARGET_DURATION: Record<string, number> = { ad: 30, video: 60, social_post: 30, presentation: 120, blog: 60 };

function targetDuration(project: IProject): number {
  return TARGET_DURATION[project.projectType] || 60;
}

function contractFacts(project: IProject, contract: IProductionContract): string {
  return [
    `Title: ${project.title}`,
    `Project type: ${project.projectType}`,
    `Objective: ${contract.objective || project.objective || 'n/a'}`,
    `Audience: ${contract.audience || project.audience || 'n/a'}`,
    `Tone: ${contract.tone || project.tone || 'n/a'}`,
    `Key message: ${contract.keyMessage || 'n/a'}`,
    `Call to action: ${contract.callToAction || project.callToAction || 'n/a'}`,
    `Brand rules: ${contract.brandRules.join('; ') || 'n/a'}`,
    `Accessibility: ${contract.accessibilityRequirements.join('; ') || 'n/a'}`,
    `Outline so far: ${contract.contentPlan.outline.join(' | ') || 'n/a'}`,
    `Target duration: ${targetDuration(project)}s`,
  ].join('\n');
}

/* ---------------- outline ---------------- */

export async function generateOutline(
  project: IProject,
  contract: IProductionContract
): Promise<AiResult<{ outline: string[] }>> {
  return aiJson<{ outline: string[] }>({
    system: `You are ReadyForge's Outline Generator.
Build a content outline for the approved Production Contract.
Return JSON: { "outline": ["beat 1", "beat 2", ...] } with 5-8 short beats in order.
Use only the contract facts provided. Do not invent claims, prices or promises.`,
    user: contractFacts(project, contract),
    fallback: () => outlineFallback(project, contract),
  });
}

function outlineFallback(project: IProject, contract: IProductionContract): { outline: string[] } {
  if (contract.contentPlan.outline.length) return { outline: contract.contentPlan.outline };
  const cta = contract.callToAction || project.callToAction || 'take the next step';
  return {
    outline: [
      `Hook: open on the problem the ${contract.audience || 'audience'} cares about`,
      `Context: what changed and why it matters now`,
      `Key message: ${contract.keyMessage || contract.objective || project.title}`,
      'Proof: cite only approved facts from the Knowledge Ledger',
      `Call to action: ${cta}`,
      'Close: reinforce the key message in one line',
    ],
  };
}

/* ---------------- script ---------------- */

export async function generateScript(
  project: IProject,
  contract: IProductionContract
): Promise<AiResult<{ script: string }>> {
  return aiJson<{ script: string }>({
    system: `You are ReadyForge's Script Writer.
Write a production script for the approved Production Contract.
Return JSON: { "script": "..." }.
Format the script as blocks separated by blank lines:
[SCENE n — beat name]
VISUAL: what is on screen
VO: spoken line
DURATION: seconds
Rules: match the target duration, use the contract tone, use ONLY approved facts,
never invent numbers or offers, include captions where accessibility requires it.`,
    user: contractFacts(project, contract),
    fallback: () => scriptFallback(project, contract),
  });
}

function scriptFallback(project: IProject, contract: IProductionContract): { script: string } {
  const beats = contract.contentPlan.outline.length ? contract.contentPlan.outline : outlineFallback(project, contract).outline;
  const duration = targetDuration(project);
  const per = Math.max(3, Math.round(duration / beats.length));
  const tone = contract.tone || project.tone || 'clear and confident';
  const cta = contract.callToAction || project.callToAction || 'Learn more';

  const blocks = beats.map((beat, i) => {
    const scene = i + 1;
    const vo =
      i === 0
        ? `Quick hook — ${beat.toLowerCase()}.`
        : i === beats.length - 1
          ? `${cta}.`
          : beat.replace(/^\w/, (c) => c.toUpperCase()) + '.';
    return [
      `[SCENE ${scene} — ${beat}]`,
      `VISUAL: Support beat ${scene} with brand-compliant visuals (tone: ${tone}).`,
      `VO: ${vo}`,
      `DURATION: ${per}s`,
    ].join('\n');
  });

  return {
    script: [
      `# ${project.title}`,
      `Objective: ${contract.objective || project.objective || ''}`,
      `Audience: ${contract.audience || project.audience || ''}`,
      `Tone: ${tone}`,
      '',
      ...blocks.join('\n\n').split('\n'),
    ].join('\n'),
  };
}

/* ---------------- storyboard ---------------- */

export interface SceneDraft {
  sceneNumber: number;
  title: string;
  description: string;
  visualDirection: string;
  voiceover: string;
  durationSeconds: number;
}

export async function generateStoryboard(
  project: IProject,
  contract: IProductionContract,
  script: string
): Promise<AiResult<{ scenes: SceneDraft[] }>> {
  return aiJson<{ scenes: SceneDraft[] }>({
    system: `You are ReadyForge's Storyboard Planner.
Convert the script into storyboard scenes for the approved Production Contract.
Return JSON: { "scenes": [{ "sceneNumber": 1, "title": "...", "description": "...",
"visualDirection": "...", "voiceover": "...", "durationSeconds": 5 }] }.
One scene per script block, in order. Durations must sum to the target duration.
Visual direction must respect the contract brand rules. Do not invent facts.`,
    user: `${contractFacts(project, contract)}\n\nScript:\n${script}`,
    fallback: () => storyboardFallback(project, contract, script),
  });
}

export function storyboardFallback(
  project: IProject,
  contract: IProductionContract,
  script: string
): { scenes: SceneDraft[] } {
  const rawBlocks = script
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const duration = targetDuration(project);
  const per = Math.max(3, Math.round(duration / Math.max(rawBlocks.length, 1)));

  const scenes: SceneDraft[] = rawBlocks.map((block, i) => {
    const titleMatch = block.match(/\[SCENE \d+ — (.+?)\]/);
    const voMatch = block.match(/VO:\s*(.+)/);
    const visualMatch = block.match(/VISUAL:\s*(.+)/);
    const firstLine = block.split('\n')[0].replace(/\[|\]/g, '').slice(0, 80);
    return {
      sceneNumber: i + 1,
      title: titleMatch?.[1]?.trim() || firstLine || `Scene ${i + 1}`,
      description: visualMatch?.[1]?.trim() || block.replace(/\n/g, ' ').slice(0, 240),
      visualDirection: `${contract.tone || project.tone || 'brand'} style; captions on screen`,
      voiceover: voMatch?.[1]?.trim() || '',
      durationSeconds: per,
    };
  });

  return { scenes };
}

/* ---------------- simulated renders ---------------- */

/**
 * MVP preview: a scene-by-scene animatic document (timings, narration, visual notes).
 * Clearly labelled as a simulation — ReadyForge does not render video.
 */
export function buildPreviewDocument(
  project: IProject,
  contract: IProductionContract,
  scenes: IStoryboardScene[]
): string {
  const total = scenes.reduce((s, sc) => s + (sc.durationSeconds || 0), 0);
  return [
    `PREVIEW / ANIMATIC — ${project.title}`,
    `Simulated render for demonstration. ReadyForge does not render video in this build.`,
    '',
    `Target duration: ${total}s · Scenes: ${scenes.length} · Tone: ${contract.tone || project.tone || 'n/a'}`,
    '',
    ...scenes.map(
      (sc) =>
        [
          `SCENE ${sc.sceneNumber} (${sc.durationSeconds || 0}s) — ${sc.title}`,
          `  VISUAL: ${sc.visualDirection || sc.description}`,
          `  VO: ${sc.voiceover || '—'}`,
        ].join('\n')
    ),
    '',
    `CTA: ${contract.callToAction || project.callToAction || '—'}`,
  ].join('\n');
}

/** MVP final: the locked delivery package assembled from the approved rungs. */
export function buildFinalDocument(
  project: IProject,
  contract: IProductionContract,
  script: string,
  scenes: IStoryboardScene[]
): string {
  const total = scenes.reduce((s, sc) => s + (sc.durationSeconds || 0), 0);
  return [
    `FINAL DELIVERY PACKAGE — ${project.title}`,
    `Simulated final render for demonstration (no video pipeline in this build).`,
    `Contract v${contract.version} · ${contract.status} · approved ${contract.approvedAt?.toISOString().slice(0, 10) || 'n/a'}`,
    '',
    `== APPROVED SCRIPT (${total}s across ${scenes.length} scenes) ==`,
    script,
    '',
    `== STORYBOARD ==`,
    ...scenes.map(
      (sc) =>
        `Scene ${sc.sceneNumber} (${sc.durationSeconds || 0}s) — ${sc.title}\n  ${sc.visualDirection || sc.description}\n  VO: ${sc.voiceover || '—'}`
    ),
    '',
    `== CLEARANCE ==`,
    `Assets: ${contract.approvedAssetIds.length} approved in the contract`,
    `Accessibility: ${contract.accessibilityRequirements.join('; ') || 'n/a'}`,
  ].join('\n');
}