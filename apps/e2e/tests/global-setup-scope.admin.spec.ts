import { expect, test } from '@playwright/test';
import globalSetup from '../global-setup';

/**
 * Phạm vi web-admin mock mọi lệnh gọi /api/, nên globalSetup không được nối DB (apps/api/.env thường trỏ
 * DB dev dùng chung) và không phát JWT: seedE2eUser mà chạy thì sẽ cảnh báo vì DB không tới được.
 */
test.describe('globalSetup theo phạm vi', () => {
  test('E2E_SCOPE=web-admin không seed user E2E và để token trống', async () => {
    const keys = ['E2E_SCOPE', 'E2E_API_TOKEN', 'JWT_ACCESS_SECRET', 'DATABASE_URL'] as const;
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    const warn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      process.env.E2E_SCOPE = 'web-admin';
      process.env.JWT_ACCESS_SECRET = 'a-secret-that-is-long-enough-for-hs256';
      process.env.DATABASE_URL = 'postgresql://x:x@127.0.0.1:1/x';
      process.env.E2E_API_TOKEN = 'stale';
      await globalSetup();
      expect(process.env.E2E_API_TOKEN).toBe('');
      expect(warnings).toEqual([]);
    } finally {
      console.warn = warn;
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});
