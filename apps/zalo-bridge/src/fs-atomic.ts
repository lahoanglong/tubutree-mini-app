import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

// Ghi tệp tạm, fsync, đổi tên rồi fsync thư mục: tiến trình chết hay mất điện giữa chừng cũng chỉ còn bản cũ hoặc bản mới nguyên vẹn.
export async function writeFileAtomic(path: string, data: string, mode = 0o600): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const file = await open(tmp, 'w', mode);
    try {
      await file.writeFile(data);
      await file.sync();
    } finally {
      // Lỗi đóng không được che lỗi ghi gốc; nếu ghi và fsync đã xong thì dữ liệu đã bền.
      await file.close().catch(() => undefined);
    }
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
  await syncDir(dir);
}

const DIR_FSYNC_UNSUPPORTED = new Set(['EISDIR', 'EINVAL', 'EPERM']);

// Chạy sau rename nên tệp đã vào chỗ: lỗi ở đây chỉ ghi log, không được báo thất bại cho người gọi.
async function syncDir(dir: string): Promise<void> {
  try {
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close().catch(() => undefined);
    }
  } catch (e) {
    // Windows và vài hệ tệp mạng từ chối mở hay fsync thư mục.
    if (DIR_FSYNC_UNSUPPORTED.has((e as NodeJS.ErrnoException).code ?? '')) return;
    console.error('[bridge] fsync thư mục lỗi sau khi đổi tên tệp');
  }
}
