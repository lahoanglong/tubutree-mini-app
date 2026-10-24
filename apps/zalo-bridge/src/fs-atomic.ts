import { randomUUID } from 'node:crypto';
import { mkdir, open, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

// Ghi tệp tạm, fsync, đổi tên rồi fsync thư mục: tiến trình chết hay mất điện giữa chừng cũng chỉ còn bản cũ hoặc bản mới nguyên vẹn.
export async function writeFileAtomic(path: string, data: string, mode = 0o600): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const file = await open(tmp, 'w', mode);
  try {
    await file.writeFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(tmp, path);
  await syncDir(dir);
}

async function syncDir(dir: string): Promise<void> {
  let handle;
  try {
    handle = await open(dir, 'r');
  } catch {
    return;
  }
  try {
    await handle.sync();
  } catch (e) {
    // Một số nền tảng (Windows, vài hệ tệp mạng) từ chối fsync trên thư mục; bản ghi tệp đã bền, chỉ bước đổi tên là không bảo đảm.
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EISDIR' && code !== 'EINVAL' && code !== 'EPERM') throw e;
  } finally {
    await handle.close();
  }
}
