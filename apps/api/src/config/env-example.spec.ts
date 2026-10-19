import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ZodObject, ZodRawShape } from 'zod';
import { envSchema } from './env.validation';

const REPO = join(__dirname, '../../../..');
const example = readFileSync(join(REPO, '.env.production.example'), 'utf8');

const schemaKeys = Object.keys(((envSchema as unknown as { _def: { schema: ZodObject<ZodRawShape> } })._def.schema).shape);

/** Khoá không cần dòng riêng trong file mẫu, kèm lý do; thêm khoá vào đây phải có lý do cụ thể. */
const NOT_IN_EXAMPLE: Record<string, string> = {
  NODE_ENV: 'compose đặt',
  PORT: 'compose đặt',
  DATABASE_URL: 'compose ghép từ POSTGRES_*',
  REDIS_URL: 'compose trỏ service nội bộ',
  ZALO_OAUTH_BASE: 'mặc định đúng, không phải đổi',
  DEEPSEEK_API_KEY: 'AI tư vấn là tính năng tuỳ chọn, tự tắt khi trống; cấu hình qua ops.yml set-env',
  DEEPSEEK_BASE_URL: 'AI tư vấn: set-env ghi cố định',
  DEEPSEEK_MODEL: 'AI tư vấn: set-env ghi cố định',
  GEMINI_API_KEY: 'AI tư vấn tuỳ chọn',
  GEMINI_BASE_URL: 'AI tư vấn: set-env ghi cố định',
  GEMINI_MODEL: 'AI tư vấn: set-env ghi cố định',
  ANTIGRAVITY_GATEWAY_URL: 'AI tư vấn tuỳ chọn',
  ANTIGRAVITY_GATEWAY_KEY: 'AI tư vấn tuỳ chọn',
  ANTIGRAVITY_MODEL: 'AI tư vấn tuỳ chọn',
  ANTIGRAVITY_GATEWAY_TIMEOUT_MS: 'AI tư vấn tuỳ chọn',
  AI_ADVISOR_PROVIDER: 'AI tư vấn tuỳ chọn',
  AI_ADVISOR_ENABLED: 'AI tư vấn tuỳ chọn',
  AI_ADVISOR_GLOBAL_PER_MIN: 'AI tư vấn tuỳ chọn',
  AI_ADVISOR_MAX_CONCURRENT: 'AI tư vấn tuỳ chọn',
};

// KEY=... hoặc `# KEY=...` (khoá mà giá trị rỗng làm API không khởi động phải để dạng chú thích).
const inExample = (key: string) => new RegExp(`^#?\\s*${key}=`, 'm').test(example);

describe('.env.production.example khớp env.validation.ts', () => {
  it('mọi khoá của schema có dòng trong file mẫu, trừ danh sách miễn có lý do', () => {
    const missing = schemaKeys.filter((k) => !(k in NOT_IN_EXAMPLE) && !inExample(k));
    expect(missing).toEqual([]);
  });

  it('danh sách miễn không chứa khoá đã bỏ khỏi schema hay đã có trong file mẫu', () => {
    for (const k of Object.keys(NOT_IN_EXAMPLE)) {
      expect(schemaKeys).toContain(k);
      expect(inExample(k)).toBe(false);
    }
  });

  it('AUTH_COOKIE_SAMESITE không để dạng `KHOÁ=` rỗng: compose đưa chuỗi rỗng vào, enum từ chối và API không khởi động', () => {
    expect(example).not.toMatch(/^AUTH_COOKIE_SAMESITE=\s*(#.*)?$/m);
  });
});
