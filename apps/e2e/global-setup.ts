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
import { createRequire } from 'module';
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

const E2E_USER_ID = 'e2e-test-user-00000000';

/**
 * Upsert user E2E vào DB mà API đang dùng (DATABASE_URL của process, rơi về apps/api/.env).
 * Prisma client lấy từ apps/api để không thêm dependency vào apps/e2e.
 */
async function seedE2eUser(apiDir: string, databaseUrl: string): Promise<void> {
  const requireFromApi = createRequire(path.join(apiDir, 'package.json'));
  const { PrismaClient } = requireFromApi('@prisma/client') as {
    PrismaClient: new (opts: { datasources: { db: { url: string } } }) => {
      user: { upsert(args: Record<string, unknown>): Promise<unknown> };
      $disconnect(): Promise<void>;
    };
  };
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await prisma.user.upsert({
      where: { id: E2E_USER_ID },
      update: { isBlocked: false },
      create: {
        id: E2E_USER_ID,
        zaloId: 'e2e-zalo-id',
        role: 'CUSTOMER',
        fullName: 'E2E Test User',
        referralCode: 'E2ETEST0',
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Ký JWT HS256 — cùng logic với scripts/dev-token.ts (không dùng thư viện ngoài).
 * sub = E2E_USER_ID — user thật được seedE2eUser() upsert vào DB, vì checkout ghi các bảng có
 * khoá ngoại tới User (sub không tồn tại → P2003 "tham chiếu không hợp lệ" thay vì lỗi nghiệp vụ).
 */
function signTestJwt(secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: E2E_USER_ID,
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
  // Spec miniapp và web-admin mock toàn bộ API: không ghi vào DB nào (apps/api/.env thường trỏ DB dev dùng chung).
  if (
    process.env.E2E_SCOPE === 'miniapp' ||
    process.env.E2E_SCOPE === 'web-admin' ||
    process.env.npm_lifecycle_event === 'test:miniapp'
  ) {
    process.env.E2E_API_TOKEN = '';
    return;
  }

  const apiDir = path.resolve(__dirname, '../api');
  const apiEnv = parseEnvFile(path.join(apiDir, '.env'));

  const secret = process.env.JWT_ACCESS_SECRET ?? apiEnv['JWT_ACCESS_SECRET'] ?? '';

  if (!secret || secret.length < 16) {
    console.warn(
      '[E2E Setup] ⚠️  JWT_ACCESS_SECRET không tìm thấy hoặc quá ngắn. ' +
        'Hãy kiểm tra apps/api/.env. API tests sẽ bị skip.'
    );
    process.env.E2E_API_TOKEN = '';
    return;
  }

  const databaseUrl = process.env.DATABASE_URL ?? apiEnv['DATABASE_URL'] ?? '';
  try {
    await seedE2eUser(apiDir, databaseUrl);
  } catch (err) {
    console.warn(
      '[E2E Setup] ⚠️  Không seed được user E2E (DB chưa chạy / chưa migrate?). API tests sẽ bị skip.',
      err instanceof Error ? err.message : err
    );
    process.env.E2E_API_TOKEN = '';
    return;
  }

  const token = signTestJwt(secret);
  process.env.E2E_API_TOKEN = token;
  console.log('\n[E2E Setup] ✅ JWT test token đã được ký với JWT_ACCESS_SECRET từ api/.env');
}
