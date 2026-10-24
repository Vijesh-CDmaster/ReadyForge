import { aiJson } from './client';
import { verifyClaims } from './claims';
import { IProject } from '../models/Project';
import { IProductionContract, IStoryboardScene } from '../models/ProductionContract';
import { IKnowledgeInput } from '../models/KnowledgeInput';
import { IAsset } from '../models/Asset';
import { CheckStatus, IVerificationCheck } from '../models/VerificationReport';

/**
 * Output Verification Agent — compares generated output against the approved
 * Production Contract (spec §6.10 / §10).
 *
 * Deterministic checks (rights, budget, scenes, accessibility, claims) are computed
 * directly so they always run; the semantic checks (intent, brand, tone) go through
 * the OpenAI-compatible client with a rule fallback, same as the rest of the AI layer.
 * Claim verification reuses verifyClaims, which itself applies the locally trained
 * NLI model — so the trained model participates in final verification too.
 */

export interface VerifyInput {
  project: IProject;
  contract: IProductionContract;
  assets: IAsset[];
  approvedFacts: IKnowledgeInput[];
  script: string;
  scenes: IStoryboardScene[];
  /** Workspace Brand DNA (banned words, tone, legal restrictions) when available. */
  brandDna?: {
    brandName?: string;
    tone?: string;
    bannedWords?: string[];
    targetAudience?: string;
    legalRestrictions?: string[];
  } | null;
}

