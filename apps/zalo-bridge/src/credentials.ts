import { readdir, readFile, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { decrypt, encrypt } from './crypto';
import { writeFileAtomic } from './fs-atomic';
import type { ZaloCredentials } from './types';

export class CredentialStore {
  private readonly path: string;
  private swept = false;

  constructor(
    dir: string,
    private readonly key: Buffer,
  ) {
    this.path = join(dir, 'credentials.enc');
  }

  async load(): Promise<ZaloCredentials | null> {
    // Khởi động: chưa có lần ghi nào của tiến trình này, nên mọi tệp tạm còn sót là của tiến trình cũ (chết giữa lúc ghi).
    if (!this.swept) {
      this.swept = true;
      await this.removeTemps();
    }
    let blob: string;
    try {
      blob = await readFile(this.path, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
    return JSON.parse(decrypt(blob.trim(), this.key)) as ZaloCredentials;
  }

  async save(c: ZaloCredentials, shouldCommit?: () => boolean): Promise<void> {
    await writeFileAtomic(this.path, encrypt(JSON.stringify(c), this.key), 0o600, shouldCommit);
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
    await this.removeTemps();
  }

  // Tệp tạm của writeFileAtomic (credentials.enc.<pid>.<uuid>.tmp) cũng chứa phiên đã mã hoá. Lỗi chỉ ghi log, không ném.
  // clear chạy trong chuỗi lệnh đĩa tuần tự nên lúc này không có lần ghi nào đang dở, trừ lần ghi đã quá hạn: rename của nó
  // bị kiểm tra token chặn (rồi tự xoá tệp tạm), hoặc hỏng vì mất tệp tạm và được đồng bộ lại.
  private async removeTemps(): Promise<void> {
    const dir = dirname(this.path);
    const prefix = `${basename(this.path)}.`;
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? 'không rõ';
      if (code !== 'ENOENT') console.error(`[bridge] không đọc được thư mục phiên để xoá tệp tạm (mã ${code})`);
      return;
    }
    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue;
      await rm(join(dir, name), { force: true }).catch((e: unknown) =>
        console.error(`[bridge] không xoá được tệp tạm của phiên (mã ${(e as NodeJS.ErrnoException).code ?? 'không rõ'})`),
      );
    }
  }
}
