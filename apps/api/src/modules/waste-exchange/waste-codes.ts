import { randomInt } from 'node:crypto';
import { WASTE_CODE_ALPHABET, WASTE_LOOKUP_PATTERN } from './waste.constants';

const CODE_BODY_LENGTH = { TR: 5, QG: 8 } as const;

export function generateWasteCode(kind: 'TR' | 'QG', rand: (n: number) => number = (n) => randomInt(n)): string {
  let body = '';
  for (let i = 0; i < CODE_BODY_LENGTH[kind]; i++) body += WASTE_CODE_ALPHABET[rand(WASTE_CODE_ALPHABET.length)];
  return `${kind}-${body}`;
}

export function normalizeWasteCode(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, '');
}

export function normalizeTracking(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, '');
}

// LOOKUP_MISS stores the typed text only when it looks like a Tubu code; anything else (a phone number typed into the code box) keeps shape only.
export function lookupMissMeta(raw: string): { code?: string; length: number; classes: string } {
  const text = normalizeWasteCode(raw);
  const classes = [/\p{L}/u.test(text) ? 'L' : '', /\d/.test(text) ? 'D' : '', /[^\p{L}\d]/u.test(text) ? 'S' : ''].join('');
  const meta = { length: text.length, classes };
  return WASTE_LOOKUP_PATTERN.test(text) ? { code: text, ...meta } : meta;
}
