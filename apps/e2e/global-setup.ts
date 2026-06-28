/**
 * Playwright Global Setup — chạy MỘT LẦN trước tất cả tests.
 * Mục đích: tạo JWT test hợp lệ và set vào process.env.E2E_API_TOKEN
 * để api.spec.ts có thể dùng.
 *
 * Không spawn process con — ký JWT trực tiếp trong Node.js bằng crypto
 * (cùng logic với scripts/dev-token.ts) để tránh vấn đề PATH trên Windows.
 *
 * Yêu cầu: apps/api/.env phải có DATABASE_URL và JWT_ACCESS_SECRET
 */
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

function parseEnvFile(filePath: string): Record<string, string> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const result: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Ký JWT HS256 — cùng logic với scripts/dev-token.ts (không dùng thư viện ngoài).
 * sub = 'e2e-test-user' (user giả, chỉ cần JWT format hợp lệ để qua Guard).
 */
function signTestJwt(secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  // sub phải là UUID-like để CurrentUser('sub') không crash khi Prisma query
  // Dùng sub giả — checkout sẽ fail 400 "giỏ hàng trống" thay vì 401
  const payload = {
    sub: 'e2e-test-user-00000000',
    role: 'CUSTOMER',
    zaloId: 'e2e-zalo-id',
    iat: now,
    exp: now + 3600,
  };
  const head = b64url(JSON.stringify(header));
  const data = b64url(JSON.stringify(payload));
  const sig = b64url(
    createHmac('sha256', secret).update(`${head}.${data}`).digest()
  );
  return `${head}.${data}.${sig}`;
}

export default async function globalSetup() {
  const apiDir = path.resolve(__dirname, '../api');
  const apiEnv = parseEnvFile(path.join(apiDir, '.env'));

  const secret = apiEnv['JWT_ACCESS_SECRET'] ?? process.env.JWT_ACCESS_SECRET ?? '';

  if (!secret || secret.length < 16) {
    console.warn(
      '[E2E Setup] ⚠️  JWT_ACCESS_SECRET không tìm thấy hoặc quá ngắn. ' +
        'Hãy kiểm tra apps/api/.env. API tests sẽ bị skip.'
    );
    process.env.E2E_API_TOKEN = '';
    return;
  }

  const token = signTestJwt(secret);
  process.env.E2E_API_TOKEN = token;
  console.log('\n[E2E Setup] ✅ JWT test token đã được ký với JWT_ACCESS_SECRET từ api/.env');
}
