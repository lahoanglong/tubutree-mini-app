/**
 * Kiểm tra trước mở bán: chỉ đọc, in bảng PASS/WARN/FAIL kèm cách sửa, thoát mã 1 khi có FAIL.
 *
 * Dùng (trong container api trên máy chủ, hoặc máy dev có .env):
 *   pnpm --filter @tubutree/api go-live:check                       # sau khi deploy
 *   pnpm --filter @tubutree/api go-live:check -- --phase=pre-deploy  # trước khi deploy: migration chưa áp chỉ là WARN
 *   pnpm --filter @tubutree/api go-live:check -- --env-file=.env     # máy dev: nạp file env trước (Prisma không tự đổ .env vào process.env)
 *
 * Không gọi bất kỳ API bên thứ ba nào, không ghi DB hay Redis, không in giá trị bí mật.
 * Logic nằm ở src/config/go-live (có test); file này chỉ nối vào DB, Redis và máy chủ.
 */
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { collectBackupSnapshot, collectDbSnapshot, collectRedisSnapshot, listExpectedMigrations } from '../src/config/go-live/collect';
import { exitCodeFor, formatReport } from '../src/config/go-live/report';
import { parseEnvFile, parsePhase, runGoLiveCheck } from '../src/config/go-live/run';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const envFile = parseEnvFile(args);
  if (envFile) process.loadEnvFile(envFile);
  const phase = parsePhase(args);
  const prisma = new PrismaClient();
  try {
    const results = await runGoLiveCheck(
      { env: process.env, phase },
      {
        db: async () => collectDbSnapshot(prisma, await listExpectedMigrations(path.resolve(__dirname, '../prisma/migrations'))),
        redis: () => collectRedisSnapshot(process.env.REDIS_URL ?? 'redis://localhost:6379'),
        backup: () => collectBackupSnapshot(process.env),
      },
    );
    console.log(`Kiểm tra go-live (giai đoạn ${phase})\n`);
    console.log(formatReport(results));
    return exitCodeFor(results);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    console.error('Kiểm tra go-live lỗi không lường trước:', e instanceof Error ? e.name : 'lỗi không rõ');
    process.exitCode = 2;
  });
