import { aiJson } from './client';
import { localAiEnabled, localClassify } from './local';
import { ProjectType, PROJECT_TYPES } from '../models/Project';

export interface Classification {
  projectType: ProjectType;
  contentType: string;
  estimatedDurationSeconds?: number;
  requiredInputs: string[];
  optionalInputs: string[];
  suggestedRoles: string[];
  risks: string[];
  recommendedWorkflow: string;
}

const REQUIRED_BY_TYPE: Record<string, string[]> = {
  video: ['audience', 'product_facts', 'brand_assets', 'call_to_action', 'budget', 'music_rights'],
  ad: ['audience', 'product_facts', 'brand_assets', 'call_to_action', 'budget', 'distribution_channel'],
  social_post: ['audience', 'product_facts', 'brand_voice', 'call_to_action'],
  blog: ['audience', 'key_message', 'sources', 'seo_keywords'],
  presentation: ['audience', 'key_message', 'brand_assets', 'data_sources'],
  landing_page: ['audience', 'key_message', 'call_to_action', 'proof_points', 'brand_assets'],
  custom: ['audience', 'objective', 'key_message'],
};

const OPTIONAL_BY_TYPE: string[] = ['tone', 'deadline', 'localisation', 'accessibility_requirements'];

/**
 * Classification runs in three stages:
 *   1. Deterministic keyword rules — high precision for explicit requests.
 *   2. Our trained model (DistilBERT fine-tuned on MNLI) as zero-shot classifier,
 *      used when the rules have no signal. This is where a learned model earns its
 *      keep: vague descriptions that keywords cannot map.
 *   3. The local LLM (and rules as its fallback).
 */
export async function classifyProject(description: string): Promise<AiResultLike<Classification>> {
  const ruleType = ruleProjectType(description);
  if (ruleType) {
    return { data: classifyFallback(description, ruleType), source: 'rule_engine', model: 'readyforge-rules' };
  }

  if (localAiEnabled()) {
    const local = await localClassify(description, PROJECT_TYPES, 'This content request is for {label}.');
    const top = local?.ranked?.[0];
    if (local && top && top.score >= 0.4) {
      return {
        data: classifyFallback(description, top.label as ProjectType),
        source: 'ai',
        model: 'readyforge-nli-distilbert',
      };
    }
  }

  return aiJson<Classification>({
    system: `You are ReadyForge's Project Classifier.
Classify the user's content request and identify missing information.
Return JSON with keys: projectType (one of video|social_post|ad|blog|presentation|landing_page|custom),
contentType, estimatedDurationSeconds (number|null), requiredInputs (array of snake_case strings),
optionalInputs (array), suggestedRoles (array of workspace roles), risks (array of strings),
recommendedWorkflow (short string).
Do not invent facts. If information is missing, list it as missing (empty arrays are fine).`,
    user: `Content request: "${description}"`,
    fallback: () => classifyFallback(description),
  });
}

type AiResultLike<T> = Awaited<ReturnType<typeof aiJson<T>>>;

/** Returns the project type when a keyword pattern matches, otherwise null (no signal). */
function ruleProjectType(description: string): ProjectType | null {
  const text = description.toLowerCase();
  if (/\b(ad|advertisement|commercial|30[- ]?sec|15[- ]?sec|20[- ]?sec)\b/.test(text)) return 'ad';
  if (/\b(video|reel|short|promo|animatic|trailer)\b/.test(text)) return 'video';
  if (/\b(post|linkedin|instagram|tweet|thread|caption)\b/.test(text)) return 'social_post';
  if (/\b(blog|article|essay|seo)\b/.test(text)) return 'blog';
  if (/\b(presentation|deck|slide|pitch)\b/.test(text)) return 'presentation';
  if (/\b(landing page|landing|squeeze page)\b/.test(text)) return 'landing_page';
  return null;
}

function classifyFallback(description: string, forcedType?: ProjectType): Classification {
  const text = description.toLowerCase();
  const projectType: ProjectType = forcedType ?? ruleProjectType(description) ?? 'custom';

  const durMatch = description.match(/(\d+)\s*(?:second|sec|s)\b/);
  const estimatedDurationSeconds = durMatch && projectType === 'ad' ? Number(durMatch[1]) : null;

  const risks: string[] = [];
  if (!/\bbudget|₹|\$|usd|inr\b/i.test(description)) risks.push('No budget supplied — cost-at-risk cannot be computed precisely');
  if (/\bclaim|guarantee|best|number one|#1\b/i.test(text)) risks.push('Promotional claims detected — requires approved fact backing');
  if (/\b(music|song|track)\b/i.test(text)) risks.push('Music rights must be cleared before final render');

  return {
    projectType,
    contentType: `${projectType}_content`,
    estimatedDurationSeconds: estimatedDurationSeconds ?? undefined,
    requiredInputs: REQUIRED_BY_TYPE[projectType],
    optionalInputs: OPTIONAL_BY_TYPE,
    suggestedRoles:
      projectType === 'video' || projectType === 'ad'
        ? ['owner', 'writer', 'designer', 'reviewer']
        : ['owner', 'writer', 'reviewer'],
    risks,
    recommendedWorkflow:
      'solo: adaptive questions → validation → intent brief → draft ladder. team: role inputs → conflicts → contract → draft ladder.',
  };
}