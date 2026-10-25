import { IProject } from '../models/Project';
import { IKnowledgeInput } from '../models/KnowledgeInput';
import { IConflict } from '../models/Conflict';
import { IGenerationTask } from '../models/GenerationTask';
import { IProductionContract } from '../models/ProductionContract';
import { ICreativeVariant } from '../models/CreativeVariant';

/**
 * Pre-Flight Performance Forecast (spec §2 item 3)
 *
 * A transparent, deterministic scoring model that estimates how the creative is
 * likely to perform BEFORE the team pays for final generation. Every dimension
 * carries the evidence that moved it, so the forecast is explainable rather than
 * a black box. It is decision support, not a performance guarantee.
 */

export interface ForecastDimension {
  key: string;
  label: string;
  score: number; // 0–100
  evidence: string[];
}

export interface PreflightForecast {
  dimensions: ForecastDimension[];
  attention: number;
  messageClarity: number;
  hookStrength: number;
  audienceFit: number;
  fatigueRisk: 'low' | 'medium' | 'high';
  overall: number;
  recommendation: string;
  disclaimer: string;
}

const HOOK_POWER_WORDS = [
  'finally', 'stop', 'now', 'before', 'secret', 'proven', 'free', 'new',
  'imagine', 'meet', 'introducing', 'why', 'how', 'save', 'built', 'made',
];

