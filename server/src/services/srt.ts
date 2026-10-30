import { stripControlCharacters } from './textOverlay';

export interface SrtCue {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export class SrtParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SrtParseError';
  }
}

const TIMESTAMP = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})(?:\s+.*)?$/;

function toSeconds(hours: string, minutes: string, seconds: string, millis: string): number {
  const h = Number(hours);
  const m = Number(minutes);
  const s = Number(seconds);
  const ms = Number(millis);
  if (m > 59 || s > 59) throw new SrtParseError('SRT timestamp has an out-of-range minute or second.');
  return Math.round((h * 3600 + m * 60 + s + ms / 1000) * 1000) / 1000;
}

function cleanCueText(text: string): string {
  const cleaned = text
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  return stripControlCharacters(cleaned).trim();
}

/**
 * Parses SRT text defensively. Uploaded subtitle content is untrusted and is
 * never interpreted as a path or a filter expression.
 */
export function parseSrt(input: string, options: { maxCues?: number } = {}): SrtCue[] {
  if (typeof input !== 'string') throw new SrtParseError('Subtitle content must be text.');
  if (input.length > 200_000) throw new SrtParseError('Subtitle file is larger than 200,000 characters.');
  const maxCues = options.maxCues ?? 1000;
  const normalized = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) throw new SrtParseError('Subtitle file is empty.');

  const blocks = normalized.split(/\n{2,}/);
  const cues: SrtCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trimEnd());
    if (lines.length === 0 || lines.every((line) => !line.trim())) continue;
    let cursor = 0;
    if (/^\d+$/.test(lines[0].trim())) cursor = 1;
    const timing = lines[cursor]?.trim();
    if (!timing) throw new SrtParseError('A subtitle cue is missing its timing line.');
    const match = TIMESTAMP.exec(timing);
    if (!match) throw new SrtParseError(`Invalid subtitle timing: "${timing.slice(0, 80)}".`);
    const start = toSeconds(match[1], match[2], match[3], match[4]);
    const end = toSeconds(match[5], match[6], match[7], match[8]);
    if (end <= start) throw new SrtParseError('A subtitle cue ends before it starts.');
    const text = cleanCueText(lines.slice(cursor + 1).join('\n'));
    if (!text) throw new SrtParseError('A subtitle cue has no text.');
    if (text.length > 1000) throw new SrtParseError('A subtitle cue exceeds 1,000 characters.');
    cues.push({ index: cues.length + 1, startSeconds: start, endSeconds: end, text });
    if (cues.length > maxCues) throw new SrtParseError(`Subtitle file exceeds ${maxCues} cues.`);
  }
  if (cues.length === 0) throw new SrtParseError('Subtitle file contains no cues.');
  return cues;
}
