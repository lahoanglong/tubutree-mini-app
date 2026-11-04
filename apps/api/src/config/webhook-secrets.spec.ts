import { MIN_WEBHOOK_SECRET_LENGTH, WEBHOOK_SECRET_KEYS, shortWebhookSecretKeys } from './webhook-secrets';
import { envSchema, validateEnv } from './env.validation';

const PROD = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db:5432/tubu',
  REDIS_URL: 'redis://redis:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  PANCAKE_API_KEY: 'pancake-key',
  PANCAKE_SHOP_ID: '12345',
  PANCAKE_WEBHOOK_SECRET: 'p'.repeat(64),
  ACCESSTRADE_WEBHOOK_SECRET: 'q'.repeat(48),
  CORS_ORIGINS: 'https://tubutree.com',
};
const long = 'x'.repeat(MIN_WEBHOOK_SECRET_LENGTH);

describe('secret webhook ngắn', () => {
  it('khoá theo dõi gồm năm secret webhook', () => {
    expect([...WEBHOOK_SECRET_KEYS].sort()).toEqual(
      ['ACCESSTRADE_WEBHOOK_SECRET', 'GOMDON_WEBHOOK_SECRET', 'PANCAKE_WEBHOOK_SECRET', 'ZALO_BRIDGE_SECRET', 'ZALO_OA_WEBHOOK_SECRET'],
    );
  });

  it('chỉ liệt kê secret đã đặt mà ngắn hơn 32 ký tự; rỗng và đủ dài thì bỏ qua', () => {
    expect(shortWebhookSecretKeys({ PANCAKE_WEBHOOK_SECRET: 'abc', GOMDON_WEBHOOK_SECRET: 'x'.repeat(31), ZALO_BRIDGE_SECRET: long, ACCESSTRADE_WEBHOOK_SECRET: '' }))
      .toEqual(['PANCAKE_WEBHOOK_SECRET', 'GOMDON_WEBHOOK_SECRET']);
  });

  describe('validateEnv ở production', () => {
    it.each(WEBHOOK_SECRET_KEYS)('%s = "abc" → ném lỗi nêu tên biến, không in giá trị', (key) => {
      expect(() => validateEnv({ ...PROD, [key]: 'abc-gia-tri' })).toThrow(new RegExp(key));
      try {
        validateEnv({ ...PROD, [key]: 'abc-gia-tri' });
      } catch (e) {
        expect(String(e)).not.toContain('abc-gia-tri');
      }
    });
    it.each(WEBHOOK_SECRET_KEYS)('%s đủ 32 ký tự → qua', (key) => {
      expect(() => validateEnv({ ...PROD, [key]: long })).not.toThrow();
    });
    it('31 ký tự → ném', () => {
      expect(() => validateEnv({ ...PROD, GOMDON_WEBHOOK_SECRET: 'x'.repeat(31) })).toThrow(/GOMDON_WEBHOOK_SECRET/);
    });
    it('rỗng giữ nguyên hành vi cũ (tính năng tắt vẫn boot)', () => {
      expect(() => validateEnv({ ...PROD, GOMDON_WEBHOOK_SECRET: '', ZALO_OA_WEBHOOK_SECRET: '', ZALO_BRIDGE_SECRET: '' })).not.toThrow();
    });
    it('PANCAKE rỗng ở production vẫn bị chặn như trước', () => {
      expect(envSchema.safeParse({ ...PROD, PANCAKE_WEBHOOK_SECRET: '' }).success).toBe(false);
    });
  });

  it('ngoài production secret ngắn vẫn qua', () => {
    expect(() => validateEnv({ ...PROD, NODE_ENV: 'development', PANCAKE_WEBHOOK_SECRET: 'abc' })).not.toThrow();
  });
});
