import { createHash } from 'node:crypto';

// NFC alone does not merge cross-script homoglyphs: Cyrillic 'о' (U+043E) and Latin 'o' (U+006F)
// are distinct code points. Map the common visually-identical Cyrillic letters to their Latin counterparts.
const CYRILLIC_TO_LATIN: Record<string, string> = {
  'а': 'a', 'А': 'A',
  'е': 'e', 'Е': 'E',
  'о': 'o', 'О': 'O',
  'р': 'p', 'Р': 'P',
  'с': 'c', 'С': 'C',
  'у': 'y', 'У': 'Y',
  'х': 'x', 'Х': 'X',
  // uppercase-only confusables — lowercase к м т н в do not resemble their Latin counterparts
  'К': 'K', 'М': 'M', 'Т': 'T', 'Н': 'H', 'В': 'B',
};

export function normalize(text: string): string {
  const nfc = text.normalize('NFC');
  const folded = [...nfc].map(ch => CYRILLIC_TO_LATIN[ch] ?? ch).join('');
  const collapsed = folded.trim().replace(/\s+/g, ' ');
  return collapsed.toLowerCase();
}

export function contentHash(text: string): string {
  return createHash('sha256').update(normalize(text), 'utf8').digest('hex');
}
