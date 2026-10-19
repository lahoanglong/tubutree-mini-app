import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeZaloPhone } from '../common/phone';

const SCRIPT = join(__dirname, '../../scripts/grant-admin.js');

// Chạy bằng node thuần như trong image: script là CommonJS không qua ts-jest. Nạp bằng require không chạy main (guard require.main), nên không cần DB.
function normalizeInChild(raw: string): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, ['-e', `const m = require(${JSON.stringify(SCRIPT)}); console.log(JSON.stringify(m.normalizeAdminPhone(${JSON.stringify(raw)})));`], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ADMIN_PHONE: '0912345678' },
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}`.trim() };
}

function runScript(phone: string): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    // DATABASE_URL trỏ cổng chết: nếu script lọt qua bước kiểm SĐT thì lỗi kết nối sẽ lộ ra thay vì lỗi định dạng.
    env: { PATH: process.env.PATH ?? '', ADMIN_PHONE: phone, DATABASE_URL: 'postgresql://x@127.0.0.1:1/x' },
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

describe('apps/api/scripts/grant-admin.js: chuẩn hoá ADMIN_PHONE', () => {
  it.each(['+84912345678', '84912345678', '0912345678', '+84 912 345 678', '0912.345.678'])('%s về 0912345678 như normalizeZaloPhone', (raw) => {
    expect(normalizeZaloPhone(raw)).toBe('0912345678');
    expect(normalizeInChild(raw)).toEqual({ status: 0, out: '"0912345678"' });
  });

  it.each(['abc', '091234567', '09123456789', '+8491234567', ''])('%j sai định dạng: null, giống normalizeZaloPhone', (raw) => {
    expect(normalizeZaloPhone(raw)).toBeNull();
    expect(normalizeInChild(raw)).toEqual({ status: 0, out: 'null' });
  });

  it('SĐT sai định dạng: thoát mã 1 với thông báo nêu 10 số, trước khi chạm DB', () => {
    const { status, out } = runScript('+84 12');
    expect(status).toBe(1);
    expect(out).toMatch(/ADMIN_PHONE/);
    expect(out).toMatch(/10 số/);
    expect(out).not.toMatch(/Can't reach database|P1001/);
  });

  // ops.yml chạy `node < grant-admin.js`: khi mã đến từ stdin thì require.main là undefined, guard CLI không được bỏ qua main.
  describe('chạy qua stdin như .github/workflows/ops.yml', () => {
    function runViaStdin(phone: string): { status: number | null; out: string } {
      const res = spawnSync(process.execPath, [], {
        input: readFileSync(SCRIPT),
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '', ADMIN_PHONE: phone, DATABASE_URL: 'postgresql://x@127.0.0.1:1/x' },
      });
      return { status: res.status, out: `${res.stdout}${res.stderr}` };
    }

    it('SĐT sai định dạng: thoát mã 1 nêu 10 số', () => {
      const { status, out } = runViaStdin('+84 12');
      expect(status).toBe(1);
      expect(out).toMatch(/10 số/);
    });

    it('SĐT đúng: main chạy tới DB (lỗi kết nối chứng minh điều đó)', () => {
      const { status, out } = runViaStdin('+84912345678');
      expect(status).toBe(1);
      expect(out).toMatch(/Can't reach database|P1001|FAIL/);
    });
  });
});
