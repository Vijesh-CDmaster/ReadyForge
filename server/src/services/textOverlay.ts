import fs from 'node:fs';
import path from 'node:path';

/**
 * Only families in this registry can reach FFmpeg. Users select a family name;
 * they never supply a font path.
 */
export const APPROVED_FONT_FAMILIES = ['sans', 'serif', 'mono'] as const;
export type ApprovedFontFamily = (typeof APPROVED_FONT_FAMILIES)[number];

type FontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic';

const WINDOWS_FONTS = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
const LOCAL_FONTS = [
  path.resolve(__dirname, '..', '..', '..', 'tools', 'fonts'),
  path.resolve(__dirname, '..', '..', 'tools', 'fonts'),
];

const FONT_CANDIDATES: Record<ApprovedFontFamily, Record<FontStyle, string[]>> = {
  sans: {
    normal: ['arial.ttf', 'Arial.ttf', 'DejaVuSans.ttf', 'Helvetica.ttc'],
    bold: ['arialbd.ttf', 'Arial Bold.ttf', 'DejaVuSans-Bold.ttf'],
    italic: ['ariali.ttf', 'Arial Italic.ttf', 'DejaVuSans-Oblique.ttf'],
    bolditalic: ['arialbi.ttf', 'Arial Bold Italic.ttf', 'DejaVuSans-BoldOblique.ttf'],
  },
  serif: {
    normal: ['times.ttf', 'Times New Roman.ttf', 'DejaVuSerif.ttf', 'Georgia.ttf'],
    bold: ['timesbd.ttf', 'Times New Roman Bold.ttf', 'DejaVuSerif-Bold.ttf', 'Georgia Bold.ttf'],
    italic: ['timesi.ttf', 'Times New Roman Italic.ttf', 'DejaVuSerif-Italic.ttf', 'Georgia Italic.ttf'],
    bolditalic: ['timesbi.ttf', 'Times New Roman Bold Italic.ttf', 'DejaVuSerif-BoldItalic.ttf'],
  },
  mono: {
    normal: ['consola.ttf', 'DejaVuSansMono.ttf', 'Courier New.ttf', 'cour.ttf'],
    bold: ['consolab.ttf', 'DejaVuSansMono-Bold.ttf', 'Courier New Bold.ttf', 'courbd.ttf'],
    italic: ['consolai.ttf', 'DejaVuSansMono-Oblique.ttf', 'Courier New Italic.ttf', 'couri.ttf'],
    bolditalic: ['consolaz.ttf', 'DejaVuSansMono-BoldOblique.ttf', 'Courier New Bold Italic.ttf', 'courbi.ttf'],
  },
};

const SYSTEM_FONT_DIRS = [
  WINDOWS_FONTS,
  '/usr/share/fonts/truetype/dejavu',
  '/usr/share/fonts/truetype/liberation',
  '/usr/share/fonts/TTF',
  '/System/Library/Fonts/Supplemental',
  '/System/Library/Fonts',
];

/**
 * Removes control characters that would corrupt filter files or terminal output.
 * Tab, newline, and carriage return are kept so multi-line text still works.
 */
export function stripControlCharacters(value: string): string {
  let output = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13) {
      output += char;
      continue;
    }
    if (code < 32 || code === 127) continue;
    output += char;
  }
  return output;
}

export function isApprovedFontFamily(value: string): value is ApprovedFontFamily {
  return (APPROVED_FONT_FAMILIES as readonly string[]).includes(value);
}

const cache = new Map<string, string | null>();

export function resolveApprovedFont(family: string, bold: boolean, italic: boolean): string | null {
  if (!isApprovedFontFamily(family)) return null;
  const style: FontStyle = bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal';
  const cacheKey = `${family}:${style}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;
  const roots = [...LOCAL_FONTS, ...SYSTEM_FONT_DIRS];
  for (const name of FONT_CANDIDATES[family][style]) {
    for (const root of roots) {
      const candidate = path.join(root, name);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        cache.set(cacheKey, candidate);
        return candidate;
      }
    }
  }
  // Fall back to the regular face rather than silently dropping the text.
  if (style !== 'normal') {
    const regular = resolveApprovedFont(family, false, false);
    cache.set(cacheKey, regular);
    return regular;
  }
  cache.set(cacheKey, null);
  return null;
}

export function resetFontRegistryCache(): void {
  cache.clear();
}

/** Approximate glyph width used for deterministic preview/render wrapping. */
const GLYPH_WIDTH_RATIO = 0.56;

export function wrapOverlayText(content: string, widthPixels: number, fontSize: number): string {
  const maxChars = Math.max(1, Math.floor(widthPixels / (fontSize * GLYPH_WIDTH_RATIO)));
  const paragraphs = content.replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= maxChars) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (word.length > maxChars) {
        let rest = word;
        while (rest.length > maxChars) {
          lines.push(rest.slice(0, maxChars));
          rest = rest.slice(maxChars);
        }
        line = rest;
      } else {
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.slice(0, 20).join('\n');
}
