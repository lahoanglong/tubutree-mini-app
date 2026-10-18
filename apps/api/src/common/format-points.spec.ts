import { formatPoints } from './format-points';

describe('formatPoints', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1.000'],
    [5500, '5.500'],
    [1234567, '1.234.567'],
    [-2000, '-2.000'],
    [NaN, '0'],
  ])('%p -> %s', (n, s) => expect(formatPoints(n)).toBe(s));
});