const AGGRESSIVE_WORDS = ['revolutionary', '10x', 'guaranteed', 'instantly', 'miracle', 'best-ever', 'unbeatable'];

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function computePreflightForecast(opts: {
  project: IProject;
  inputs: IKnowledgeInput[];
  conflicts: IConflict[];
  tasks: IGenerationTask[];
  contract: IProductionContract | null;
  variants: ICreativeVariant[];
}): PreflightForecast {
  const { project, inputs, conflicts, tasks, contract, variants } = opts;
  const approved = inputs.filter((i) => i.status === 'approved');
  const approvedFacts = approved.filter((i) => ['fact', 'price', 'claim'].includes(i.type));
  const audienceInputs = approved.filter((i) => i.type === 'audience');
  const openConflicts = conflicts.filter((c) => c.status === 'open' || c.status === 'awaiting_decision');

  const keyMessage = contract?.keyMessage || project.description || project.objective || '';
  const cta = contract?.callToAction || project.callToAction || '';
  const tone = contract?.tone || project.tone || '';
  const allText = `${keyMessage} ${variants.map((v) => `${v.hook} ${v.script}`).join(' ')} ${contract?.contentPlan?.script || ''}`.toLowerCase();

  /* ---- Attention potential ---- */
  const attentionEv: string[] = [];
  let attention = 50;
  if (keyMessage) { attention += 15; attentionEv.push('Campaign has a defined key message to open with.'); }
  else attentionEv.push('No key message — the opening frame has nothing to land on.');
  const numericHook = /\b\d+%|\b\d+x\b/.test(allText);
  if (numericHook) { attention += 12; attentionEv.push('Copy uses a concrete number, which raises stopping power.'); }
  if (variants.length >= 2) { attention += 8; attentionEv.push('Two variants exist — attention can be A/B tested instead of guessed.'); }
  if (cta) { attention += 10; attentionEv.push(`CTA "${cta}" gives the viewer a next step.`); }
  else attentionEv.push('No call to action defined.');
  if (AGGRESSIVE_WORDS.some((w) => allText.includes(w))) {
    attention -= 10;
    attentionEv.push('Hyperbolic language ("' + AGGRESSIVE_WORDS.find((w) => allText.includes(w)) + '") triggers scepticism.');
  }

  /* ---- Message clarity ---- */
  const clarityEv: string[] = [];
  let clarity = 40;
  if (contract?.status === 'approved' || contract?.status === 'locked') { clarity += 25; clarityEv.push('Production Contract approved — the message is locked.'); }
  else if (contract) { clarity += 10; clarityEv.push(`Contract is ${contract.status} — message may still shift.`); }
  else clarityEv.push('No Production Contract yet — message is unanchored.');
  if (approvedFacts.length >= 3) { clarity += 15; clarityEv.push(`${approvedFacts.length} approved facts back the message.`); }
  else if (approvedFacts.length > 0) { clarity += 7; clarityEv.push(`Only ${approvedFacts.length} approved fact(s) — thin evidence base.`); }
  else clarityEv.push('No approved facts — the message rests on unverified assertions.');
  if (openConflicts.length) { clarity -= Math.min(25, openConflicts.length * 8); clarityEv.push(`${openConflicts.length} unresolved conflict(s) still change what the message says.`); }
  else clarityEv.push('No unresolved conflicts distort the message.');

  /* ---- Hook strength ---- */
  const hooks = variants.map((v) => v.hook).filter(Boolean);
  const hookEv: string[] = [];
  let hook = 45;
  if (hooks.length) {
    hook += 20;
    hookEv.push(`Variants ship explicit hooks: "${hooks[0].slice(0, 60)}"`);
    const powerCount = hooks.filter((h) => HOOK_POWER_WORDS.some((w) => h.toLowerCase().includes(w))).length;
    if (powerCount) { hook += 10; hookEv.push('Hook uses action/power language.'); }
    const avgLen = hooks.reduce((s, h) => s + h.split(/\s+/).length, 0) / hooks.length;
    if (avgLen <= 12) { hook += 10; hookEv.push('Hooks are short enough to read in the first seconds.'); }
    else hookEv.push('Hooks are wordy — trim toward ≤12 words for the opening frame.');
  } else {
    hookEv.push('No variants or hook written yet — hook strength cannot be tested.');
    if (keyMessage) { hook += 8; hookEv.push('A key message exists to promote into a hook.'); }
  }

  /* ---- Audience fit ---- */
  const fitEv: string[] = [];
  let fit = 45;
  if (audienceInputs.length) { fit += 20; fitEv.push(`${audienceInputs.length} approved audience definition(s) on file.`); }
  else fitEv.push('No confirmed audience — tone and offer are aimed at nobody.');
  const premiumTone = /premium|calm|quiet|luxur|minimal|elegant|refined/.test(tone.toLowerCase());
  const discountSignal = /\b(off|discount|sale|hurry|limited|deal|%)\b/.test(allText);
  if (premiumTone && discountSignal) {
    fit -= 20;
    fitEv.push('Mixed signal: premium tone combined with discount language splits the audience response.');
  } else if (premiumTone || discountSignal) {
    fit += 10;
    fitEv.push('Tone and offer pull in the same direction.');
  }
  const toneAudienceConflicts = openConflicts.filter((c) => c.conflictType === 'audience' || c.conflictType === 'tone');
  if (toneAudienceConflicts.length) { fit -= 10; fitEv.push('Open audience/tone conflicts directly degrade audience fit.'); }

  /* ---- Fatigue risk (inversely scored; higher = fresher) ---- */
  const fatigueEv: string[] = [];
  const rejections = tasks.filter((t) => t.reviewStatus === 'rejected').length;
  const regens = tasks.filter((t) => t.attempt > 1).length;
  const reviewed = tasks.filter((t) => t.reviewStatus === 'approved' || t.reviewStatus === 'rejected').length;
  const reuse = variants.length > 0 ? new Set(variants.map((v => v.hook.toLowerCase()))).size : 0;
  let fatigueFreshness = 75;
  if (reviewed > 0) {
    const rejectRate = rejections / reviewed;
    if (rejectRate >= 0.5) { fatigueFreshness -= 25; fatigueEv.push(`${Math.round(rejectRate * 100)}% rejection rate — the creative has been through many rework cycles.`); }
    else fatigueEv.push('Rejection rate is healthy — outputs are passing review first time.');
  } else fatigueEv.push('No review history yet — fatigue cannot be measured from rework.');
  if (regens >= 3) { fatigueFreshness -= 15; fatigueEv.push(`${regens} regenerated outputs — repetition risk is rising.`); }
  if (reuse && reuse < variants.length) { fatigueEv.push('Variants repeat the same hook — audiences may see sameness.'); }
  else fatigueEv.push('Variants differ in hook — no intra-campaign repetition detected.');
  const fatigueRisk: 'low' | 'medium' | 'high' = fatigueFreshness >= 70 ? 'low' : fatigueFreshness >= 45 ? 'medium' : 'high';

  const dimensions: ForecastDimension[] = [
    { key: 'attention', label: 'Attention potential', score: clamp(attention), evidence: attentionEv },
    { key: 'clarity', label: 'Message clarity', score: clamp(clarity), evidence: clarityEv },
    { key: 'hook', label: 'Hook strength', score: clamp(hook), evidence: hookEv },
    { key: 'fit', label: 'Audience fit', score: clamp(fit), evidence: fitEv },
    { key: 'freshness', label: 'Creative freshness', score: clamp(fatigueFreshness), evidence: fatigueEv },
  ];

  const overall = clamp(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);
  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
  const strongest = [...dimensions].sort((a, b) => b.score - a.score)[0];

  const recommendation =
    `Attention rides on ${strongest.label.toLowerCase()} (${strongest.score}). ` +
    `Fix ${weakest.label.toLowerCase()} first (${weakest.score}): ${weakest.evidence[0]} ` +
    (overall >= 70
      ? 'Forecast is strong — safe to spend on the next ladder stage.'
      : overall >= 50
        ? 'Forecast is workable — resolve the weakest dimension before final render.'
        : 'Forecast is weak — generating now is likely to waste budget; fix the weakest dimension first.');

  return {
    dimensions,
    attention: dimensions[0].score,
    messageClarity: dimensions[1].score,
    hookStrength: dimensions[2].score,
    audienceFit: dimensions[3].score,
    fatigueRisk,
    overall,
    recommendation,
    disclaimer:
      'Pre-flight forecast is a transparent rule-based decision-support estimate, not a guarantee of real-world performance.',
  };
}