import { describe, expect, it } from 'vitest';
import { CASHBACK_ENABLED, SEASON_PASS_ENABLED, SUBSCRIPTIONS_IN_MINIAPP } from './features';

describe('features', () => {
  it('giữ cờ ẩn lối vào theo quyết định Q-15, Q-16', () => {
    expect(SEASON_PASS_ENABLED).toBe(false);
    expect(CASHBACK_ENABLED).toBe(false);
    expect(SUBSCRIPTIONS_IN_MINIAPP).toBe(false);
  });
});
