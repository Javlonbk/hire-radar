import { describe, it, expect } from 'vitest';
import { normalize, contentHash } from './hash.js';

describe('normalize', () => {
  it('trims and collapses whitespace, lowercases', () => {
    expect(normalize('  Hello   World  ')).toBe('hello world');
  });

  it('applies NFC — decomposed accented char equals composed form', () => {
    // 'é' as NFC (U+00E9) vs decomposed NFD (e + U+0301)
    const nfc = 'é';
    const nfd = 'é';
    expect(normalize(nfd)).toBe(normalize(nfc));
  });

  it('folds Cyrillic homoglyphs to Latin equivalents', () => {
    // Cyrillic: а е о р с у х (look like Latin a e o p c y x)
    const cyrillic = 'аеорсух'; // аеорсух
    const latin = 'aeopcy x'.replace(' ', ''); // aeopcy x → aeopcyx
    expect(normalize(cyrillic)).toBe('aeopcy x'.replace(' ', ''));
  });
});

describe('contentHash', () => {
  it('returns a 64-char lowercase hex string', () => {
    const hash = contentHash('test');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is case-insensitive: Developer === DEVELOPER', () => {
    expect(contentHash('Developer')).toBe(contentHash('DEVELOPER'));
  });

  it('is whitespace-insensitive: collapses spaces and trims', () => {
    expect(contentHash('Developer')).toBe(contentHash('  developer '));
  });

  it('two genuinely different strings produce different hashes', () => {
    expect(contentHash('developer')).not.toBe(contentHash('designer'));
  });

  it('Cyrillic vs Latin homoglyph test: "cope" (Latin) === "соре" (Cyrillic)', () => {
    // Latin: c-o-p-e
    const latin = 'cope';
    // Cyrillic: с(U+0441)-о(U+043E)-р(U+0440)-е(U+0435) — all confusable homoglyphs
    const cyrillic = 'соре';
    expect(contentHash(latin)).toBe(contentHash(cyrillic));
  });

  it('uppercase-only Cyrillic confusables: "КОТ" (Cyrillic) === "KOT" (Latin)', () => {
    // Cyrillic: К(U+041A)-О(U+041E)-Т(U+0422) vs Latin K-O-T
    expect(contentHash('КОТ')).toBe(contentHash('KOT'));
  });

  it('Cyrillic homoglyphs produce same hash as their Latin counterparts', () => {
    // р→p, о→o, с→c: Cyrillic 'рос' folds to Latin 'poc'
    const cyrillicRos = 'рос'; // р(→p)-о(→o)-с(→c)
    const latinPoc = 'poc';
    expect(contentHash(cyrillicRos)).toBe(contentHash(latinPoc));
  });
});
