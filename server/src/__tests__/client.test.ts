import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseJson, aiJson, AiResult } from '../ai/client';
import { config } from '../config';

/** Stub OpenAI-compatible responses so aiJson exercises its real code path. */
function stubFetch(content: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] }),
    }))
  );
}

const originalAi = { ...config.ai };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  config.ai.apiKey = originalAi.apiKey;
  config.ai.baseUrl = originalAi.baseUrl;
  config.ai.model = originalAi.model;
});

describe('parseJson', () => {
  it('parses a plain JSON object', () => {
    expect(parseJson('{"a":1,"b":"x"}', () => 'FALLBACK')).toEqual({ a: 1, b: 'x' });
  });

  it('parses a plain JSON array (top-level arrays must not be discarded)', () => {
    expect(parseJson('[{"key":"a"},{"key":"b"},{"key":"c"}]', () => 'FALLBACK')).toEqual([
      { key: 'a' },
      { key: 'b' },
      { key: 'c' },
    ]);
  });

  it('parses a Markdown-fenced JSON object', () => {
    expect(parseJson('```json\n{"ok":true}\n```', () => 'FALLBACK')).toEqual({ ok: true });
  });

  it('parses a Markdown-fenced JSON array', () => {
    expect(parseJson('```json\n[1,2,3]\n```', () => 'FALLBACK')).toEqual([1, 2, 3]);
  });

  it('parses nested objects and arrays', () => {
    const raw = '{"items":[{"id":1,"tags":["x","y"]},{"id":2,"tags":[]}]}';
    expect(parseJson(raw, () => 'FALLBACK')).toEqual({
      items: [
        { id: 1, tags: ['x', 'y'] },
        { id: 2, tags: [] },
      ],
    });
  });

  it('keeps braces and brackets that live inside JSON strings', () => {
    const value = { text: 'close } and [ inside — {also} here', n: 2 };
    expect(parseJson(JSON.stringify(value), () => 'FALLBACK')).toEqual(value);
  });

  it('extracts balanced JSON around prose without breaking on braces inside strings', () => {
    const raw = 'Sure! Here it is: {"msg":"a } brace, a [ bracket, an escaped \\" quote","ok":true} Done.';
    expect(parseJson(raw, () => 'FALLBACK')).toEqual({
      msg: 'a } brace, a [ bracket, an escaped " quote',
      ok: true,
    });
  });

  it('returns the fallback for malformed JSON', () => {
    expect(parseJson('{"a":1,"b":}', () => 'FALLBACK')).toBe('FALLBACK');
    expect(parseJson('[1,2,3', () => 'FALLBACK')).toBe('FALLBACK');
  });

  it('returns the fallback for an empty response', () => {
    expect(parseJson('', () => 'FALLBACK')).toBe('FALLBACK');
    expect(parseJson('   ', () => 'FALLBACK')).toBe('FALLBACK');
  });
});

describe('aiJson source attribution', () => {
  it('keeps source "ai" and the provider model when the response parses', async () => {
    config.ai.apiKey = 'test-key';
    config.ai.model = 'test-model';
    stubFetch('[{"claim":"c1","status":"verified"}]');

    const result: AiResult<Array<{ claim: string }>> = await aiJson({
      system: "You are ReadyForge's Claim Verification Agent.",
      user: '{}',
      fallback: () => [],
    });

    expect(result.source).toBe('ai');
    expect(result.model).toBe('test-model');
    expect(result.data).toEqual([{ claim: 'c1', status: 'verified' }]);
  });

  it('labels unparseable model output as rule_engine — never as "ai"', async () => {
    config.ai.apiKey = 'test-key';
    stubFetch('this is not json at all');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result: AiResult<string[]> = await aiJson({
      system: "You are ReadyForge's Input Collection Agent.",
      user: '{}',
      fallback: () => ['rule-question'],
    });

    expect(result.source).toBe('rule_engine');
    expect(result.model).toBe('readyforge-rules');
    expect(result.data).toEqual(['rule-question']);
    // failure is observable: task + parse error, no user content or credentials
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('parse failed');
    expect(logged).toContain('Input Collection Agent');
    expect(logged).toContain('rule engine');
    expect(logged).not.toContain('test-key');
  });

  it('labels a failed provider call as rule_engine', async () => {
    config.ai.apiKey = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed');
      })
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await aiJson({
      system: 'task',
      user: '{}',
      fallback: () => 'rules',
    });

    expect(result.source).toBe('rule_engine');
    expect(result.data).toBe('rules');
  });

  it('skips the provider entirely when no API key is configured', async () => {
    config.ai.apiKey = '';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await aiJson({ system: 'task', user: '{}', fallback: () => 'rules' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.source).toBe('rule_engine');
  });
});