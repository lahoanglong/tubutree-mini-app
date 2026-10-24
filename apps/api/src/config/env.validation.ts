import { z } from 'zod';
import { resolveOpsEmailConfig } from './ops-email-config';

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
  // Giây một refresh token vừa xoay còn được dùng lại (nhiều tab refresh cùng lúc, gửi lại khi mất phản
  // hồi) trước khi bị coi là token bị đánh cắp. 0 = tắt ân hạn.
  JWT_REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(300).default(30),

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
  // Cầu nối Zalo cá nhân (apps/zalo-bridge) cho chat CSKH. URL trống = chưa nối, mọi lệnh trả BRIDGE_NOT_CONFIGURED.
  ZALO_BRIDGE_URL: z.union([z.literal(''), z.string().url()]).default(''),
  ZALO_BRIDGE_SECRET: z.string().default(''),

  // Theo dõi lỗi (Sentry cloud hoặc GlitchTip tự host, cùng DSN). Rỗng = tắt hẳn, SDK không được khởi tạo.
  SENTRY_DSN: z.union([z.literal(''), z.string().url()]).default(''),
  SENTRY_ENVIRONMENT: z.string().default(''), // rỗng = NODE_ENV
  SENTRY_RELEASE: z.string().default(''), // image chưa mang git sha, đặt tay nếu muốn gắn bản phát hành
  // Pancake POS
  PANCAKE_BASE_URL: z.string().default('https://pos.pages.fm/api/v1'),
  PANCAKE_API_KEY: z.string().default(''),
  PANCAKE_SHOP_ID: z.string().default(''),
  PANCAKE_WEBHOOK_SECRET: z.string().default(''),
  // PLATFORM-5: ngoài thông báo in-app cho admin, POST JSON báo động sức khoẻ vận hành (Slack/Google Chat/n8n...)
  // tới URL này. Rỗng = chỉ báo in-app.
  OPS_ALERT_WEBHOOK_URL: z.union([z.literal(''), z.string().url()]).default(''),
  // Kênh thứ hai: email qua SMTP, gửi đúng các lần webhook ở trên gửi. Bỏ trống cả bảy biến = tắt. Đã đặt một biến
  // thì phải đủ và đúng (xem config/ops-email-config.ts) — dở dang thì không boot, giống OPS_ALERT_WEBHOOK_URL sai dạng,
  // để deploy dừng ngay thay vì tưởng đã có kênh email mà không gửi được.
  OPS_ALERT_EMAIL_TO: z.string().default(''), // nhiều địa chỉ cách nhau bằng dấu phẩy hoặc chấm phẩy
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.string().default(''), // rỗng = 587 (hoặc 465 khi SMTP_SECURE=true)
  SMTP_SECURE: z.string().default(''), // true/yes/1/on = TLS ngay từ đầu (cổng 465); false/no/0/off = STARTTLS
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default(''), // alerts@tubutree.com hoặc Tubu Tree <alerts@tubutree.com>
  // Nhãn môi trường ở đầu tiêu đề email ("[Tubu Tree · staging]"); rỗng = dùng NODE_ENV. Staging chạy NODE_ENV=production
  // thì đặt nhãn này để email staging và prod không lẫn nhau.
  OPS_ALERT_ENV_LABEL: z
    .string()
    .max(24, 'OPS_ALERT_ENV_LABEL tối đa 24 ký tự.')
    .regex(/^[^\r\n[\]]*$/, 'OPS_ALERT_ENV_LABEL phải nằm trên một dòng, không chứa [ hoặc ].')
    .default(''),

  // Gomdon (vận đơn đổi hàng BestExpress — thu gom vật liệu tái chế). Tính năng optional:
  // - GOMDON_BASE_URL trống → ở production dùng https://admin.gomdon.com.vn, ở dev/test coi như CHƯA
  //   cấu hình (không bao giờ tự đặt bưu tá thật từ máy dev) — xem gomdon-config.ts.
  // - GOMDON_PHONE/GOMDON_PASSWORD: tài khoản Gomdon (ưu tiên hơn phone/password cũ trong SystemConfig).
  // - GOMDON_WEBHOOK_SECRET: token chia sẻ verify webhook (header x-webhook-token hoặc /webhooks/gomdon/<secret>).
  //   Rỗng ở production thì GomdonWebhookController từ chối MỌI request 401 (fail-closed); production
  //   đã đặt GOMDON_PHONE/GOMDON_PASSWORD mà thiếu secret → không boot (superRefine bên dưới).
  GOMDON_BASE_URL: z.string().default(''),
  GOMDON_PHONE: z.string().default(''),
  GOMDON_PASSWORD: z.string().default(''),
  GOMDON_WEBHOOK_SECRET: z.string().default(''),

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
  // Cookie refresh token của web shop (xem modules/auth/refresh-cookie.ts).
  // Đặt 'none' khi web và API KHÁC site (vd tubutree.com vs api-tubu.vn) — lúc đó trình duyệt
  // chỉ gửi cookie nếu SameSite=None, và None bắt buộc đi kèm Secure (code tự bật).
  AUTH_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  // Để trống nếu web và API cùng host. Đặt '.tubutree.com' để cookie dùng chung mọi subdomain.
  AUTH_COOKIE_DOMAIN: z.string().optional(),
  // Token nội bộ web SSR gửi qua header x-throttle-bypass để được miễn throttle (mọi SSR đi ra từ
  // cùng một IP máy chủ web). Rỗng = tắt hẳn đường miễn. Đặt thì phải đủ dài để không đoán được.
  THROTTLE_BYPASS_TOKEN: z
    .string()
    .refine((v) => v === '' || v.length >= 32, 'THROTTLE_BYPASS_TOKEN phải rỗng hoặc dài ít nhất 32 ký tự.')
    .default(''),

  // AI tư vấn 24/7 (§6.14.3) — DeepSeek (chính) + Gemini (dự phòng). Trống → tính năng tự tắt graceful.
  // CẢ HAI đều gọi qua endpoint OpenAI-compatible (/chat/completions, Bearer). Gemini ở đây là
  // proxy OpenAI-compatible (base có /v1), KHÔNG phải native Google generateContent.
  DEEPSEEK_API_KEY: z.string().default(''),
  DEEPSEEK_BASE_URL: z.string().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_BASE_URL: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
  // AI tư vấn qua Antigravity gateway (cùng cách ChoDeli; xem docs/launch/deploy-rollback-runbook.md mục AI).
  // Để trống URL hoặc KEY thì provider này không được dùng. Các số/cờ dưới đây đọc lỏng trong advisor-config.ts
  // (rỗng hoặc sai kiểu → mặc định), nên khai báo là chuỗi để .env gõ nhầm không chặn khởi động.
  ANTIGRAVITY_GATEWAY_URL: z.string().default(''),
  ANTIGRAVITY_GATEWAY_KEY: z.string().default(''),
  ANTIGRAVITY_MODEL: z.string().default(''),
  ANTIGRAVITY_GATEWAY_TIMEOUT_MS: z.string().default(''),
  // '' = tự chọn antigravity > deepseek > gemini theo provider đã cấu hình; đặt rõ thì CHỈ dùng provider đó.
  AI_ADVISOR_PROVIDER: z.enum(['', 'antigravity', 'deepseek', 'gemini']).default(''),
  // Công tắc tắt khẩn cấp: 0/false/off/no tắt AI (Mini App ẩn lối vào nhờ aiAdvisorEnabled ở /config/public).
  AI_ADVISOR_ENABLED: z.string().default(''),
  AI_ADVISOR_GLOBAL_PER_MIN: z.string().default(''),
  AI_ADVISOR_MAX_CONCURRENT: z.string().default(''),
}).superRefine((env, ctx) => {
  const email = resolveOpsEmailConfig(env);
  if (email.state === 'misconfigured') {
    for (const issue of email.issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.key], message: issue.message });
  }
  // Fail-closed ở production: bắt buộc khai báo webhook secret để không bị forge.
  if (env.NODE_ENV === 'production') {
    if (!env.PANCAKE_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PANCAKE_WEBHOOK_SECRET'],
        message: 'PANCAKE_WEBHOOK_SECRET không được rỗng ở production.',
      });
    }
    // Thiếu khoá Pancake thì app vẫn nhận đơn nhưng không đơn nào tới kho — chặn ngay lúc boot cho lộ ra khi deploy.
    for (const key of ['PANCAKE_API_KEY', 'PANCAKE_SHOP_ID'] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} không được rỗng ở production (đơn sẽ không bao giờ tới kho Pancake).`,
        });
      }
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
    // Gomdon: đã đặt tài khoản (tính năng có thể tự đặt bưu tá thật) thì BẮT BUỘC có secret webhook —
    // thiếu secret thì controller từ chối mọi webhook (401) → đơn thu gom không bao giờ tự sang
    // SHIPPING/DELIVERED mà không ai hay. Chặn ngay lúc boot cho lộ ra khi deploy.
    if (env.GOMDON_PHONE && env.GOMDON_PASSWORD && !env.GOMDON_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOMDON_WEBHOOK_SECRET'],
        message: 'GOMDON_WEBHOOK_SECRET không được rỗng ở production khi đã đặt GOMDON_PHONE/GOMDON_PASSWORD.',
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
