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

const EMAIL = {
  OPS_ALERT_EMAIL_TO: 'ops@tubutree.com; ceo@tubutree.com',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USER: 'mailer',
  SMTP_PASS: 'secret-pass',
  SMTP_FROM: 'Tubu Tree <alerts@tubutree.com>',
};

const issuePaths = (env: Record<string, unknown>) => {
  const r = envSchema.safeParse(env);
  return r.success ? [] : r.error.issues.map((i) => i.path[0]);
};

describe('envSchema — email báo động vận hành (SMTP)', () => {
  it('không đặt biến email nào → boot, mọi biến mặc định rỗng (kênh email tắt) ở production lẫn dev', () => {
    for (const env of [PROD_BASE, { ...PROD_BASE, NODE_ENV: 'development' }]) {
      const r = envSchema.safeParse(env);
      expect(r.success).toBe(true);
      if (r.success) {
        for (const k of ['OPS_ALERT_EMAIL_TO', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'OPS_ALERT_ENV_LABEL'] as const) {
          expect(r.data[k]).toBe('');
        }
      }
    }
  });

  it('biến để rỗng (docker-compose nội suy lỗi, secret chưa đặt) vẫn coi là chưa cấu hình', () => {
    const blank = Object.fromEntries(Object.keys(EMAIL).map((k) => [k, '']));
    expect(envSchema.safeParse({ ...PROD_BASE, ...blank }).success).toBe(true);
  });

  it('đủ cấu hình → boot', () => {
    expect(envSchema.safeParse({ ...PROD_BASE, ...EMAIL }).success).toBe(true);
  });

  it.each([
    ['người nhận mà thiếu máy chủ', { ...EMAIL, SMTP_HOST: '' }, 'SMTP_HOST'],
    ['máy chủ mà thiếu người nhận', { ...EMAIL, OPS_ALERT_EMAIL_TO: '' }, 'OPS_ALERT_EMAIL_TO'],
    ['một địa chỉ nhận sai', { ...EMAIL, OPS_ALERT_EMAIL_TO: 'ops@tubutree.com, khong-hop-le' }, 'OPS_ALERT_EMAIL_TO'],
    ['tài khoản mà thiếu mật khẩu', { ...EMAIL, SMTP_PASS: '' }, 'SMTP_PASS'],
    ['cổng sai', { ...EMAIL, SMTP_PORT: '99999' }, 'SMTP_PORT'],
    ['SMTP_SECURE sai', { ...EMAIL, SMTP_SECURE: 'co' }, 'SMTP_SECURE'],
    ['địa chỉ gửi sai', { ...EMAIL, SMTP_FROM: 'abc' }, 'SMTP_FROM'],
  ])('cấu hình dở dang hoặc sai (%s) → KHÔNG boot ở mọi môi trường, nêu đúng khoá', (_n, env, key) => {
    expect(issuePaths({ ...PROD_BASE, ...env })).toEqual([key]);
    expect(issuePaths({ ...PROD_BASE, NODE_ENV: 'development', ...env })).toEqual([key]);
  });

  it('thông báo lỗi nêu khoá nhưng không in mật khẩu SMTP', () => {
    const r = envSchema.safeParse({ ...PROD_BASE, ...EMAIL, SMTP_HOST: '' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const text = r.error.toString();
      expect(text).toContain('SMTP_HOST');
      expect(text).not.toContain(EMAIL.SMTP_PASS);
    }
  });

  it('OPS_ALERT_ENV_LABEL: tên ngắn một dòng thì nhận; xuống dòng hoặc quá dài thì không boot (nằm trong tiêu đề email)', () => {
    expect(envSchema.safeParse({ ...PROD_BASE, OPS_ALERT_ENV_LABEL: 'staging' }).success).toBe(true);
    expect(envSchema.safeParse({ ...PROD_BASE, OPS_ALERT_ENV_LABEL: 'a\nBcc: x@y.z' }).success).toBe(false);
    expect(envSchema.safeParse({ ...PROD_BASE, OPS_ALERT_ENV_LABEL: 'x'.repeat(25) }).success).toBe(false);
  });
});
