import { describe, expect, it } from 'vitest';
import { TIER_MEDALS, tierMedalAt, tierNextLine } from './loyalty-medal';
import { FORBIDDEN_TERMS } from './shop-copy';

const fmt = { money: (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toString().replace('.', ',')} triệu` : `${n.toLocaleString('vi-VN')}đ`), points: (n: number) => n.toLocaleString('vi-VN') };
const text = (l: { before: string; amount: string; after: string }) => `${l.before}${l.amount}${l.after}`;

describe('huy chương hạng', () => {
  it('bốn hạng, mỗi hạng một hình khác nhau; chỉ dùng biến màu, không mã hex', () => {
    expect(TIER_MEDALS.map((m) => m.kind)).toEqual(['sprout', 'sapling', 'tree', 'crown']);
    for (const m of TIER_MEDALS) for (const v of [m.ring, m.face, m.leaf, m.accent, m.ink, m.bg]) expect(v).toMatch(/^var\(--[a-z]+-\d+\)$/);
  });

  it('tra theo thứ hạng, kẹp về hai đầu', () => {
    expect(tierMedalAt(0).kind).toBe('sprout');
    expect(tierMedalAt(2).kind).toBe('tree');
    expect(tierMedalAt(9).kind).toBe('crown');
    expect(tierMedalAt(-1).kind).toBe('sprout');
    expect(tierMedalAt(Number.NaN).kind).toBe('sprout');
  });
});

describe('dòng tiến độ lên hạng', () => {
  it('theo tiền: một câu, phần số tách riêng để in đậm', () => {
    const l = tierNextLine({ name: 'Lộc Biếc', spendingToGo: 2_500_000, pointsToGo: 0 }, fmt);
    expect(l.amount).toBe('2,5 triệu');
    expect(text(l)).toBe('Còn 2,5 triệu mua hàng để lên hạng Lộc Biếc');
  });

  it('theo điểm có tỉ lệ quy đổi: kèm số tiền tương đương trong ngoặc', () => {
    const l = tierNextLine({ name: 'Lộc Biếc', spendingToGo: null, pointsToGo: 120 }, { ...fmt, spendFor: (p) => p * 50 });
    expect(text(l)).toBe('Còn 120 điểm (≈ 6.000đ mua hàng) để lên hạng Lộc Biếc');
  });

  it('theo điểm chưa có tỉ lệ: không đoán số tiền', () => {
    expect(text(tierNextLine({ name: 'Lộc Biếc', spendingToGo: undefined, pointsToGo: 120 }, fmt))).toBe('Còn 120 điểm tích từ mua hàng để lên hạng Lộc Biếc');
  });

  it('không dùng thuật ngữ cấm', () => {
    const all = text(tierNextLine({ name: 'X', spendingToGo: null, pointsToGo: 5 }, { ...fmt, spendFor: (p) => p }));
    for (const t of FORBIDDEN_TERMS) expect(all).not.toMatch(t.pattern);
  });
});
