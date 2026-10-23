import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Ghi qua tệp tạm rồi đổi tên để mất điện giữa chừng không để lại tệp cụt.
export async function writeFileAtomic(path: string, data: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, data, { mode });
  await rename(tmp, path);
}
