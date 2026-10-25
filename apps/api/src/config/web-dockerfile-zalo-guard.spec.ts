import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '..', '..', '..', '..');
const dockerfile = readFileSync(join(REPO, 'apps/web/Dockerfile'), 'utf8');

// Lấy đúng đoạn RUN kiểm Zalo ID trong Dockerfile (nối dòng bằng "\") để chạy bằng sh, không cần docker.
function guardScript(): string {
  const lines = dockerfile.split('\n');
  const start = lines.findIndex((l) => l.startsWith('RUN case "$NEXT_PUBLIC_ZALO_APP_ID"'));
  if (start < 0) throw new Error('không thấy đoạn kiểm Zalo ID trong apps/web/Dockerfile');
  const body: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? '';
    body.push(line.replace(/^RUN /, '').replace(/\\$/, ''));
    if (!line.endsWith('\\')) break;
  }
  return body.join('\n');
}

function run(env: Record<string, string>) {
  const r = spawnSync('sh', ['-c', guardScript()], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' });
  return { code: r.status, err: r.stderr };
}

describe('apps/web/Dockerfile: kiểm ZALO_APP_ID và ZALO_MINIAPP_ID lúc build', () => {
  it('khai báo ARG và ENV cho NEXT_PUBLIC_ZALO_MINIAPP_ID', () => {
    expect(dockerfile).toMatch(/^ARG NEXT_PUBLIC_ZALO_MINIAPP_ID$/m);
    expect(dockerfile).toMatch(/^ENV NEXT_PUBLIC_ZALO_MINIAPP_ID=\$NEXT_PUBLIC_ZALO_MINIAPP_ID$/m);
  });

  it('hai ID khác nhau: qua', () => {
    expect(run({ NEXT_PUBLIC_ZALO_APP_ID: '565779011239360460', NEXT_PUBLIC_ZALO_MINIAPP_ID: '2070857098114207963' }).code).toBe(0);
  });

  it('thiếu ID Mini App: dừng build', () => {
    const r = run({ NEXT_PUBLIC_ZALO_APP_ID: '565779011239360460', NEXT_PUBLIC_ZALO_MINIAPP_ID: '' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('NEXT_PUBLIC_ZALO_MINIAPP_ID');
  });

  it('thiếu App ID: dừng build', () => {
    expect(run({ NEXT_PUBLIC_ZALO_APP_ID: '', NEXT_PUBLIC_ZALO_MINIAPP_ID: '2070857098114207963' }).code).toBe(1);
  });

  it('hai ID trùng nhau: dừng build, thông báo nói rõ ID nào để đâu', () => {
    const r = run({ NEXT_PUBLIC_ZALO_APP_ID: '2070857098114207963', NEXT_PUBLIC_ZALO_MINIAPP_ID: '2070857098114207963' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('developers.zalo.me');
    expect(r.err).toContain('zalo.me/s/');
  });

  it('ALLOW_EMPTY_ZALO_APP_ID=1 và thiếu ID: chỉ cảnh báo', () => {
    const r = run({ NEXT_PUBLIC_ZALO_APP_ID: '', NEXT_PUBLIC_ZALO_MINIAPP_ID: '', ALLOW_EMPTY_ZALO_APP_ID: '1' });
    expect(r.code).toBe(0);
    expect(r.err).toContain('CANH BAO');
  });

  it.each([
    ['App ID', { NEXT_PUBLIC_ZALO_APP_ID: '56577x', NEXT_PUBLIC_ZALO_MINIAPP_ID: '2070857098114207963' }],
    ['Mini App ID', { NEXT_PUBLIC_ZALO_APP_ID: '565779011239360460', NEXT_PUBLIC_ZALO_MINIAPP_ID: '"2070857098114207963"' }],
    ['Mini App ID có khoảng trắng', { NEXT_PUBLIC_ZALO_APP_ID: '565779011239360460', NEXT_PUBLIC_ZALO_MINIAPP_ID: '2070857098114207963 ' }],
  ])('%s không phải chuỗi số: dừng build', (_n, env) => {
    const r = run(env);
    expect(r.code).toBe(1);
    expect(r.err).toContain('khong phai chuoi so');
  });

  it('ALLOW_EMPTY_ZALO_APP_ID=1 không cho phép ID không phải số (kể cả khi ID kia rỗng)', () => {
    expect(run({ NEXT_PUBLIC_ZALO_APP_ID: 'abc', NEXT_PUBLIC_ZALO_MINIAPP_ID: '2070857098114207963', ALLOW_EMPTY_ZALO_APP_ID: '1' }).code).toBe(1);
    expect(run({ NEXT_PUBLIC_ZALO_APP_ID: 'abc', NEXT_PUBLIC_ZALO_MINIAPP_ID: '', ALLOW_EMPTY_ZALO_APP_ID: '1' }).code).toBe(1);
  });

  it('ALLOW_EMPTY_ZALO_APP_ID=1 không cho phép hai ID trùng nhau', () => {
    expect(run({ NEXT_PUBLIC_ZALO_APP_ID: '5', NEXT_PUBLIC_ZALO_MINIAPP_ID: '5', ALLOW_EMPTY_ZALO_APP_ID: '1' }).code).toBe(1);
  });
});
