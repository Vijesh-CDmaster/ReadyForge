import { ProjectType } from '../models/Project';

export interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  projectType: ProjectType;
  mode: 'solo' | 'team';
  brief: {
    objective: string;
    audience: string;
    tone: string;
    callToAction: string;
    deadlineDays: number;
    budgetAmount: number;
    currency: string;
    tags: string[];
  };
}

/**
 * Product-provided presets (spec §3.5). They are code, not database rows —
 * the client receives the same `kind: 'builtin'` shape as workspace templates.
 */
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'builtin:product_ad',
    name: 'Product ad',
    description: 'Short, benefit-led ad focused on one product and one action.',
    projectType: 'ad',
    mode: 'solo',
    brief: {
      objective: 'Drive purchases of the hero product with one clear, provable benefit.',
      audience: 'Existing category buyers comparing options',
      tone: 'Energetic and confident',
      callToAction: 'Shop now',
      deadlineDays: 14,
      budgetAmount: 3000,
      currency: 'INR',
      tags: ['product', 'performance'],
    },
  },
  {
    id: 'builtin:festival_campaign',
    name: 'Festival campaign',
    description: 'Seasonal campaign with urgency, offers and cultural fit checks.',
    projectType: 'social_post',
    mode: 'team',
    brief: {
      objective: 'Convert seasonal demand with a timely offer and culturally appropriate creative.',
      audience: 'Existing followers and festival shoppers',
      tone: 'Warm, celebratory, urgent',
      callToAction: 'Grab the festive offer',
      deadlineDays: 10,
      budgetAmount: 5000,
      currency: 'INR',
      tags: ['seasonal', 'offer'],
    },
  },
  {
    id: 'builtin:product_launch',
    name: 'Product launch',
    description: 'Multi-asset launch sequence: tease, announce, convert.',
    projectType: 'video',
    mode: 'team',
    brief: {
      objective: 'Announce the launch and drive first-week signups or purchases.',
      audience: 'Early adopters and existing customers',
      tone: 'Confident and visionary',
      callToAction: 'Be first to try it',
      deadlineDays: 30,
      budgetAmount: 12000,
      currency: 'INR',
      tags: ['launch', 'multi-channel'],
    },
  },
  {
    id: 'builtin:explainer_video',
    name: 'Explainer video',
    description: 'Problem → mechanism → outcome script with a storyboard rung.',
    projectType: 'video',
    mode: 'solo',
    brief: {
      objective: 'Explain how the product works and why it matters in under 60 seconds.',
      audience: 'Prospects who do not yet understand the category',
      tone: 'Clear, friendly, educational',
      callToAction: 'Learn more',
      deadlineDays: 21,
      budgetAmount: 8000,
      currency: 'INR',
      tags: ['explainer', 'education'],
    },
  },
  {
    id: 'builtin:social_campaign',
    name: 'Social campaign',
    description: 'Platform-native post series with hook variations for testing.',
    projectType: 'social_post',
    mode: 'solo',
    brief: {
      objective: 'Grow engagement with a repeatable post series and testable hooks.',
      audience: 'Followers on the primary social platform',
      tone: 'Conversational and punchy',
      callToAction: 'Follow for more',
      deadlineDays: 7,
      budgetAmount: 1500,
      currency: 'INR',
      tags: ['social', 'series'],
    },
  },
  {
    id: 'builtin:customer_testimonial',
    name: 'Customer testimonial',
    description: 'Evidence-led story built from an approved customer quote.',
    projectType: 'video',
    mode: 'team',
    brief: {
      objective: 'Build trust by showing a real customer outcome with approved evidence.',
      audience: 'Skeptical late-stage prospects',
      tone: 'Authentic and grounded',
      callToAction: 'See how it works',
      deadlineDays: 14,
      budgetAmount: 5000,
      currency: 'INR',
      tags: ['social-proof', 'trust'],
    },
  },
  {
    id: 'builtin:founder_story',
    name: 'Founder story',
    description: 'Origin narrative connecting the founder’s why to the customer’s need.',
    projectType: 'video',
    mode: 'solo',
    brief: {
      objective: 'Humanise the brand with the origin story behind the product.',
      audience: 'Community and early supporters',
      tone: 'Personal, honest, inspiring',
      callToAction: 'Join the journey',
      deadlineDays: 21,
      budgetAmount: 4000,
      currency: 'INR',
      tags: ['brand', 'narrative'],
    },
  },
  {
    id: 'builtin:educational_content',
    name: 'Educational content',
    description: 'Teach one concept per piece; claims stay tied to approved facts.',
    projectType: 'blog',
    mode: 'solo',
    brief: {
      objective: 'Teach one useful concept well enough that readers act on it.',
      audience: 'People researching the problem',
      tone: 'Helpful and precise',
      callToAction: 'Read the guide',
      deadlineDays: 10,
      budgetAmount: 1000,
      currency: 'INR',
      tags: ['content', 'seo'],
    },
  },
];