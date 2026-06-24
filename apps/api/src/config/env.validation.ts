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

  // CORS allowlist (CSV các origin). Ở prod nên cấu hình rõ ràng.
  CORS_ORIGINS: z.string().default(''),

  // AI tư vấn 24/7 (§6.14.3) — DeepSeek (chính) + Gemini (dự phòng). Trống → tính năng tự tắt graceful.
  DEEPSEEK_API_KEY: z.string().default(''),
  DEEPSEEK_BASE_URL: z.string().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_BASE_URL: z.string().default('https://generativelanguage.googleapis.com'),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
}).superRefine((env, ctx) => {
  // Fail-closed ở production: bắt buộc khai báo webhook secret để không bị forge.
  if (env.NODE_ENV === 'production') {
    if (!env.PANCAKE_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PANCAKE_WEBHOOK_SECRET'],
        message: 'PANCAKE_WEBHOOK_SECRET không được rỗng ở production.',
      });
    }
    if (!env.ACCESSTRADE_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ACCESSTRADE_WEBHOOK_SECRET'],
        message: 'ACCESSTRADE_WEBHOOK_SECRET không được rỗng ở production.',
      });
    }
    // Tránh fallback CORS hard-code ở main.ts (chỉ allow tubutree.com + app.tubutree.com
    // — admin/staging subdomain sẽ bị chặn). Bắt buộc khai báo rõ origin allowlist.
    if (!env.CORS_ORIGINS || env.CORS_ORIGINS.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS không được rỗng ở production (CSV danh sách origin được phép).',
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`❌ Sai cấu hình môi trường:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
