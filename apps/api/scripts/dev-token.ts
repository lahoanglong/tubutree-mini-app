/**
 * DEV ONLY — tạo (hoặc lấy) 1 user test và in ra JWT access token để smoke-test API
 * mà không cần luồng đăng nhập Zalo thật. KHÔNG dùng ở production.
 *   pnpm exec tsx scripts/dev-token.ts
 */
import { PrismaClient } from '@prisma/client';
import { createHmac } from 'node:crypto';

const prisma = new PrismaClient();

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function signHs256(payload: object, secret: string, expSec = 3600): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expSec };
  const head = b64url(JSON.stringify(header));
  const data = b64url(JSON.stringify(body));
  const sig = b64url(createHmac('sha256', secret).update(`${head}.${data}`).digest());
  return `${head}.${data}.${sig}`;
}

async function main() {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('Thiếu JWT_ACCESS_SECRET');

  const role = (process.env.DEV_ROLE ?? 'CUSTOMER') as 'CUSTOMER' | 'ADMIN' | 'DEALER';
  const zaloId = role === 'ADMIN' ? 'dev-admin-user' : 'dev-test-user';
  // update: {} — KHÔNG ghi đè role của user đang tồn tại (tránh clobber khi test).
  const user = await prisma.user.upsert({
    where: { zaloId },
    update: {},
    create: {
      zaloId,
      role,
      fullName: role === 'ADMIN' ? 'Dev Admin' : 'Dev Tester',
      referralCode: role === 'ADMIN' ? 'DEVADMIN' : 'DEVTEST1',
      phone: role === 'ADMIN' ? '0900000099' : '0900000001',
    },
  });

  const token = signHs256(
    { sub: user.id, role: user.role, zaloId: user.zaloId },
    secret,
  );
  console.log(token);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
