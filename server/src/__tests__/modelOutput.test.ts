import { describe, it, expect, vi, afterEach } from 'vitest';
import { translateMood } from '../ai/taste';
import { normalizeEvidence } from '../ai/verify';
import { normalizeVariantAudience } from '../routes/intelligence';
import { config } from '../config';

/**
 * Regression tests for the residual smoke-suite defects (F1–F3):
 *
 * F1 — POST /taste/mood crashed with `TypeError: Cannot read properties of null
 *      (reading 'slice')` at routes/taste.ts:229 because translateMood accepted
 *      a model answer whose `music` was null.
 * F2 — the semantic verification agent returned `evidence` as an array, which
 *      Cast-errored the VerificationReport String field → 500.
 * F3 — the variant matrix generator returned `audience` as an object, which
 *      Cast-errored CreativeVariant.audience (String, max 400) → 500.
 */

/** Stub the OpenAI-compatible endpoint with a raw model answer. */
function stubModel(content: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] }),
    }))
  );
}

const originalApiKey = config.ai.apiKey;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  config.ai.apiKey = originalApiKey;
});

/* ---------------- F1: Mood-to-Style Translator ---------------- */

describe('translateMood — malformed model output must fall back safely (F1)', () => {
  it('rejects an answer with `music: null` and returns a direction the apply path can use', async () => {
    config.ai.apiKey = 'test-key';
    stubModel(
      JSON.stringify({
        mood: 'Premium and calm',
        color: 'MODEL-COLOR',
        motion: 'MODEL-MOTION',
        music: null, // ← the field that crashed routes/taste.ts:229
        typography: 'MODEL-TYPOGRAPHY',
        pacing: 'MODEL-PACING',
        story: 'MODEL-STORY',
        summary: 'MODEL-SUMMARY',
      })
    );

    const result = await translateMood('Premium and calm');
    expect(result.source).toBe('rule_engine');
    expect(result.model).toBe('readyforge-rules');
    // The fallback direction must be used — no model value leaks through.
    expect(result.direction.music).not.toBe('MODEL-COLOR');
    expect(result.direction.music).toBeTypeOf('string');

    // Reproduce exactly what the route's apply:true path does with the result.
    const d = result.direction;
    expect(() => {
      const palette = d.color
        .split(',')
        .map((s) => s.trim())
        .slice(0, 4);
      expect(palette.length).toBeGreaterThan(0);
      const music = d.music.slice(0, 60); // used to throw TypeError on null
      expect(music.length).toBeGreaterThan(0);
      const pacing = d.pacing;
      const story = d.story;
      expect(typeof pacing).toBe('string');
      expect(typeof story).toBe('string');
    }).not.toThrow();
  });

  it('rejects an answer missing a required field (pacing)', async () => {
    config.ai.apiKey = 'test-key';
    stubModel(
      JSON.stringify({
        mood: 'x',
        color: 'MODEL-COLOR',
        motion: 'MODEL-MOTION',
        music: 'MODEL-MUSIC',
        typography: 'MODEL-TYPOGRAPHY',
        story: 'MODEL-STORY',
        summary: 'MODEL-SUMMARY',
      })
    );

    const result = await translateMood('x');
    expect(result.source).toBe('rule_engine');
    expect(result.direction.color).not.toBe('MODEL-COLOR');
  });

  it('rejects an answer with a wrong-typed field (color: number)', async () => {
    config.ai.apiKey = 'test-key';
    stubModel(
      JSON.stringify({
        mood: 'x',
        color: 123,
        motion: 'MODEL-MOTION',
        music: 'MODEL-MUSIC',
        typography: 'MODEL-TYPOGRAPHY',
        pacing: 'MODEL-PACING',
        story: 'MODEL-STORY',
        summary: 'MODEL-SUMMARY',
      })
    );

    const result = await translateMood('x');
    expect(result.source).toBe('rule_engine');
    expect(result.direction.color).not.toBe('123');
  });

  it('rejects an answer with an empty-string field (music: "")', async () => {
    config.ai.apiKey = 'test-key';
    stubModel(
      JSON.stringify({
        mood: 'x',
        color: 'MODEL-COLOR',
        motion: 'MODEL-MOTION',
        music: '',
        typography: 'MODEL-TYPOGRAPHY',
        pacing: 'MODEL-PACING',
        story: 'MODEL-STORY',
        summary: 'MODEL-SUMMARY',
      })
    );

    const result = await translateMood('x');
    expect(result.source).toBe('rule_engine');
    expect(result.direction.music.trim().length).toBeGreaterThan(0);
  });

  it('accepts a complete model answer and keeps AI attribution', async () => {
    config.ai.apiKey = 'test-key';
    stubModel(
      JSON.stringify({
        mood: 'Premium and calm',
        color: 'warm cream, gold accents',
        motion: 'slow zooms',
        music: 'soft piano',
        typography: 'serif display',
        pacing: 'slow build',
        story: 'problem to resolution',
        summary: 'calm premium direction',
      })
    );

    const result = await translateMood('Premium and calm');
    expect(result.source).toBe('ai');
    expect(result.direction.color).toBe('warm cream, gold accents');
    expect(result.direction.music).toBe('soft piano');
    expect(result.direction.pacing).toBe('slow build');
  });

  it('keeps source attribution honest when the response fails to parse at all', async () => {
    config.ai.apiKey = 'test-key';
    stubModel('this is not JSON at all');

    const result = await translateMood('x');
    expect(result.source).toBe('rule_engine');
    expect(typeof result.direction.music).toBe('string');
  });

  it('does not crash when a platform suffix is applied to fallback output', async () => {
    config.ai.apiKey = 'test-key';
    stubModel(JSON.stringify({ mood: 'x', color: 'MODEL-COLOR' }));

    const result = await translateMood('x', { platform: 'web' });
    expect(result.source).toBe('rule_engine');
    expect(result.direction.summary).toContain('Tuned for web');
  });
});

