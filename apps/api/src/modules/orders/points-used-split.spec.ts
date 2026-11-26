import { readdirSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';
import { convertedPointsUsed, marketplacePointsUsed, standardPointsUsed, usesExpiringPoints } from './points-used-split';

describe('points-used-split: phần điểm của đơn theo lô (W42)', () => {
  it('STANDARD = tổng − CONVERTED − MARKETPLACE', () => {
    const o = { pointsUsed: 100, pointsUsedConverted: 30, pointsUsedMarketplace: 20 };
    expect([standardPointsUsed(o), convertedPointsUsed(o), marketplacePointsUsed(o)]).toEqual([50, 30, 20]);
  });
  it('đơn trước W42 (không có cột MARKETPLACE hoặc null) giữ đúng cách chia cũ', () => {
    expect(standardPointsUsed({ pointsUsed: 40, pointsUsedConverted: 15 })).toBe(25);
    expect(marketplacePointsUsed({ pointsUsed: 40, pointsUsedConverted: 15, pointsUsedMarketplace: null })).toBe(0);
  });
  it('dữ liệu lệch không bao giờ cho phần âm hay vượt tổng', () => {
    const o = { pointsUsed: 10, pointsUsedConverted: 8, pointsUsedMarketplace: 7 };
    expect(marketplacePointsUsed(o)).toBe(7);
    expect(convertedPointsUsed(o)).toBe(3);
    expect(standardPointsUsed(o)).toBe(0);
    expect(standardPointsUsed({ pointsUsed: -5, pointsUsedConverted: -1 })).toBe(0);
    expect(marketplacePointsUsed({ pointsUsed: 5, pointsUsedConverted: 0, pointsUsedMarketplace: Number.NaN })).toBe(0);
  });
  it('usesExpiringPoints: có phần STANDARD hoặc MARKETPLACE', () => {
    expect(usesExpiringPoints({ pointsUsed: 10, pointsUsedConverted: 10 })).toBe(false);
    expect(usesExpiringPoints({ pointsUsed: 10, pointsUsedConverted: 0, pointsUsedMarketplace: 10 })).toBe(true);
    expect(usesExpiringPoints({ pointsUsed: 10, pointsUsedConverted: 5 })).toBe(true);
    expect(usesExpiringPoints({ pointsUsed: 0, pointsUsedConverted: 0 })).toBe(false);
  });
});

/**
 * Chốt chặn W42: tự trừ `pointsUsed - pointsUsedConverted` ngoài points-used-split.ts quên lô MARKETPLACE, và phần điểm sàn thành điểm
 * thường khi hoàn. Mọi nơi cần phần STANDARD dùng `standardPointsUsed`.
 */
const SRC_ROOT = join(__dirname, '..', '..');
const MANUAL_SPLIT = /\bpointsUsed\s*-\s*[\w.?!]*\bpointsUsed(?:Converted|Marketplace)\b/;

/** Bỏ comment (câu giải thích được phép nhắc biểu thức bị cấm), giữ nguyên chuỗi. */
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

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listSourceFiles(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('không tự trừ pointsUsed - pointsUsedConverted ngoài points-used-split.ts', () => {
  it('mã nguồn sạch', () => {
    const rel = (f: string) => f.slice(SRC_ROOT.length + 1).split(sep).join('/');
    const bad = listSourceFiles(SRC_ROOT)
      .filter((f) => rel(f) !== 'modules/orders/points-used-split.ts')
      .filter((f) => MANUAL_SPLIT.test(stripComments(readFileSync(f, 'utf8'))))
      .map(rel);
    expect(bad).toEqual([]);
  });
  it('bộ quét bắt các dạng thường gặp, bỏ qua tổng trừ phần đã trả', () => {
    expect(MANUAL_SPLIT.test('const s = order.pointsUsed - order.pointsUsedConverted;')).toBe(true);
    expect(MANUAL_SPLIT.test('t.pointsUsed - t.pointsUsedConverted')).toBe(true);
    expect(MANUAL_SPLIT.test('shipment.pointsUsed -shipment.pointsUsedMarketplace')).toBe(true);
    expect(MANUAL_SPLIT.test('pointsUsed - pointsUsedConverted')).toBe(true);
    expect(MANUAL_SPLIT.test('Math.max(0, order.pointsUsed - prior.pointsUsedBack)')).toBe(false);
  });
});
