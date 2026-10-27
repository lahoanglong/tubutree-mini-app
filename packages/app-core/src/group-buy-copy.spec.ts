import { describe, expect, it } from 'vitest';
import { groupMemberStatus, groupMissing, groupPriceLabels, groupRewardLine } from './group-buy-copy';

const fmt = (n: number) => `${n}đ`;

describe('group-buy-copy', () => {
  it('ghi giá nhóm và giá mua một mình, không dùng chữ gạch giá', () => {
    expect(groupPriceLabels({ unitPrice: 102000, basePrice: 120000 }, fmt)).toEqual({ group: 'Giá nhóm 102000đ', solo: 'Mua một mình 120000đ', soloIsCheaper: false });
  });
  it('có danh sách Giờ vàng đang chạy: "Mua một mình" theo giá hiện nay, không theo giá lưu lúc tạo nhóm', () => {
    const NOW = Date.parse('2026-10-27T10:00:00Z');
    const g = { unitPrice: 85000, basePrice: 120000, product: { slug: 'gao' } };
    const flash = (over: Record<string, unknown> = {}) => ({ itemId: 'f', variationId: 'v', productSlug: 'gao', flashPrice: 90000, retailPrice: 120000, salePrice: null, endAt: '2026-10-27T12:00:00Z', ...over });
    expect(groupPriceLabels(g, fmt, [flash()], NOW).solo).toBe('Mua một mình 90000đ');
    expect(groupPriceLabels(g, fmt, [flash({ endAt: '2026-10-27T09:00:00Z' })], NOW).solo).toBe('Mua một mình 120000đ');
    expect(groupPriceLabels(g, fmt, [flash({ productSlug: 'khac' })], NOW).solo).toBe('Mua một mình 120000đ');
    expect(groupPriceLabels(g, fmt, [], NOW).solo).toBe('Mua một mình 120000đ');
    expect(groupPriceLabels(g, fmt, undefined, NOW).solo).toBe('Mua một mình 120000đ');
  });
  it('Giờ vàng của phân loại khác không tính; chỉ xét phân loại mà giá nhóm dựa trên', () => {
    const NOW = Date.parse('2026-10-27T10:00:00Z');
    const g = { unitPrice: 102000, basePrice: 120000, product: { slug: 'gao' }, variationId: 'vRep' };
    const slot = (variationId: string, flashPrice: number) => ({ itemId: variationId, variationId, productSlug: 'gao', flashPrice, retailPrice: 120000, salePrice: null, endAt: '2026-10-27T12:00:00Z' });
    expect(groupPriceLabels(g, fmt, [slot('vOther', 70000)], NOW).solo).toBe('Mua một mình 120000đ');
    expect(groupPriceLabels(g, fmt, [slot('vOther', 70000), slot('vRep', 110000)], NOW)).toMatchObject({ solo: 'Mua một mình 110000đ', soloIsCheaper: false });
  });
  it('mua một mình rẻ hơn giá nhóm: không còn nhãn "Mua một mình", nói Giờ vàng đang rẻ hơn', () => {
    const NOW = Date.parse('2026-10-27T10:00:00Z');
    const g = { unitPrice: 102000, basePrice: 120000, product: { slug: 'gao' }, variationId: 'vRep' };
    const slot = { itemId: 'f', variationId: 'vRep', productSlug: 'gao', flashPrice: 90000, retailPrice: 120000, salePrice: null, endAt: '2026-10-27T12:00:00Z' };
    expect(groupPriceLabels(g, fmt, [slot], NOW)).toEqual({ group: 'Giá nhóm 102000đ', solo: 'Giờ vàng đang rẻ hơn: 90000đ', soloIsCheaper: true });
    expect(groupPriceLabels({ ...g, basePrice: 95000 }, fmt, undefined, NOW).solo).toBe('Giá hiện nay rẻ hơn: 95000đ');
  });
  it('dòng mã nêu số người và đơn tối thiểu, mặc định theo giá nhóm', () => {
    expect(groupRewardLine({ targetSize: 3, discountPct: 15, unitPrice: 102000, minOrder: 90000 }, fmt)).toBe('Đủ 3 người: mỗi người nhận mã giảm 15%, dùng cho đơn từ 90000đ');
    expect(groupRewardLine({ targetSize: 3, discountPct: 15, unitPrice: 102000 }, fmt)).toContain('từ 102000đ');
  });
  it('số người còn thiếu không âm và chữ trạng thái của thành viên', () => {
    expect(groupMissing({ targetSize: 3, currentSize: 1 })).toBe(2);
    expect(groupMissing({ targetSize: 3, currentSize: 4 })).toBe(0);
    expect(groupMemberStatus({ targetSize: 3, currentSize: 1 })).toBe('Bạn đã ở trong nhóm · cần thêm 2 người');
    expect(groupMemberStatus({ targetSize: 3, currentSize: 3 })).toBe('Bạn đã ở trong nhóm');
  });
});
