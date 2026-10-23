import { aiJson } from './client';
import { ProjectType } from '../models/Project';

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

export async function classifyProject(description: string): Promise<AiResultLike<Classification>> {
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

function classifyFallback(description: string): Classification {
  const text = description.toLowerCase();
  let projectType: ProjectType = 'custom';
  if (/\b(ad|advertisement|commercial|30[- ]?sec|15[- ]?sec|20[- ]?sec)\b/.test(text)) projectType = 'ad';
  else if (/\b(video|reel|short|promo|animatic|trailer)\b/.test(text)) projectType = 'video';
  else if (/\b(post|linkedin|instagram|tweet|thread|caption)\b/.test(text)) projectType = 'social_post';
  else if (/\b(blog|article|essay|seo)\b/.test(text)) projectType = 'blog';
  else if (/\b(presentation|deck|slide|pitch)\b/.test(text)) projectType = 'presentation';
  else if (/\b(landing page|landing|squeeze page)\b/.test(text)) projectType = 'landing_page';

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
