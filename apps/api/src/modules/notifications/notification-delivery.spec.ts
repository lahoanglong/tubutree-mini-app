import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NOTIFICATION_DELIVERY, PROACTIVE_GROUPS, notificationDelivery, proactivePriority } from './notification-delivery';

const SRC_ROOT = join(__dirname, '../..');
const SEED_PATH = join(__dirname, '../../../prisma/seed.ts');

function seededCodes(): string[] {
  const src = readFileSync(SEED_PATH, 'utf-8');
  const start = src.indexOf('const NOTIFICATION_TEMPLATES = [');
  const open = src.indexOf('[', src.indexOf('=', start));
  const end = src.indexOf('\n];', open);
  const rows = new Function(`return ${src.slice(open, end + 2)};`)() as Array<{ code: string }>;
  return rows.map((r) => r.code);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Mã mẫu truyền thẳng dạng chuỗi vào notify()/notifySafe()/notifyWithRetry() ở mã chạy thật. */
function codesPassedToNotify(): Set<string> {
  const source = walk(SRC_ROOT)
    .map((p) => readFileSync(p, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))
    .join('\n');
  const codes = new Set<string>();
  for (const m of source.matchAll(/notify(?:Safe|WithRetry)?\(\s*[^,()]*(?:\([^)]*\))?[^,()]*,\s*['"]([A-Z][A-Z0-9_]+)['"]/g)) codes.add(m[1]!);
  return codes;
}

/** Họ mã tin giao dịch: không bao giờ được xếp vào tin chủ động (bị trần thì khách mất tin về đơn, tiền, đổi trả, đổi rác). */
const TRANSACTIONAL_PREFIXES = ['ORDER_', 'RETURN_', 'REFUND_', 'WASTE_', 'SUBSCRIPTION_', 'INVOICE_', 'OPS_', 'MERCHANT_', 'DEALER_', 'COMMISSION_', 'GROUP_BUY_', 'EXTERNAL_POINTS_'];

describe('loại gửi của mẫu thông báo (trần tin chủ động)', () => {
  const seed = seededCodes();

  it('mọi mã trong seed đều được khai loại gửi', () => {
    expect(seed.length).toBeGreaterThan(100);
    expect(seed.filter((c) => !(c in NOTIFICATION_DELIVERY))).toEqual([]);
  });

  it('không khai mã đã gỡ khỏi seed', () => {
    const inSeed = new Set(seed);
    expect(Object.keys(NOTIFICATION_DELIVERY).filter((c) => !inSeed.has(c))).toEqual([]);
  });

  it('mọi mã truyền thẳng vào notify() đều được khai loại gửi', () => {
    const used = [...codesPassedToNotify()];
    expect(used).toContain('RESTOCK_AVAILABLE');
    expect(used.filter((c) => !(c in NOTIFICATION_DELIVERY))).toEqual([]);
  });

  it('họ mã đơn hàng, thanh toán, đổi trả, hoàn tiền, đổi rác, đối tác, vận hành luôn là tin giao dịch', () => {
    const wrong = Object.entries(NOTIFICATION_DELIVERY)
      .filter(([code, d]) => TRANSACTIONAL_PREFIXES.some((p) => code.startsWith(p)) && d.kind !== 'TRANSACTIONAL')
      .map(([code]) => code);
    expect(wrong).toEqual([]);
  });

  it('voucher kéo khách quay lại là tin chủ động; voucher mốc đã đạt là tin giao dịch', () => {
    for (const code of ['WELCOME_VOUCHER', 'BIRTHDAY_VOUCHER', 'WINBACK_VOUCHER', 'SECOND_ORDER_VOUCHER']) {
      expect(notificationDelivery(code)).toEqual({ kind: 'PROACTIVE', group: 'promo' });
    }
    expect(notificationDelivery('MILESTONE_VOUCHER')).toEqual({ kind: 'TRANSACTIONAL' });
  });

  it('mã lạ lúc chạy coi là tin giao dịch, không bao giờ bị trần', () => {
    expect(notificationDelivery('SOME_FUTURE_CODE')).toEqual({ kind: 'TRANSACTIONAL' });
  });

  it('thứ tự ưu tiên: hàng về > giỏ bỏ quên > hết hạn > mua lại > chuỗi > khuyến mãi > tương tác', () => {
    expect(PROACTIVE_GROUPS).toEqual(['restock', 'cart', 'expiry', 'reorder', 'streak', 'promo', 'social']);
    expect(proactivePriority('restock')).toBeLessThan(proactivePriority('cart'));
    expect(proactivePriority('promo')).toBeLessThan(proactivePriority('social'));
    expect(notificationDelivery('RESTOCK_AVAILABLE')).toEqual({ kind: 'PROACTIVE', group: 'restock' });
    expect(notificationDelivery('CART_ABANDONED')).toEqual({ kind: 'PROACTIVE', group: 'cart' });
  });
});