export interface VerifyOutcome {
  report: { status: 'passed' | 'warning' | 'failed'; overallScore: number; summary: string; checks: IVerificationCheck[] };
  source: 'ai' | 'rule_engine';
  model: string;
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

function overlapRatio(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  ta.forEach((w) => {
    if (tb.has(w)) shared += 1;
  });
  return shared / Math.min(ta.size, tb.size);
}

export async function verifyOutput(input: VerifyInput): Promise<VerifyOutcome> {
  const { project, contract, assets, approvedFacts, script, scenes } = input;
  const checks: IVerificationCheck[] = [];

  /* ---- rights (deterministic, blocking) ---- */
  const uncleared = assets.filter(
    (a) => a.licenseStatus === 'unknown' || a.licenseStatus === 'restricted' || a.licenseStatus === 'expired'
  );
  if (uncleared.length) {
    checks.push({
      checkType: 'rights',
      status: 'failed',
      severity: 'critical',
      message: `${uncleared.length} asset(s) are not cleared for final generation`,
      evidence: uncleared.map((a) => `${a.name} — licence status "${a.licenseStatus}"`).join('; '),
      suggestedFix: 'Upload licence evidence or replace the asset, then re-run verification.',
    });
  } else {
    checks.push({
      checkType: 'rights',
      status: 'passed',
      severity: 'low',
      message: assets.length ? `All ${assets.length} project asset(s) carry a usable licence` : 'No assets in scope',
      evidence: assets.length ? assets.map((a) => `${a.name} (${a.licenseStatus})`).join('; ') : 'Nothing to clear.',
    });
  }

  /* ---- budget (deterministic) ---- */
  if (!contract.budgetLimit && !project.budget.amount) {
    checks.push({
      checkType: 'budget',
      status: 'warning',
      severity: 'medium',
      message: 'No budget is set for this project',
      evidence: 'Budget feasibility could not be verified.',
      suggestedFix: 'Set a project budget so cost-at-risk and generation guards are meaningful.',
    });
  } else if (project.budget.spent > project.budget.amount) {
    checks.push({
      checkType: 'budget',
      status: 'failed',
      severity: 'high',
      message: `Spending exceeds the budget by ${project.budget.currency} ${project.budget.spent - project.budget.amount}`,
      evidence: `Spent ${project.budget.spent} of ${project.budget.amount} ${project.budget.currency}.`,
      suggestedFix: 'Request finance_owner approval or reduce scope before generating further.',
    });
  } else {
    checks.push({
      checkType: 'budget',
      status: 'passed',
      severity: 'low',
      message: `Within budget: ${project.budget.spent}/${project.budget.amount} ${project.budget.currency} spent`,
      evidence: `${project.budget.remaining} ${project.budget.currency} remaining.`,
    });
  }

  /* ---- scene completeness (deterministic) ---- */
  if (!scenes.length) {
    checks.push({
      checkType: 'scene_completeness',
      status: 'failed',
      severity: 'high',
      message: 'Storyboard has no scenes',
      evidence: 'A final output cannot be verified against an empty storyboard.',
      suggestedFix: 'Generate and approve the storyboard rung first.',
    });
  } else {
    const incomplete = scenes.filter((s) => !s.description || !s.voiceover);
    const failedScenes = scenes.filter((s) => s.status === 'failed');
    if (failedScenes.length) {
      checks.push({
        checkType: 'scene_completeness',
        status: 'failed',
        severity: 'high',
        message: `${failedScenes.length} scene(s) are marked failed`,
        evidence: failedScenes.map((s) => `Scene ${s.sceneNumber} — ${s.title}`).join('; '),
        suggestedFix: 'Regenerate the failed scenes before approval.',
      });
    } else if (incomplete.length) {
      checks.push({
        checkType: 'scene_completeness',
        status: 'warning',
        severity: 'medium',
        message: `${incomplete.length} scene(s) are missing narration or visual direction`,
        evidence: incomplete.map((s) => `Scene ${s.sceneNumber} — ${s.title}`).join('; '),
        suggestedFix: 'Fill in voiceover/description for the flagged scenes.',
      });
    } else {
      const total = scenes.reduce((sum, s) => sum + (s.durationSeconds || 0), 0);
      checks.push({
        checkType: 'scene_completeness',
        status: 'passed',
        severity: 'low',
        message: `${scenes.length} complete scene(s), ${total}s total`,
        evidence: scenes.map((s) => `Scene ${s.sceneNumber} (${s.durationSeconds || 0}s)`).join(', '),
      });
    }
  }

  /* ---- accessibility (deterministic) ---- */
  if (!contract.accessibilityRequirements.length) {
    checks.push({
      checkType: 'accessibility',
      status: 'warning',
      severity: 'medium',
      message: 'No accessibility requirements captured in the contract',
      evidence: 'Captions/contrast requirements were never supplied.',
      suggestedFix: 'Add accessibility requirements as a Knowledge Input and regenerate the contract.',
    });
  } else {
    const hasCaptions = /caption|subtitle|contrast|alt text|aria|transcript/i.test(script);
    checks.push(
      hasCaptions
        ? {
            checkType: 'accessibility',
            status: 'passed',
            severity: 'low',
            message: 'Script references the contract accessibility requirements',
            evidence: contract.accessibilityRequirements.join('; '),
          }
        : {
            checkType: 'accessibility',
            status: 'warning',
            severity: 'medium',
            message: 'Script does not reference the required accessibility treatment',
            evidence: `Contract requires: ${contract.accessibilityRequirements.join('; ')}`,
            suggestedFix: 'Add captions/contrast notes to the script before approval.',
          }
    );
  }

  /* ---- claim verification (rules + LLM + local trained model) ---- */
  const claimResult = await verifyClaims({ content: script, approvedFacts });
  const unsupported = claimResult.checks.filter((c) => c.status === 'unsupported');
  const partial = claimResult.checks.filter((c) => c.status === 'partially_supported');
  const verified = claimResult.checks.filter((c) => c.status === 'verified');

  if (!script.trim()) {
    checks.push({
      checkType: 'claim_verification',
      status: 'failed',
      severity: 'high',
      message: 'There is no script to verify',
      evidence: 'Generate the script rung before verifying output.',
    });
  } else if (unsupported.length) {
    checks.push({
      checkType: 'claim_verification',
      status: 'failed',
      severity: 'high',
      message: `${unsupported.length} claim(s) are not backed by approved facts`,
      evidence: unsupported
        .slice(0, 4)
        .map((c) => `“${c.claim}” — ${c.evidence}`)
        .join(' | '),
      sourceInputId: unsupported.find((c) => c.sourceInputId)?.sourceInputId as never,
      suggestedFix: unsupported.find((c) => c.saferRewrite)?.saferRewrite || 'Remove or approve a supporting fact.',
    });
  } else if (partial.length) {
    checks.push({
      checkType: 'claim_verification',
      status: 'warning',
      severity: 'medium',
      message: `${partial.length} claim(s) only partially supported by approved facts`,
      evidence: partial.slice(0, 3).map((c) => `“${c.claim}” — ${c.evidence}`).join(' | '),
      sourceInputId: partial.find((c) => c.sourceInputId)?.sourceInputId as never,
      suggestedFix: partial.find((c) => c.saferRewrite)?.saferRewrite || 'Tighten the wording to the approved fact.',
    });
  } else if (!claimResult.checks.length) {
    checks.push({
      checkType: 'claim_verification',
      status: 'warning',
      severity: 'low',
      message: 'No factual or promotional claims detected in the script',
      evidence: 'Nothing to check against the Knowledge Ledger.',
    });
  } else {
    checks.push({
      checkType: 'claim_verification',
      status: 'passed',
      severity: 'low',
      message: `All ${verified.length} claim(s) are backed by approved facts`,
      evidence: verified.slice(0, 3).map((c) => `“${c.claim}” → ${c.evidence}`).join(' | '),
    });
  }

  /* ---- brand DNA guardrails: banned words + legal restrictions (deterministic) ---- */
  const bannedHits = (input.brandDna?.bannedWords || []).filter((w) =>
    w.trim() && script.toLowerCase().includes(w.trim().toLowerCase())
  );
  if (input.brandDna?.bannedWords?.length && bannedHits.length) {
    checks.push({
      checkType: 'brand_fit',
      status: 'failed',
      severity: 'high',
      message: `${bannedHits.length} banned word(s) from the Brand DNA appear in the script`,
      evidence: `Banned words found: ${bannedHits.map((w) => `“${w}”`).join(', ')}`,
      suggestedFix: `Rewrite the flagged lines without ${bannedHits.map((w) => `“${w}”`).join(', ')}.`,
    });
  }

  /* ---- semantic checks: intent, brand, tone (LLM with rule fallback) ---- */
  const semantic = await aiJson<IVerificationCheck[]>({
    system: `You are ReadyForge's Output Verification Agent.
Compare the draft content with the Production Contract and return a JSON ARRAY of exactly
three objects with checkType "intent_alignment", "brand_fit" and "tone".
Each object: { checkType, status: "passed"|"warning"|"failed", severity: "low"|"medium"|"high"|"critical",
message, evidence, suggestedFix }.
Judge: does the content serve the contract objective/key message/CTA (intent), follow the brand
rules (brand_fit), and match the contract tone (tone)? Evidence must quote the content or contract.
Never invent facts. If evidence is missing, mark the check "warning".`,
    user: JSON.stringify({
      contract: {
        objective: contract.objective,
        keyMessage: contract.keyMessage,
        callToAction: contract.callToAction,
        tone: contract.tone,
        brandRules: contract.brandRules,
      },
      content: script.slice(0, 6000),
    }),
    fallback: () => semanticFallback(input),
  });
  for (const c of Array.isArray(semantic.data) ? semantic.data : []) {
    if (c && c.checkType) {
      // A banned-word brand_fit failure already covers brand compliance this run.
      if (c.checkType === 'brand_fit' && bannedHits.length) continue;
      checks.push({
        checkType: c.checkType,
        status: (['passed', 'warning', 'failed'].includes(c.status) ? c.status : 'warning') as CheckStatus,
        severity: c.severity || 'medium',
        message: c.message || '',
        evidence: c.evidence || 'Evidence unavailable.',
        suggestedFix: c.suggestedFix,
      });
    }
  }

  const passed = checks.filter((c) => c.status === 'passed').length;
  const failed = checks.filter((c) => c.status === 'failed');
  const warned = checks.filter((c) => c.status === 'warning');
  const status: 'passed' | 'warning' | 'failed' = failed.length ? 'failed' : warned.length ? 'warning' : 'passed';
  const overallScore = checks.length ? Math.round((passed / checks.length) * 100) : 0;

  const summary =
    failed.length
      ? `${failed.length} blocking issue(s): ${failed.map((f) => f.message).join('; ')}`
      : warned.length
        ? `No blockers, ${warned.length} warning(s) to review: ${warned.map((w) => w.message).join('; ')}`
        : 'All checks passed — output matches the approved Production Contract.';

  return {
    report: { status, overallScore, summary, checks },
    source: semantic.source,
    model: semantic.model,
  };
}

function semanticFallback(input: VerifyInput): IVerificationCheck[] {
  const { contract, script, project } = input;
  const content = script || '';

  const intentScore = overlapRatio(
    content,
    [contract.objective, contract.keyMessage, contract.callToAction, project.objective].filter(Boolean).join(' ')
  );
  const intent: IVerificationCheck =
    intentScore >= 0.25
      ? {
          checkType: 'intent_alignment',
          status: 'passed',
          severity: 'low',
          message: 'Content clearly serves the contract objective and CTA',
          evidence: `Keyword overlap with the contract intent: ${Math.round(intentScore * 100)}%.`,
        }
      : {
          checkType: 'intent_alignment',
          status: intentScore >= 0.1 ? 'warning' : 'failed',
          severity: intentScore >= 0.1 ? 'medium' : 'high',
          message: 'Content barely references the contract objective or CTA',
          evidence: `Keyword overlap with the contract intent: ${Math.round(intentScore * 100)}%. Contract CTA: “${contract.callToAction || 'unset'}”.`,
          suggestedFix: 'Restate the key message and CTA in the closing beat.',
        };

  const brand: IVerificationCheck = !contract.brandRules.length
    ? {
        checkType: 'brand_fit',
        status: 'warning',
        severity: 'medium',
        message: 'No brand rules captured in the contract',
        evidence: 'Brand fit cannot be checked without brand rules.',
        suggestedFix: 'Add visual_rule/brand Knowledge Inputs and regenerate the contract.',
      }
    : (() => {
        const rules = contract.brandRules.join(' ');
        const score = overlapRatio(content, rules);
        return score >= 0.15
          ? {
              checkType: 'brand_fit',
              status: 'passed' as const,
              severity: 'low' as const,
              message: 'Content references the contract brand rules',
              evidence: `Rules: ${contract.brandRules.slice(0, 3).join('; ')}`,
            }
          : {
              checkType: 'brand_fit',
              status: 'warning' as const,
              severity: 'medium' as const,
              message: 'Content does not reflect the captured brand rules',
              evidence: `Rules: ${contract.brandRules.slice(0, 3).join('; ')} (overlap ${Math.round(score * 100)}%)`,
              suggestedFix: 'Align wording/visual notes with the brand rules before approval.',
            };
      })();

  const toneWanted = contract.tone || project.tone || '';
  const tone: IVerificationCheck = !toneWanted
    ? {
        checkType: 'tone',
        status: 'warning',
        severity: 'low',
        message: 'No tone specified in the contract',
        evidence: 'Tone consistency cannot be checked.',
        suggestedFix: 'Capture a tone input and regenerate the contract.',
      }
    : (() => {
        const wanted = toneWanted.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3);
        const hit = wanted.find((w) => content.toLowerCase().includes(w));
        return hit
          ? {
              checkType: 'tone' as const,
              status: 'passed' as const,
              severity: 'low' as const,
              message: `Tone "${toneWanted}" is reflected in the content`,
              evidence: `Contract tone: ${toneWanted}`,
            }
          : {
              checkType: 'tone' as const,
              status: 'warning' as const,
              severity: 'low' as const,
              message: `Cannot confirm the "${toneWanted}" tone from the content`,
              evidence: `Contract tone: ${toneWanted}. No matching language cues found.`,
              suggestedFix: 'Review the script voice and adjust wording to the contract tone.',
            };
      })();

  return [intent, brand, tone];
}