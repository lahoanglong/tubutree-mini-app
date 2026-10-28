import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * `.notify(...).catch(() => undefined)` nuốt lỗi gửi tin không để lại dấu vết: khách không nhận "Đơn đã xác nhận" hay "Đã hoàn
 * tiền" mà không ai biết để gửi lại. Chỗ nào tin là việc phụ thì dùng NotificationsService.notifySafe (log error + Sentry);
 * chỗ nào cần biết kết quả thì để notify ném và tự bắt có log.
 *
 * Bộ quét đếm ngoặc để tìm đúng dấu đóng của `.notify(`: một regex lười `.notify\\([\\s\\S]*?\\)\\s*\\.catch(...)` sẽ nối nhầm lời gọi notify
 * có try/catch với một `.catch(() => undefined)` không liên quan ở đoạn mã sau.
 */

const MODULES_DIR = join(__dirname, '../modules');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** Đuôi nuốt lỗi: `.catch(() => undefined)`, `() => null`, `() => {}` (có thể kèm tham số lỗi bỏ không dùng hoặc comment rỗng). */
const SILENT_TAIL = /^\s*\.catch\(\s*\(\s*_?(?:e|err|error)?\s*\)\s*=>\s*(?:undefined|null|void 0|\{\s*(?:\/\*[\s\S]*?\*\/\s*)?\})\s*\)/;

/** Vị trí ngay sau dấu `)` đóng của lời gọi mở ở `open`; -1 nếu không cân. Bỏ qua chuỗi và comment. */
function closeOfCall(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2);
      if (i < 0) return -1;
      i++;
    } else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

/** Số dòng (từ 1) của từng `.notify(...)` có đuôi nuốt lỗi. */
export function findSilentNotifies(src: string): number[] {
  const lines: number[] = [];
  for (const m of src.matchAll(/\.notify\(/g)) {
    const end = closeOfCall(src, m.index! + m[0].length - 1);
    if (end > 0 && SILENT_TAIL.test(src.slice(end))) lines.push(src.slice(0, m.index).split('\n').length);
  }
  return lines;
}

describe('không còn lời gửi tin nuốt lỗi không log', () => {
  it('quét đủ file (dò đúng, không rỗng)', () => {
    const names = walk(MODULES_DIR).map((f) => relative(MODULES_DIR, f));
    expect(names).toContain('notifications/notifications.service.ts');
    expect(names).toContain('orders/order-status.service.ts');
  });

  it('mọi .notify(...) trong modules/** không kết thúc bằng .catch(() => undefined|null|{})', () => {
    const offenders = walk(MODULES_DIR).flatMap((f) => findSilentNotifies(readFileSync(f, 'utf-8')).map((line) => `${relative(MODULES_DIR, f)}:${line}`));
    expect(offenders).toEqual([]);
  });
});

describe('bộ quét tin nuốt lỗi bắt đúng các dạng viết (test của chính spec)', () => {
  it('bắt các dạng nuốt lỗi, kể cả tách nhiều dòng và có hàm trong đối số', () => {
    for (const src of [
      "await this.notifications.notify(u, 'X', {}).catch(() => undefined);",
      "await this.notifications.notify(u, 'X', {}).catch(() => null);",
      "await this.notifications.notify(u, 'X', {}).catch(() => {});",
      "await this.notifications.notify(u, 'X', {}).catch(() => { });",
      "await this.notifications.notify(u, 'X', {}).catch((e) => undefined);",
      "await this.notifications\n  .notify(u, 'X', { n: fmt(a, b), s: `(${c})` })\n  .catch(() => undefined);",
      "await this.notifications.notify(u, 'X', { s: ')' /* ) */ })\n  .catch(() => undefined);",
    ]) {
      expect(findSilentNotifies(src)).toHaveLength(1);
    }
  });

  it('không bắt nơi đã log, đã dùng notifySafe, hoặc try/catch rồi mới tới một .catch không liên quan', () => {
    for (const src of [
      "await this.notifications.notify(u, 'X', {}).catch((e) => this.logger.warn(String(e)));",
      "await this.notifications.notify(u, 'X', {}).catch((e: unknown) => { this.logger.error(String(e)); });",
      "await this.notifications.notifySafe(u, 'X', {});",
      "try {\n  await this.notifications.notify(u, 'X', {});\n} catch (err) {\n  this.logger.error('lỗi');\n  await this.prisma.order.updateMany({}).catch(() => undefined);\n}",
      "await this.notifications.notify(u, 'X', {});\nawait other().catch(() => undefined);",
    ]) {
      expect(findSilentNotifies(src)).toEqual([]);
    }
  });

  it('báo đúng số dòng', () => {
    expect(findSilentNotifies("a();\nb();\nawait svc.notify(u, 'X', {}).catch(() => undefined);")).toEqual([3]);
  });
});
