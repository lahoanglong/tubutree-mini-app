import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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

  async function strays() {
    const dir = await mkdtemp(join(tmpdir(), 'cred-'));
    await writeFile(join(dir, 'credentials.enc.123.aaaa.tmp'), 'x');
    await writeFile(join(dir, 'credentials.enc.456.bbbb.tmp'), 'y');
    await writeFile(join(dir, 'config.json.1.cccc.tmp'), 'z');
    await writeFile(join(dir, 'credentials.encX.1.tmp'), 'w');
    await writeFile(join(dir, 'sent.json'), '{}');
    return dir;
  }
  const others = ['config.json.1.cccc.tmp', 'credentials.encX.1.tmp', 'sent.json'];

  it('clear xoá cả tệp tạm còn sót của credentials.enc, không đụng tệp khác', async () => {
    const dir = await strays();
    const store = new CredentialStore(dir, randomBytes(32));
    await store.save(creds);
    await store.clear();
    expect((await readdir(dir)).sort()).toEqual(others);
  });

  it('lần load đầu (khởi động) xoá tệp tạm còn sót trước khi đọc, không đụng tệp khác', async () => {
    const dir = await strays();
    const store = new CredentialStore(dir, randomBytes(32));
    expect(await store.load()).toBeNull();
    expect((await readdir(dir)).sort()).toEqual(others);
  });

  it('không xoá được một tệp tạm thì ghi log, clear vẫn xoá tệp chính và không ném lỗi', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dir = await mkdtemp(join(tmpdir(), 'cred-'));
    await mkdir(join(dir, 'credentials.enc.9.dddd.tmp'));
    const store = new CredentialStore(dir, randomBytes(32));
    await store.save(creds);
    await store.clear();
    expect(await readdir(dir)).toEqual(['credentials.enc.9.dddd.tmp']);
    expect(err).toHaveBeenCalled();
    expect(JSON.stringify(err.mock.calls)).not.toContain('imei-1');
    err.mockRestore();
  });

  it('khoá sai thì load ném lỗi thay vì trả rỗng', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cred-'));
    await new CredentialStore(dir, randomBytes(32)).save(creds);
    await expect(new CredentialStore(dir, randomBytes(32)).load()).rejects.toThrow();
  });
});
