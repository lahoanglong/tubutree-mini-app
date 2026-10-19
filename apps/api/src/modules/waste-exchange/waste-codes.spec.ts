import { WASTE_CODE_ALPHABET, WASTE_LOOKUP_PATTERN } from './waste.constants';
import { generateWasteCode, lookupMissMeta, normalizeTracking, normalizeWasteCode } from './waste-codes';

describe('generateWasteCode', () => {
  it('maps rand(n) indexes onto the alphabet', () => {
    expect(generateWasteCode('TR', () => 0)).toBe('TR-22222');
    expect(generateWasteCode('QG', (n) => n - 1)).toBe('QG-ZZZZZZZZ');
    let i = 0;
    expect(generateWasteCode('QG', () => i++ % 30)).toBe('QG-23456789');
    i = 0;
    expect(generateWasteCode('TR', () => i++ % 30)).toBe('TR-23456');
  });
  it('asks rand for an index below 30 each time', () => {
    const seen: number[] = [];
    generateWasteCode('QG', (n) => { seen.push(n); return 0; });
    expect(seen).toEqual(Array(8).fill(30));
  });
  it('default generator output always matches the lookup pattern and is never a member code', () => {
    for (let k = 0; k < 500; k++) {
      for (const kind of ['TR', 'QG'] as const) {
        const code = generateWasteCode(kind);
        expect(WASTE_LOOKUP_PATTERN.test(code)).toBe(true);
        expect(code.startsWith('TUBU')).toBe(false);
        expect(/^\d{8,}$/.test(code)).toBe(false);
        for (const ch of code.slice(3)) expect(WASTE_CODE_ALPHABET).toContain(ch);
      }
    }
  });
});

describe('normalisation', () => {
  it('normalizeWasteCode uppercases and removes every whitespace character', () => {
    expect(normalizeWasteCode(' tr-ab c2 ')).toBe('TR-ABC2');
    expect(normalizeWasteCode('tr-\tab\nc2 de')).toBe('TR-ABC2DE');
  });
  it('normalizeTracking applies the same rule', () => {
    expect(normalizeTracking(' ghn 123 456 ')).toBe('GHN123456');
    expect(normalizeTracking('')).toBe('');
  });
});

describe('lookupMissMeta (spec 11.1 LOOKUP_MISS rule)', () => {
  it('returns the code when the normalised text matches the code pattern', () => {
    expect(lookupMissMeta('tr-ab cd2')).toEqual({ code: 'TR-ABCD2', length: 8, classes: 'LDS' });
    expect(lookupMissMeta('qg-23456789')).toEqual({ code: 'QG-23456789', length: 11, classes: 'LDS' });
  });
  it('returns only length and character classes otherwise (a phone number typed into the code box)', () => {
    expect(lookupMissMeta('0901234567')).toEqual({ length: 10, classes: 'D' });
    expect(lookupMissMeta(' 090 123 ')).toEqual({ length: 6, classes: 'D' });
    expect(lookupMissMeta('abc')).toEqual({ length: 3, classes: 'L' });
    expect(lookupMissMeta('TR-IO0O1')).toEqual({ length: 8, classes: 'LDS' });
    expect(lookupMissMeta('a.b')).toEqual({ length: 3, classes: 'LS' });
    expect(lookupMissMeta('đ12')).toEqual({ length: 3, classes: 'LD' });
    expect(Object.keys(lookupMissMeta('0901234567'))).toEqual(['length', 'classes']);
  });
});
