import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';

const STALE_MS = 5 * 60_000;

/** Bên giữ khoá đã chết (gate bị giết, worker hết giờ không chạy finally): PID ghi trong khoá không còn sống, hoặc khoá chưa kịp ghi PID mà đã quá STALE_MS. */
function holderGone(dir: string): boolean {
  let pid = Number.NaN;
  try {
    pid = Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8'));
  } catch {
    // Chưa ghi PID (vừa mkdir) hoặc khoá vừa được gỡ.
  }
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
      return false;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'ESRCH';
    }
  }
  const st = fs.statSync(dir, { throwIfNoEntry: false });
  return !!st && Date.now() - st.mtimeMs > STALE_MS;
}

/**
 * Khoá giữa các worker Playwright quanh một cờ cấu hình dùng chung của DB gate: ca đổi cờ và ca đọc cờ để so với trang dựng sẵn không được chạy
 * chen nhau. mkdir là thao tác nguyên tử nên chỉ một worker giữ được khoá. Tên khoá gắn với DATABASE_URL (mỗi lượt gate một cổng Postgres riêng)
 * để hai lượt gate song song không chờ nhau. Khoá ghi PID của worker giữ nó: worker chết thì khoá được gỡ ngay ở lượt chờ kế tiếp, không phải
 * đợi STALE_MS. waitMs mặc định dài hơn thời hạn 150 giây của ca giữ khoá lâu nhất (admin-all-tabs bật thử Đổi rác).
 */
export async function withSharedConfigLock<T>(name: string, fn: () => Promise<T>, waitMs = 160_000): Promise<T> {
  const id = createHash('sha256').update(`${process.env.DATABASE_URL ?? ''}|${name}`).digest('hex').slice(0, 16);
  const dir = path.join(os.tmpdir(), `tubu-e2e-lock-${id}`);
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'pid'), String(process.pid));
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    if (holderGone(dir)) fs.rmSync(dir, { recursive: true, force: true });
    else if (Date.now() > deadline) throw new Error(`Chờ khoá ${name} quá ${waitMs} ms (${dir})`);
    else await new Promise((r) => setTimeout(r, 100));
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
