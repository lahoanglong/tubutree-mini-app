import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as adminClient from './admin-client';

describe('Refill đã gỡ khỏi web admin (spec 13)', () => {
  it('admin-client không còn hàm Refill', () => {
    expect(Object.keys(adminClient).filter((k) => /refill/i.test(k))).toEqual([]);
  });
  it('file tab và panel Refill không còn', () => {
    for (const f of ['components/admin/refill-tab.tsx', 'components/admin/refill-locations-panel.tsx']) {
      expect(existsSync(join(process.cwd(), 'src', f))).toBe(false);
    }
  });
});
