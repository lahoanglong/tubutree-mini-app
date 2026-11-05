import { trimInvisible } from './text-trim';

describe('trimInvisible', () => {
  it.each([
    ['  a  ', 'a'],
    ['\u200b\u200c a \ufeff\u2060', 'a'],
    ['\u00a0\u200b', ''],
    ['a\u200bb', 'a\u200bb'],
    ['👨\u200d👩\u200d👧', '👨\u200d👩\u200d👧'],
  ])('%j → %j', (input, out) => {
    expect(trimInvisible(input)).toBe(out);
  });
});
