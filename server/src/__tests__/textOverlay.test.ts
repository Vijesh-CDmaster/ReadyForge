import { describe, expect, it } from 'vitest';
import { parseSrt, SrtParseError } from '../services/srt';
import {
  APPROVED_FONT_FAMILIES,
  isApprovedFontFamily,
  resolveApprovedFont,
  stripControlCharacters,
  wrapOverlayText,
} from '../services/textOverlay';

describe('SRT parsing', () => {
  it('parses indexes, CRLF, multiline text, tags, and millisecond timestamps', () => {
    const srt = [
      '1',
      '00:00:01,250 --> 00:00:03,500',
      'Hello <i>world</i>',
      'second line',
      '',
      '2',
      '00:00:04.000 --> 00:00:05.100',
      'Next &amp; final',
    ].join('\r\n');
    const cues = parseSrt(srt);
    expect(cues).toEqual([
      { index: 1, startSeconds: 1.25, endSeconds: 3.5, text: 'Hello world\nsecond line' },
      { index: 2, startSeconds: 4, endSeconds: 5.1, text: 'Next & final' },
    ]);
  });

  it('rejects malformed, empty, inverted, oversized, and cue-less content', () => {
    expect(() => parseSrt('')).toThrow(SrtParseError);
    expect(() => parseSrt('1\nnot a timestamp\nText')).toThrow('Invalid subtitle timing');
    expect(() => parseSrt('1\n00:00:05,000 --> 00:00:04,000\nText')).toThrow('ends before it starts');
    expect(() => parseSrt('1\n00:00:01,000 --> 00:00:02,000\n   ')).toThrow('no text');
    expect(() => parseSrt('1\n00:00:01,000 --> 00:00:02,000\nText', { maxCues: 0 })).toThrow('exceeds 0 cues');
    expect(() => parseSrt('x'.repeat(200_001))).toThrow('200,000 characters');
  });
});

describe('text overlay helpers', () => {
  it('wraps text deterministically and caps lines', () => {
    const wrapped = wrapOverlayText('one two three four five six seven eight', 120, 24);
    expect(wrapped.split('\n').every((line) => line.length <= 10)).toBe(true);
    expect(wrapOverlayText(Array.from({ length: 40 }, () => 'line').join('\n'), 500, 24).split('\n')).toHaveLength(20);
  });

  it('strips control characters but keeps line breaks and tabs', () => {
    expect(stripControlCharacters('a\u0000b\u0007c\u001fd')).toBe('abcd');
    expect(stripControlCharacters('line1\nline2\ttab\r\n')).toBe('line1\nline2\ttab\r\n');
  });

  it('only accepts registry font families, never arbitrary paths', () => {
    expect(APPROVED_FONT_FAMILIES).toEqual(['sans', 'serif', 'mono']);
    expect(isApprovedFontFamily('sans')).toBe(true);
    expect(isApprovedFontFamily('../../etc/passwd')).toBe(false);
    expect(resolveApprovedFont('C:\\Windows\\Fonts\\arial.ttf', false, false)).toBeNull();
    expect(resolveApprovedFont('../arial.ttf', true, false)).toBeNull();
  });
});
