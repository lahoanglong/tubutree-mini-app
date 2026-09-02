import { z } from 'zod';

/** Validate biến môi trường khi app khởi động (fail-fast). */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // .int().positive(): PORT='' (set nhưng rỗng, vd interpolation lỗi trong docker-compose) khiến
  // z.coerce.number() ra 0 (Number('')===0, không phải NaN) — default() chỉ áp dụng khi input là
  // undefined nên KHÔNG cứu được trường hợp này; thêm .positive() để 0 bị chặn ở validate thay vì
  // app lặng lẽ listen ở port 0 (OS cấp ngẫu nhiên) rồi vỡ reverse-proxy/health-check.
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),
  // .url(): REDIS_URL='' (set nhưng rỗng, vd interpolation lỗi trong docker-compose/.env) trước
  // đây qua được z.string() thô → default() KHÔNG áp dụng (chỉ áp cho undefined) → BullMQ/ioredis
  // nhận connection string rỗng, hàng đợi webhook/notification/OA events ngừng xử lý ÂM THẦM (queue
  // module vẫn boot "thành công" nhưng job không bao giờ chạy). .url() chặn ngay ở validate (fail-fast
  // mọi env, không riêng production) — mirror DATABASE_URL.
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  // Format `ms` (zeit/ms) mà jsonwebtoken.sign() dùng cho expiresIn — validate ở đây để sai định
  // dạng (vd 'abc', '15 minutes') fail ở boot thay vì throw ở request login/refresh đầu tiên.
  JWT_ACCESS_TTL: z
    .string()
    .regex(/^\d+(ms|s|m|h|d|w|y)$/, "JWT_ACCESS_TTL phải dạng số+đơn vị (vd: 15m, 1h, 30d).")
    .default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Zalo Mini App / OA
  ZALO_APP_ID: z.string().default(''),
  ZALO_APP_SECRET: z.string().default(''),
  ZALO_OA_ACCESS_TOKEN: z.string().default(''),
  ZALO_OA_REFRESH_TOKEN: z.string().default(''), // bootstrap; sau đó token mới lưu DB (xoay vòng)
  ZALO_OA_ID: z.string().default(''),
  ZALO_OAUTH_BASE: z.string().default('https://oauth.zaloapp.com'),
  // CSKH quick-reply/auto-reply: token tĩnh verify webhook OA (Zalo không ký HMAC, giống Pancake).
  // Không bắt buộc ở production qua superRefine (tính năng optional, chưa đăng ký webhook thì
  // không set). LƯU Ý: khác PANCAKE_WEBHOOK_SECRET — nếu rỗng, ZaloOaWebhookController vẫn từ
  // chối MỌI request bằng 401 khi NODE_ENV=production (không silently no-op) — xem
  // zalo-oa-webhook.controller.ts. Chỉ để trống khi CHƯA đăng ký webhook này trên Zalo OA dashboard.
  ZALO_OA_WEBHOOK_SECRET: z.string().default(''),

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
  // CẢ HAI đều gọi qua endpoint OpenAI-compatible (/chat/completions, Bearer). Gemini ở đây là
  // proxy OpenAI-compatible (base có /v1), KHÔNG phải native Google generateContent.
  DEEPSEEK_API_KEY: z.string().default(''),
  DEEPSEEK_BASE_URL: z.string().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_BASE_URL: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
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
    // Parse CSV giống hệt main.ts (split → trim → filter rỗng): check .trim().length===0 thôi
    // không đủ — CORS_ORIGINS="," (rác CSV, dấu phẩy lẻ) qua được check này nhưng vẫn parse ra
    // mảng rỗng ở main.ts, âm thầm rơi về fallback trong khi validate tưởng đã "cấu hình rõ".
    const corsOriginList = env.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
    if (corsOriginList.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS không được rỗng ở production (CSV danh sách origin được phép).',
      });
    }
    // REDIS_URL đã có .url() nên chuỗi rỗng bị chặn ở MỌI env (không tới được đây); check này là
    // phòng thủ thêm cho production (đề phòng .url() bị nới lỏng sau này) + nhất quán với các field
    // bắt buộc khác — bắt buộc khai báo rõ, không im lặng rơi về default localhost trên VM prod.
    if (!env.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'REDIS_URL không được rỗng ở production.',
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
