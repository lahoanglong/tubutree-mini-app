import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverNow as coreServerNow, syncServerClock as coreSyncServerClock } from '@tubutree/app-core/server-clock';
import { serverNow, syncServerClock } from './server-clock';

const PHONE_NOW = new Date('2026-10-18T10:00:00.000Z');

describe('đồng hồ máy chủ của Mini App', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(PHONE_NOW);
    coreSyncServerClock(PHONE_NOW.toISOString());
  });
  afterEach(() => vi.useRealTimers());

  it('dùng chung một độ lệch với app-core: đo qua Mini App thì giá thẻ ở app-core cũng thấy', () => {
    const serverIso = new Date(PHONE_NOW.getTime() - 10 * 60_000).toISOString();
    syncServerClock(serverIso);
    expect(coreServerNow()).toBe(Date.parse(serverIso));
    expect(serverNow()).toBe(coreServerNow());
  });

  it('đo qua app-core (API dùng chung) thì Mini App cũng thấy', () => {
    const serverIso = new Date(PHONE_NOW.getTime() + 3 * 60_000).toISOString();
    coreSyncServerClock(serverIso);
    expect(serverNow()).toBe(Date.parse(serverIso));
  });
});
