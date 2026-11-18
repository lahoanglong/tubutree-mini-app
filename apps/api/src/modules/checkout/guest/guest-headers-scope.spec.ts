import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Phạm vi phiên khách vãng lai trên web: header `x-guest-device` (định danh trình duyệt) và `x-order-key` (khoá theo dõi đơn)
 * chỉ được đọc trong module checkout/guest. Đường khác đọc chúng là mở thêm nhóm route cho người chưa đăng nhập.
 */
const SRC = join(__dirname, '..', '..', '..');
const ALLOWED_DIR = ['modules', 'checkout', 'guest'].join(sep) + sep;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
  });
}

describe('guest checkout headers scope', () => {
  it.each(['x-guest-device', 'x-order-key'])('%s chỉ xuất hiện trong modules/checkout/guest', (header) => {
    const users = sourceFiles(SRC)
      .filter((file) => readFileSync(file, 'utf8').toLowerCase().includes(header))
      .map((file) => relative(SRC, file));
    expect(users.length).toBeGreaterThan(0);
    expect(users.filter((file) => !file.startsWith(ALLOWED_DIR))).toEqual([]);
  });
});
