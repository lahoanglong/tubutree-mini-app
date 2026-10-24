import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { decrypt, encrypt } from './crypto';
import { writeFileAtomic } from './fs-atomic';
import type { ZaloCredentials } from './types';

export class CredentialStore {
  private readonly path: string;

  constructor(
    dir: string,
    private readonly key: Buffer,
  ) {
    this.path = join(dir, 'credentials.enc');
  }

  async load(): Promise<ZaloCredentials | null> {
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
  }
}
