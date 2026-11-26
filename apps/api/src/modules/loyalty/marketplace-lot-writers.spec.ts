import { readdirSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';

/**
 * Chốt chặn W42: lô MARKETPLACE (điểm tích từ đơn sàn) chỉ được ghi ở các tệp đã duyệt. Điểm sàn chỉ dùng khi mua hàng; một chỗ ghi
 * mới (vòng quay, cây, đổi quà, phí lấy rác, thưởng) có thể tiêu hoặc cộng lô này sai luật mà không ai thấy, vì các guard cũ chỉ
 * nhìn `pointsBalance`. Thêm tệp vào ALLOWED phải kèm lý do và được review.
 *
 * Kiểm tĩnh trên mã nguồn đã bỏ comment: `lot: ... 'MARKETPLACE'`, ghi cột `pointsMarketplaceBalance` (Prisma increment/decrement/gán,
 * SQL thô) và cột lô động `POINTS_LOT_BALANCE_COLUMN[...]`.
 */
const SRC_ROOT = join(__dirname, '..', '..');

const ALLOWED: Record<string, string> = {
  'modules/external-points/external-claim-release.ts': 'cộng điểm claim đơn sàn khi hết hạn chờ',
  'modules/external-points/external-claim-status.ts': 'đảo claim đã cộng về đúng lô của dòng cộng',
  'modules/checkout/checkout.service.ts': 'trừ điểm sàn lúc đặt đơn (và khách vãng lai số dư 0)',
  'modules/checkout/checkout-split.ts': 'chia phần điểm sàn theo từng đơn của lần đặt bị tách',
  'modules/orders/order-reversal.service.ts': 'hoàn điểm sàn khi huỷ/trả đơn, trả một phần',
  'modules/orders/refund-allocation.ts': 'chia phần điểm trả lại theo lô',
  'modules/loyalty/loyalty-expiry.service.ts': 'hết hạn điểm theo từng lô có hạn',
  'modules/loyalty/points-ledger.ts': 'helper ghi sổ + số dư theo lô',
  'modules/loyalty/points-reconcile.ts': 'đối soát số dư từng lô (chỉ đọc)',
  'modules/loyalty/points-lot-columns.ts': 'bảng lô → cột số dư',
  'modules/auth/auth.service.ts': 'gộp phiên khách vào tài khoản Zalo',
  'modules/users/account-deletion.service.ts': 'xoá tài khoản',
};

const WRITERS: RegExp[] = [
  /\blot\s*:[^,}\n]*['"]MARKETPLACE['"]/,
  /\bpointsMarketplaceBalance\s*:\s*(?:\{\s*(?:increment|decrement|set)\b|-?\d)/,
  /"pointsMarketplaceBalance"\s*=/,
  /\bPOINTS_LOT_BALANCE_COLUMN\s*\[/,
];

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listSourceFiles(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/** Bỏ comment, giữ chuỗi (literal lô nằm trong chuỗi). */
function stripComments(source: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quote) {
      out += c;
      if (c === '\\') out += source[++i] ?? '';
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
    } else if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end - 1;
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 1;
      out += ' ';
    } else out += c;
  }
  return out;
}

const writesMarketplace = (source: string): boolean => {
  const code = stripComments(source);
  return WRITERS.some((re) => re.test(code));
};

describe('chỉ các tệp đã duyệt mới ghi lô MARKETPLACE (W42)', () => {
  const rel = (f: string) => f.slice(SRC_ROOT.length + 1).split(sep).join('/');
  const writers = listSourceFiles(SRC_ROOT)
    .filter((f) => writesMarketplace(readFileSync(f, 'utf8')))
    .map(rel)
    .sort();

  it('không tệp nào ngoài danh sách ghi lô MARKETPLACE', () => {
    expect(writers.filter((f) => !(f in ALLOWED))).toEqual([]);
  });

  it('quét được các chỗ ghi hiện có (không quét hụt)', () => {
    for (const f of [
      'modules/external-points/external-claim-release.ts',
      'modules/external-points/external-claim-status.ts',
      'modules/checkout/checkout.service.ts',
      'modules/orders/order-reversal.service.ts',
      'modules/loyalty/points-ledger.ts',
      'modules/loyalty/loyalty-expiry.service.ts',
      'modules/auth/auth.service.ts',
    ]) {
      expect(writers).toContain(f);
    }
  });

  it('mọi tệp trong danh sách còn tồn tại', () => {
    const all = new Set(listSourceFiles(SRC_ROOT).map(rel));
    for (const f of Object.keys(ALLOWED)) expect(all.has(f)).toBe(true);
  });
});

describe('bộ quét lô MARKETPLACE bắt đúng', () => {
  it('bắt literal lô, cột số dư, SQL thô, cột lô động', () => {
    expect(writesMarketplace("applyPointsDelta(tx, { userId, delta: -5, lot: 'MARKETPLACE', reason })")).toBe(true);
    expect(writesMarketplace("applyPointsDelta(tx, { lot: chat ? 'STANDARD' : 'MARKETPLACE', delta })")).toBe(true);
    expect(writesMarketplace('tx.user.update({ data: { pointsMarketplaceBalance: { decrement: 5 } } })')).toBe(true);
    expect(writesMarketplace('tx.user.update({ data: { pointsMarketplaceBalance: 0 } })')).toBe(true);
    expect(writesMarketplace('UPDATE "users" SET "pointsMarketplaceBalance" = 0')).toBe(true);
    expect(writesMarketplace('const column = POINTS_LOT_BALANCE_COLUMN[lot];')).toBe(true);
  });

  it('bỏ qua đọc số dư, comment và khoá của bảng tra', () => {
    expect(writesMarketplace('SELECT "pointsBalance", "pointsMarketplaceBalance" FROM "users" FOR UPDATE')).toBe(false);
    expect(writesMarketplace('select: { pointsMarketplaceBalance: true }')).toBe(false);
    expect(writesMarketplace("// applyPointsDelta(tx, { lot: 'MARKETPLACE' })")).toBe(false);
    expect(writesMarketplace("/* lot: 'MARKETPLACE' */ const x = 1;")).toBe(false);
    expect(writesMarketplace('const byLot: Record<PointsLot, number> = { STANDARD: 0, CONVERTED: 0, MARKETPLACE: 0 };')).toBe(false);
    expect(writesMarketplace('withMarketplaceNote(msg, user.pointsMarketplaceBalance)')).toBe(false);
  });
});
