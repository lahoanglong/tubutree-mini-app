import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CredentialStore } from './credentials';

const creds = { cookie: [{ key: 'a', value: 'b' }], imei: 'imei-1', userAgent: 'UA', savedAt: '2026-10-23T00:00:00.000Z' };

describe('CredentialStore', () => {
  it('chưa có tệp thì load trả null', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cred-'));
    expect(await new CredentialStore(dir, randomBytes(32)).load()).toBeNull();
  });

  it('lưu, đọc, xoá; tệp trên đĩa không chứa chữ rõ', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cred-'));
    const store = new CredentialStore(dir, randomBytes(32));
    await store.save(creds);
    expect(await store.load()).toEqual(creds);
    expect(await readFile(join(dir, 'credentials.enc'), 'utf8')).not.toContain('imei-1');
    await store.clear();
    expect(await store.load()).toBeNull();
    await store.clear();
  });

  it('save với shouldCommit trả false thì không thay tệp đang có', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cred-'));
    const store = new CredentialStore(dir, randomBytes(32));
    await store.save(creds);
    await store.save({ ...creds, imei: 'imei-2' }, () => false);
    expect(await store.load()).toEqual(creds);
  });

  it('khoá sai thì load ném lỗi thay vì trả rỗng', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cred-'));
    await new CredentialStore(dir, randomBytes(32)).save(creds);
    await expect(new CredentialStore(dir, randomBytes(32)).load()).rejects.toThrow();
  });
});
