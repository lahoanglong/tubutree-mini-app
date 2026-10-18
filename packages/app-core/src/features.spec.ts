import { describe, expect, it } from 'vitest';
import { CASHBACK_ENABLED, SEASON_PASS_ENABLED } from './features';

describe('features', () => {
  it('giữ cờ ẩn lối vào theo quyết định Q-15, Q-16', () => {
    expect(SEASON_PASS_ENABLED).toBe(false);
    expect(CASHBACK_ENABLED).toBe(false);
  });
});
