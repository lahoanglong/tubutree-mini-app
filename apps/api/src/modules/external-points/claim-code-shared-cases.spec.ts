import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeTrackingCode } from './external-order.mapper';

const cases = JSON.parse(readFileSync(join(__dirname, '../../../../../packages/app-core/src/claim-code-cases.json'), 'utf8')) as {
  normalize: [string, string | null][];
};

describe('normalizeTrackingCode khớp bộ ca chung với app-core (claim-code-cases.json)', () => {
  it('có ca để chạy', () => expect(cases.normalize.length).toBeGreaterThan(5));
  it.each(cases.normalize)('%j -> %j', (input, expected) => {
    expect(normalizeTrackingCode(input)).toBe(expected);
  });
});
