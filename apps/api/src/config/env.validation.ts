import { z } from 'zod';

/** Validate biến môi trường khi app khởi động (fail-fast). */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().default(30),

  // Zalo Mini App / OA
  ZALO_APP_ID: z.string().default(''),
  ZALO_APP_SECRET: z.string().default(''),
  ZALO_OA_ACCESS_TOKEN: z.string().default(''),
  ZALO_OA_ID: z.string().default(''),

  // Pancake POS
  PANCAKE_BASE_URL: z.string().default('https://pos.pages.fm/api/v1'),
  PANCAKE_API_KEY: z.string().default(''),
  PANCAKE_SHOP_ID: z.string().default(''),
  PANCAKE_WEBHOOK_SECRET: z.string().default(''),

  // ZaloPay merchant
  ZALOPAY_APP_ID: z.string().default(''),
  ZALOPAY_KEY1: z.string().default(''),
  ZALOPAY_KEY2: z.string().default(''),
  ZALOPAY_ENDPOINT: z.string().default('https://sb-openapi.zalopay.vn/v2'),

  // ZNS
  ZNS_BASE_URL: z.string().default('https://business.openapi.zalo.me'),

  // Accesstrade (Phase 3)
  ACCESSTRADE_BASE_URL: z.string().default('https://api.accesstrade.vn/v1'),
  ACCESSTRADE_TOKEN: z.string().default(''),
  ACCESSTRADE_PUBLISHER_ID: z.string().default(''),
  // Token bí mật chia sẻ để verify webhook postback (chống tự duyệt cashback giả).
  ACCESSTRADE_WEBHOOK_SECRET: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`❌ Sai cấu hình môi trường:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
