import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Ghi qua tệp tạm rồi đổi tên để tiến trình chết giữa chừng không để lại tệp cụt (không fsync nên chưa chống được mất điện đột ngột).
export async function writeFileAtomic(path: string, data: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, data, { mode });
  await rename(tmp, path);
}
