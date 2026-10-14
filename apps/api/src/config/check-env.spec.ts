import { checkEnv } from './check-env';

/** R2-PLATFORM-4: deploy.sh chạy bước này bằng image MỚI trước khi thay container — .env sai thì dừng, API cũ vẫn chạy. */
describe('checkEnv', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@db:5432/tubu',
    REDIS_URL: 'redis://redis:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    PANCAKE_WEBHOOK_SECRET: 'pancake-secret',
    PANCAKE_API_KEY: 'pancake-key',
    PANCAKE_SHOP_ID: '12345',
    ACCESSTRADE_WEBHOOK_SECRET: 'at-secret',
    CORS_ORIGINS: 'https://tubutree.com',
  };

  it('cấu hình hợp lệ → ok', () => {
    const r = checkEnv({ ...base });
    expect(r).toEqual({ ok: true, message: expect.stringContaining('hợp lệ') });
  });

  it('URL báo động thiếu https:// → không ok, nêu đúng khoá', () => {
    const r = checkEnv({ ...base, OPS_ALERT_WEBHOOK_URL: 'hooks.slack.com/services/T000/B000/XXX' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('OPS_ALERT_WEBHOOK_URL');
  });

  it('production thiếu khoá Pancake → không ok', () => {
    const r = checkEnv({ ...base, PANCAKE_API_KEY: '' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('PANCAKE_API_KEY');
  });
});
