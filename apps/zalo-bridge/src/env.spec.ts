import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const goodKey = randomBytes(32).toString('base64');
const goodSecret = 's'.repeat(32);

describe('loadEnv', () => {
  it('đọc giá trị hợp lệ và áp mặc định', () => {
    const env = loadEnv({ ZALO_BRIDGE_SECRET: goodSecret, ZALO_BRIDGE_CREDENTIALS_KEY: goodKey });
    expect(env.PORT).toBe(3110);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.ZALO_BRIDGE_DATA_DIR).toBe('/data');
    expect(env.API_EVENTS_URL).toBe('http://api:3001/api/internal/zalo-bridge/events');
    expect(env.credentialsKey.length).toBe(32);
  });

  it('secret 31 ký tự thì ném lỗi ZALO_BRIDGE_SECRET', () => {
    expect(() =>
      loadEnv({ ZALO_BRIDGE_SECRET: 's'.repeat(31), ZALO_BRIDGE_CREDENTIALS_KEY: goodKey }),
    ).toThrow(/ZALO_BRIDGE_SECRET/);
  });

  it('key 16 byte thì ném lỗi', () => {
    expect(() =>
      loadEnv({
        ZALO_BRIDGE_SECRET: goodSecret,
        ZALO_BRIDGE_CREDENTIALS_KEY: randomBytes(16).toString('base64'),
      }),
    ).toThrow(/ZALO_BRIDGE_CREDENTIALS_KEY/);
  });
});
