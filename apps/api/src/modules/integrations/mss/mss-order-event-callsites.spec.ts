import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Quét tĩnh (kiểu waste-mint-allowlist): mọi file trong `apps/api/src` ghi `status`/`paymentStatus` của bảng `orders` phải nằm trong danh
 * sách đã rà, hoặc gọi MssOrderEventRecorder trong cùng transaction, hoặc được miễn kèm lý do. File mới ghi trạng thái đơn mà chưa rà
 * làm spec đỏ: người viết phải quyết sự kiện MSS cho đường ghi đó.
 */

const SRC_ROOT = join(__dirname, '..', '..', '..');

type Review = { kind: 'records'; events: string } | { kind: 'exempt'; reason: string };

const REVIEWED: Record<string, Review> = {
  'modules/checkout/checkout.service.ts': { kind: 'records', events: 'order.created (+ order.payment_confirmed khi trả trước đã PAID lúc tạo), trong tx tạo đơn' },
  'modules/orders/order-status.service.ts': { kind: 'records', events: 'setStatus: shipping/delivered/cancelled; markPaid: payment_confirmed' },
  'modules/orders/orders.service.ts': { kind: 'records', events: 'khách tự huỷ: order.cancelled' },
  'modules/orders/order-cod-switch.service.ts': {
    kind: 'records',
    events: 'khách đổi chuyển khoản → COD (PENDING_PAYMENT → CONFIRMED): onStatusChanged, hợp đồng v1.2 chưa có sự kiện; cố ý không phát payment_confirmed',
  },
  'modules/integrations/payment/zalopay.service.ts': { kind: 'records', events: 'callback ZaloPay lật PAID: order.payment_confirmed' },
  'modules/dealer/dealer.service.ts': { kind: 'exempt', reason: 'chỉ đơn DEALER (type = DEALER); hợp đồng không phát cho đại lý' },
  'modules/affiliate/affiliate.service.ts': { kind: 'exempt', reason: 'CTV đặt hộ (placedForCustomer): hợp đồng không phát' },
  'modules/subscriptions/subscriptions.service.ts': { kind: 'exempt', reason: 'đơn định kỳ tạo tự động, chưa có bước đồng ý của khách cho lần tạo này' },
  'modules/orders/customer-refunds.service.ts': { kind: 'exempt', reason: 'REFUNDED (hoàn tiền) không phải sự kiện của hợp đồng v1' },
  'modules/orders/order-reversal.service.ts': { kind: 'exempt', reason: 'PAID → REFUNDED khi đảo tài chính, không phải sự kiện của hợp đồng v1' },
  'modules/orders/order-returns.service.ts': { kind: 'exempt', reason: 'RETURNED/trả hàng không phát ở v1 (cần người xử lý)' },
  'modules/integrations/gomdon/gomdon-order.service.ts': { kind: 'exempt', reason: 'chỉ ghi gomdonStatus/vận đơn; vùng cấm sửa của wave' },
  'modules/integrations/pancake/pancake-attention.ts': { kind: 'exempt', reason: 'chỉ cờ cần xử lý, không đổi trạng thái đơn; vùng cấm sửa của wave' },
  'modules/integrations/pancake/pancake-order.service.ts': { kind: 'exempt', reason: 'đồng bộ trường Pancake, đổi trạng thái đi qua OrderStatusService; vùng cấm sửa của wave' },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function balanced(s: string, start: number, open: string, close: string): string {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close && --depth === 0) return s.slice(start, i + 1);
  }
  return s.slice(start);
}

/** Có ghi status/paymentStatus của orders không: prisma `order.create/update*` có khoá trạng thái hoặc data động, hay SQL `UPDATE "orders" SET status`. */
export function writesOrderStatus(source: string): boolean {
  const code = stripComments(source);
  const call = /\border\s*\.\s*(update|updateMany|upsert|create|createMany)\s*\(/g;
  for (let m = call.exec(code); m; m = call.exec(code)) {
    const args = balanced(code, m.index + m[0].length - 1, '(', ')');
    const dataKey = /\b(data|update|create)\s*:\s*/g;
    for (let d = dataKey.exec(args); d; d = dataKey.exec(args)) {
      const rest = args.slice(d.index + d[0].length);
      if (rest[0] !== '{') return true;
      const obj = balanced(rest, 0, '{', '}');
      if (/\b(status|paymentStatus)\s*:/.test(obj) || /\.\.\.\s*[A-Za-z_]/.test(obj)) return true;
    }
  }
  return /UPDATE\s+"?orders"?\s+SET[^;`]*"?(status|paymentStatus)"?\s*=/i.test(code);
}

function scan(): Map<string, string> {
  const files = new Map<string, string>();
  for (const abs of walk(SRC_ROOT)) {
    const rel = relative(SRC_ROOT, abs).split(sep).join('/');
    if (rel.startsWith('modules/integrations/mss/')) continue;
    const source = readFileSync(abs, 'utf8');
    if (writesOrderStatus(source)) files.set(rel, source);
  }
  return files;
}

describe('MSS order events: mọi đường ghi trạng thái đơn đã được rà', () => {
  const writers = scan();

  it('không có file ghi trạng thái đơn nào ngoài danh sách đã rà', () => {
    const unknown = [...writers.keys()].filter((f) => !REVIEWED[f]);
    expect(unknown).toEqual([]);
  });

  it('danh sách không còn file đã thôi ghi trạng thái đơn (giữ danh sách sạch)', () => {
    const stale = Object.keys(REVIEWED).filter((f) => !writers.has(f));
    expect(stale).toEqual([]);
  });

  it.each(Object.entries(REVIEWED).filter(([, r]) => r.kind === 'records'))('%s gọi recorder trong transaction nghiệp vụ', (file) => {
    const code = stripComments(writers.get(file) ?? '');
    expect(code).toMatch(/this\.mssOrderEvents\?\.on(OrdersPlaced|StatusChanged|Paid)\(\s*tx\b/);
  });

  it('file miễn có lý do và không gọi recorder', () => {
    for (const [file, r] of Object.entries(REVIEWED)) {
      if (r.kind !== 'exempt') continue;
      expect(r.reason.length).toBeGreaterThan(10);
      expect(stripComments(writers.get(file) ?? '')).not.toMatch(/mssOrderEvents/);
    }
  });

  it('bộ quét nhận ra các dạng ghi trạng thái', () => {
    expect(writesOrderStatus(`await tx.order.updateMany({ where: { id }, data: { status: 'SHIPPING' } });`)).toBe(true);
    expect(writesOrderStatus(`await tx.order.update({ where: { id }, data: { paymentStatus: 'PAID', paidAt } });`)).toBe(true);
    expect(writesOrderStatus(`await tx.order.update({ where: { id }, data: patch });`)).toBe(true);
    expect(writesOrderStatus('await tx.$executeRaw`UPDATE "orders" SET "status" = ${s} WHERE id = ${id}`;')).toBe(true);
    expect(writesOrderStatus(`await tx.order.update({ where: { id }, data: { note: 'x' } });`)).toBe(false);
    expect(writesOrderStatus(`// tx.order.update({ data: { status: 'X' } })`)).toBe(false);
  });
});
