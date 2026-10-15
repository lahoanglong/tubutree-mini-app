import { evaluateBackup, type BackupSnapshot } from './backup-checks';
import { evaluateDb, type DbSnapshot } from './db-checks';
import { evaluateEnv } from './env-checks';
import { evaluateRedis, type RedisSnapshot } from './redis-checks';
import { describeError } from './secrets';
import { fail, warn, type CheckResult, type Env, type GoLivePhase } from './types';

export interface Collectors {
  db(): Promise<DbSnapshot>;
  redis(): Promise<RedisSnapshot>;
  backup(): Promise<BackupSnapshot>;
}

export function parsePhase(argv: readonly string[]): GoLivePhase {
  const eq = argv.find((a) => a.startsWith('--phase='));
  const idx = argv.indexOf('--phase');
  const raw = eq ? eq.slice('--phase='.length) : idx >= 0 ? (argv[idx + 1] ?? '') : undefined;
  if (raw === undefined) return 'post-deploy';
  if (raw === 'pre-deploy' || raw === 'post-deploy') return raw;
  throw new Error(`--phase chỉ nhận pre-deploy hoặc post-deploy, nhận được "${raw}"`);
}

/** `--env-file=<đường dẫn>` (hoặc `--env-file <đường dẫn>`): nạp một file .env vào process.env trước khi kiểm, cho máy dev. */
export function parseEnvFile(argv: readonly string[]): string | null {
  const eq = argv.find((a) => a.startsWith('--env-file='));
  if (eq) return eq.slice('--env-file='.length) || null;
  const idx = argv.indexOf('--env-file');
  return idx >= 0 ? (argv[idx + 1] ?? null) : null;
}

/**
 * Gom mọi nhóm kiểm tra. Một nhóm hỏng khi thu thập (DB không kết nối, Redis chết) trở thành đúng một dòng FAIL của nhóm
 * đó chứ không làm cả báo cáo đổ; lỗi chỉ in mã, không in thông điệp gốc vì nó có thể chứa địa chỉ hoặc tên đăng nhập.
 */
export async function runGoLiveCheck(opts: { env: Env; phase: GoLivePhase }, collectors: Collectors): Promise<CheckResult[]> {
  const results: CheckResult[] = [...evaluateEnv(opts.env)];

  try {
    results.push(...evaluateDb(await collectors.db(), { phase: opts.phase, env: opts.env }));
  } catch (err) {
    results.push(fail('Cơ sở dữ liệu', 'db.connect', 'Đọc được DB', `không đọc được (${describeError(err)})`, 'Kiểm DATABASE_URL và container postgres đang chạy; chạy trong container api để dùng đúng mạng nội bộ.'));
  }

  try {
    results.push(...evaluateRedis(await collectors.redis()));
  } catch (err) {
    results.push(fail('Redis', 'redis.connect', 'Đọc được Redis', `không đọc được (${describeError(err)})`, 'Kiểm REDIS_URL và container redis đang chạy.'));
  }

  try {
    results.push(...evaluateBackup(await collectors.backup(), opts.env));
  } catch (err) {
    results.push(warn('Backup', 'backup.collect', 'Đọc được thông tin backup', `không kiểm được (${describeError(err)})`, 'Kiểm tay: `crontab -l | grep backup-db`, `rclone listremotes`, `ls -lh /var/backups/tubutree`.'));
  }
  return results;
}