/* ---------------- F2: verification evidence ---------------- */

describe('normalizeEvidence — evidence must fit the String schema field (F2)', () => {
  it('joins an array of strings with "; "', () => {
    expect(normalizeEvidence(['Support beat 1 visuals', 'Quick hook for trial sign-ups'])).toBe(
      'Support beat 1 visuals; Quick hook for trial sign-ups'
    );
  });

  it('drops non-string elements from an array but keeps readable ones', () => {
    expect(normalizeEvidence(['valid line', 42, null, { a: 1 }, 'second'])).toBe('valid line; 42; second');
  });

  it('falls back for an array with no usable elements', () => {
    expect(normalizeEvidence([{ a: 1 }, null, undefined])).toBe('Evidence unavailable.');
    expect(normalizeEvidence([])).toBe('Evidence unavailable.');
  });

  it('preserves a non-empty string as-is (trimmed)', () => {
    expect(normalizeEvidence('  Contract requires captions.  ')).toBe('Contract requires captions.');
  });

  it('falls back for missing or invalid values', () => {
    expect(normalizeEvidence('')).toBe('Evidence unavailable.');
    expect(normalizeEvidence('   ')).toBe('Evidence unavailable.');
    expect(normalizeEvidence(null)).toBe('Evidence unavailable.');
    expect(normalizeEvidence(undefined)).toBe('Evidence unavailable.');
    expect(normalizeEvidence(17)).toBe('Evidence unavailable.');
    expect(normalizeEvidence({ ageRange: '18-45' })).toBe('Evidence unavailable.');
  });
});

/* ---------------- F3: creative variant audience ---------------- */

describe('normalizeVariantAudience — audience must fit the String(400) schema field (F3)', () => {
  it('preserves a normal string', () => {
    expect(normalizeVariantAudience('Quality-focused buyers', 'fallback')).toBe('Quality-focused buyers');
  });

  it('trims and caps a long string at 400 characters', () => {
    const long = `  ${'x'.repeat(500)}  `;
    const out = normalizeVariantAudience(long, 'fallback');
    expect(out.length).toBe(400);
    expect(out).toBe('x'.repeat(400));
  });

  it('converts an object into its readable values', () => {
    expect(normalizeVariantAudience({ ageRange: '18-45', gender: 'all' }, 'fallback')).toBe('18-45, all');
  });

  it('converts an object with numeric values', () => {
    expect(normalizeVariantAudience({ minAge: 25, maxAge: 40 }, 'fallback')).toBe('25, 40');
  });

  it('converts an array of strings into a readable list', () => {
    expect(normalizeVariantAudience(['marketing leads', 'founders'], 'fallback')).toBe('marketing leads, founders');
  });

  it('never stores "[object Object]"', () => {
    expect(normalizeVariantAudience({ nested: { a: 1 } }, 'fallback')).toBe('fallback');
    expect(normalizeVariantAudience({}, 'fallback')).not.toContain('[object Object]');
  });

  it('uses the fallback for missing or invalid values', () => {
    expect(normalizeVariantAudience(null, 'Quality-focused buyers')).toBe('Quality-focused buyers');
    expect(normalizeVariantAudience(undefined, 'Quality-focused buyers')).toBe('Quality-focused buyers');
    expect(normalizeVariantAudience(123, 'Quality-focused buyers')).toBe('Quality-focused buyers');
    expect(normalizeVariantAudience('', 'Quality-focused buyers')).toBe('Quality-focused buyers');
    expect(normalizeVariantAudience([{ nested: 1 }, null], 'fallback')).toBe('fallback');
  });

  it('caps the fallback itself at 400 characters', () => {
    expect(normalizeVariantAudience(null, 'y'.repeat(500)).length).toBe(400);
  });
});