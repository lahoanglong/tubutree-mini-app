import { envSchema } from './env.validation';

const PROD_BASE = {
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

describe('envSchema — Gomdon', () => {
  it('Gomdon không cấu hình (tính năng tắt) → production vẫn boot, mặc định rỗng', () => {
    const r = envSchema.safeParse(PROD_BASE);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.GOMDON_BASE_URL).toBe('');
      expect(r.data.GOMDON_WEBHOOK_SECRET).toBe('');
    }
  });

  it('production đã đặt tài khoản Gomdon mà thiếu GOMDON_WEBHOOK_SECRET → không boot (fail-closed)', () => {
    const r = envSchema.safeParse({ ...PROD_BASE, GOMDON_PHONE: '0900', GOMDON_PASSWORD: 'pw' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path.includes('GOMDON_WEBHOOK_SECRET'))).toBe(true);
  });

  it('production đủ tài khoản + secret → boot', () => {
    const r = envSchema.safeParse({ ...PROD_BASE, GOMDON_PHONE: '0900', GOMDON_PASSWORD: 'pw', GOMDON_WEBHOOK_SECRET: 's'.repeat(24) });
    expect(r.success).toBe(true);
  });

  it('dev có tài khoản mà thiếu secret → vẫn boot (controller cảnh báo, nhận request để thử)', () => {
    const r = envSchema.safeParse({
      NODE_ENV: 'development',
      DATABASE_URL: PROD_BASE.DATABASE_URL,
      JWT_ACCESS_SECRET: PROD_BASE.JWT_ACCESS_SECRET,
      JWT_REFRESH_SECRET: PROD_BASE.JWT_REFRESH_SECRET,
      GOMDON_PHONE: '0900',
      GOMDON_PASSWORD: 'pw',
    });
    expect(r.success).toBe(true);
  });
});

describe('envSchema — THROTTLE_BYPASS_TOKEN', () => {
  it('không đặt → rỗng (tắt đường miễn throttle)', () => {
    const r = envSchema.safeParse(PROD_BASE);
    expect(r.success && r.data.THROTTLE_BYPASS_TOKEN).toBe('');
  });

  it('token ngắn dễ đoán → không boot', () => {
    expect(envSchema.safeParse({ ...PROD_BASE, THROTTLE_BYPASS_TOKEN: 'short' }).success).toBe(false);
  });

  it('token đủ 32 ký tự → boot', () => {
    const r = envSchema.safeParse({ ...PROD_BASE, THROTTLE_BYPASS_TOKEN: 't'.repeat(32) });
    expect(r.success && r.data.THROTTLE_BYPASS_TOKEN).toBe('t'.repeat(32));
  });
});

describe('envSchema — Pancake (PLATFORM-1)', () => {
  it.each(['PANCAKE_API_KEY', 'PANCAKE_SHOP_ID'])('production thiếu %s → không boot (đơn không bao giờ tới kho)', (key) => {
    const r = envSchema.safeParse({ ...PROD_BASE, [key]: '' });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues.map((i) => i.path[0])).toContain(key);
  });

  it('development không có khoá Pancake → vẫn boot (dev dùng seed)', () => {
    const r = envSchema.safeParse({ ...PROD_BASE, NODE_ENV: 'development', PANCAKE_API_KEY: '', PANCAKE_SHOP_ID: '' });
    expect(r.success).toBe(true);
  });
});

describe('envSchema — SENTRY_DSN', () => {
  it('không đặt hoặc rỗng → tắt, production vẫn boot', () => {
    for (const extra of [{}, { SENTRY_DSN: '' }]) {
      const r = envSchema.safeParse({ ...PROD_BASE, ...extra });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.SENTRY_DSN).toBe('');
    }
  });

  it('DSN dạng URL qua; chuỗi không phải URL bị chặn lúc boot', () => {
    expect(envSchema.safeParse({ ...PROD_BASE, SENTRY_DSN: 'https://k@o.example.com/1' }).success).toBe(true);
    expect(envSchema.safeParse({ ...PROD_BASE, SENTRY_DSN: 'not-a-dsn' }).success).toBe(false);
  });
});

describe('envSchema — production: JWT secret đủ dài', () => {
  const issuesFor = (over: Record<string, unknown>) => {
    const r = envSchema.safeParse({ ...PROD_BASE, ...over });
    return r.success ? null : r.error.issues;
  };

  it.each(['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'])('%s ngắn hơn 32 ký tự → không boot, hướng dẫn sinh khoá và nói đổi sẽ đăng xuất mọi người', (key) => {
    const issues = issuesFor({ [key]: 'x'.repeat(31) });
    const hit = issues?.find((i) => i.path.includes(key));
    expect(hit?.message).toContain('openssl rand -base64 48');
    expect(hit?.message).toContain('đăng xuất');
  });

  it('đủ 32 ký tự → boot', () => {
    expect(issuesFor({})).toBeNull();
  });

  it('dev vẫn cho secret 16 ký tự', () => {
    const r = envSchema.safeParse({ ...PROD_BASE, NODE_ENV: 'development', JWT_ACCESS_SECRET: 'y'.repeat(16), JWT_REFRESH_SECRET: 'z'.repeat(16) });
    expect(r.success).toBe(true);
  });
});

describe('envSchema — production: ZaloPay sandbox', () => {
  const SANDBOX = 'https://sb-openapi.zalopay.vn/v2';
  const issuesFor = (over: Record<string, unknown>) => {
    const r = envSchema.safeParse({ ...PROD_BASE, ...over });
    return r.success ? null : r.error.issues;
  };

  it('đã đặt ZALOPAY_APP_ID mà endpoint là sandbox (kể cả bỏ trống = mặc định sandbox) → không boot', () => {
    for (const over of [{ ZALOPAY_APP_ID: '2553', ZALOPAY_ENDPOINT: SANDBOX }, { ZALOPAY_APP_ID: '2553' }]) {
      const hit = issuesFor(over)?.find((i) => i.path.includes('ZALOPAY_ENDPOINT'));
      expect(hit?.message).toContain('ZALOPAY_ALLOW_SANDBOX=1');
    }
  });

  it('ZALOPAY_ALLOW_SANDBOX=1 → cho phép sandbox', () => {
    expect(issuesFor({ ZALOPAY_APP_ID: '2553', ZALOPAY_ALLOW_SANDBOX: '1' })).toBeNull();
  });

  it('endpoint thật → boot', () => {
    expect(issuesFor({ ZALOPAY_APP_ID: '2553', ZALOPAY_ENDPOINT: 'https://openapi.zalopay.vn/v2' })).toBeNull();
  });

  it('chưa cấu hình ZaloPay (APP_ID rỗng) → không đòi gì', () => {
    expect(issuesFor({})).toBeNull();
  });

  it('ngoài production không chặn sandbox', () => {
    const r = envSchema.safeParse({ ...PROD_BASE, NODE_ENV: 'development', ZALOPAY_APP_ID: '2553' });
    expect(r.success).toBe(true);
  });
});
