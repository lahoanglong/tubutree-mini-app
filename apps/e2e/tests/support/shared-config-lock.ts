import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';

const STALE_MS = 5 * 60_000;

/**
 * Khoá giữa các worker Playwright quanh một cờ cấu hình dùng chung của DB gate: ca đổi cờ và ca đọc cờ để so với trang dựng sẵn không được chạy
 * chen nhau. mkdir là thao tác nguyên tử nên chỉ một worker giữ được khoá. Tên khoá gắn với DATABASE_URL (mỗi lượt gate một cổng Postgres riêng)
 * để hai lượt gate song song không chờ nhau. Worker bị giết khi đang giữ khoá thì sau STALE_MS khoá bị coi là bỏ.
 */
export async function withSharedConfigLock<T>(name: string, fn: () => Promise<T>, waitMs = 90_000): Promise<T> {
  const id = createHash('sha256').update(`${process.env.DATABASE_URL ?? ''}|${name}`).digest('hex').slice(0, 16);
  const dir = path.join(os.tmpdir(), `tubu-e2e-lock-${id}`);
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.mkdirSync(dir);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const heldFor = Date.now() - (fs.statSync(dir, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
    if (heldFor > STALE_MS) fs.rmSync(dir, { recursive: true, force: true });
    else if (Date.now() > deadline) throw new Error(`Chờ khoá ${name} quá ${waitMs} ms (${dir})`);
    else await new Promise((r) => setTimeout(r, 100));
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
