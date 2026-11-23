import { describe, expect, it } from 'vitest';
import { FORBIDDEN_TERMS } from './shop-copy';
import {
  GROUP_LIVE_COUNTDOWN_MS,
  groupDeadline,
  groupMemberStatus,
  groupMissing,
  groupMissingLine,
  groupPriceLabels,
  groupRewardLine,
  groupSaving,
  groupShareContent,
  groupSlotsLine,
} from './group-buy-copy';

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
  it('dòng mã chỉ nói điều nhận được khi đủ nhóm: mức giảm và đơn tối thiểu (mặc định theo giá nhóm), không lẫn số người còn thiếu', () => {
    expect(groupRewardLine({ discountPct: 15, unitPrice: 102000, minOrder: 90000 }, fmt)).toBe('Đủ nhóm: mỗi người nhận mã giảm giá 15% cho đơn từ 90000đ');
    expect(groupRewardLine({ discountPct: 15, unitPrice: 102000 }, fmt)).toBe('Đủ nhóm: mỗi người nhận mã giảm giá 15% cho đơn từ 102000đ');
  });
  it('dòng còn thiếu là ý riêng; đủ người rồi thì không có dòng', () => {
    expect(groupMissingLine({ targetSize: 5, currentSize: 2 })).toBe('Còn thiếu 3 người');
    expect(groupMissingLine({ targetSize: 3, currentSize: 3 })).toBeNull();
    expect(groupMissingLine({ targetSize: 3, currentSize: 4 })).toBeNull();
  });
  it('số người còn thiếu không âm và chữ trạng thái của thành viên', () => {
    expect(groupMissing({ targetSize: 3, currentSize: 1 })).toBe(2);
    expect(groupMissing({ targetSize: 3, currentSize: 4 })).toBe(0);
    expect(groupMemberStatus({ targetSize: 3, currentSize: 1 })).toBe('Bạn đã ở trong nhóm · cần thêm 2 người');
    expect(groupMemberStatus({ targetSize: 3, currentSize: 3 })).toBe('Bạn đã ở trong nhóm');
  });
});

describe('hạn nhóm: chữ tĩnh và đồng hồ sống dưới 24 giờ', () => {
  const NOW = Date.parse('2026-11-24T03:00:00Z');
  const at = (ms: number) => new Date(NOW + ms).toISOString();
  const open = (ms: number) => ({ status: 'OPEN' as const, expiresAt: at(ms) });

  it('đúng mốc 24 giờ còn là chữ ngày; thiếu 1 ms là đồng hồ sống tới đúng expiresAt', () => {
    expect(groupDeadline(open(GROUP_LIVE_COUNTDOWN_MS), NOW)).toEqual({ kind: 'text', text: 'còn 1 ngày', expired: false });
    expect(groupDeadline(open(GROUP_LIVE_COUNTDOWN_MS - 1), NOW)).toEqual({ kind: 'live', endAt: at(GROUP_LIVE_COUNTDOWN_MS - 1) });
    expect(groupDeadline(open(2 * GROUP_LIVE_COUNTDOWN_MS + 5), NOW)).toEqual({ kind: 'text', text: 'còn 2 ngày', expired: false });
  });

  it('ranh giới hết hạn: còn 1 ms vẫn sống; đúng giờ và quá giờ (cron chưa đóng, vẫn OPEN) là đã hết hạn', () => {
    expect(groupDeadline(open(1), NOW).kind).toBe('live');
    expect(groupDeadline(open(0), NOW)).toEqual({ kind: 'text', text: 'đã hết hạn', expired: true });
    expect(groupDeadline(open(-60_000), NOW)).toEqual({ kind: 'text', text: 'đã hết hạn', expired: true });
  });

  it('đủ nhóm không đếm giờ; nhóm đã đóng hay mốc hỏng là hết hạn, không bao giờ "NaN"', () => {
    expect(groupDeadline({ status: 'SUCCESS', expiresAt: at(3_600_000) }, NOW)).toEqual({ kind: 'text', text: 'đã đủ nhóm', expired: false });
    expect(groupDeadline({ status: 'FAILED', expiresAt: at(3_600_000) }, NOW)).toEqual({ kind: 'text', text: 'đã hết hạn', expired: true });
    expect(groupDeadline({ status: 'OPEN', expiresAt: 'rác' }, NOW)).toEqual({ kind: 'text', text: 'đã hết hạn', expired: true });
  });
});

describe('dòng suất còn lại và tin chia sẻ ở trang mời', () => {
  const NOW = Date.parse('2026-11-24T03:00:00Z');
  const base = {
    status: 'OPEN' as const,
    expiresAt: new Date(NOW + 3 * 3_600_000).toISOString(),
    targetSize: 5,
    currentSize: 3,
    unitPrice: 85_000,
    basePrice: 100_000,
    discountPct: 15,
    product: { name: 'Nước giặt Tubu 3,8L', slug: 'nuoc-giat', thumbnail: null },
    variationId: 'vRep',
  };
  const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

  it('"Còn N suất · Tiết kiệm X": số suất là số người còn thiếu, tiết kiệm = giá mua một mình − giá nhóm', () => {
    expect(groupSlotsLine(base, vnd, NOW)).toBe('Còn 2 suất · Tiết kiệm 15.000đ');
    expect(groupSaving(base)).toBe(15_000);
  });

  it('Giờ vàng làm giá một mình rẻ hơn giá nhóm: bỏ vế tiết kiệm, không hứa số tiền giỏ không trả', () => {
    const slot = { itemId: 'f', variationId: 'vRep', productSlug: 'nuoc-giat', flashPrice: 80_000, retailPrice: 100_000, salePrice: null, endAt: new Date(NOW + 3_600_000).toISOString() };
    expect(groupSaving(base, [slot], NOW)).toBe(0);
    expect(groupSlotsLine(base, vnd, NOW, [slot])).toBe('Còn 2 suất');
    // Giờ vàng còn đắt hơn giá nhóm: tiết kiệm tính theo giá đang bán hiện nay.
    expect(groupSlotsLine(base, vnd, NOW, [{ ...slot, flashPrice: 95_000 }])).toBe('Còn 2 suất · Tiết kiệm 10.000đ');
  });

  it('không có dòng khi đã đủ người, nhóm đóng, hay đã quá hạn', () => {
    expect(groupSlotsLine({ ...base, currentSize: 5 }, vnd, NOW)).toBeNull();
    expect(groupSlotsLine({ ...base, status: 'SUCCESS' }, vnd, NOW)).toBeNull();
    expect(groupSlotsLine({ ...base, expiresAt: new Date(NOW).toISOString() }, vnd, NOW)).toBeNull();
    // Hạn còn trên 24 giờ vẫn có dòng (chỉ chữ hạn khác).
    expect(groupSlotsLine({ ...base, expiresAt: new Date(NOW + 2 * GROUP_LIVE_COUNTDOWN_MS).toISOString() }, vnd, NOW)).toBe('Còn 2 suất · Tiết kiệm 15.000đ');
  });

  it('tin chia sẻ: tiêu đề và mô tả dùng chung hai app; có ưu đãi chào mừng thì dòng ưu đãi đứng đầu', () => {
    const plain = groupShareContent(base, null);
    expect(plain.title).toBe('Mua chung Nước giặt Tubu 3,8L giảm 15%');
    expect(plain.text).toMatch(/^Tubu Tree tặng khách mới .+\. Còn thiếu 2 người nữa là đủ nhóm, vào tham gia cùng mình nhé$/);
    const withOffer = groupShareContent(base, { amount: 20_000, minOrder: 0 });
    expect(withOffer.text).toMatch(/^Tubu Tree tặng khách mới mã 20\.000đ.+Còn thiếu 2 người nữa là đủ nhóm, vào tham gia cùng mình nhé$/);
  });

  it('chữ mới không dính thuật ngữ cấm ("Chỉ còn" bị cấm, dùng "Còn N suất")', () => {
    const lines = [groupSlotsLine(base, vnd, NOW)!, groupSlotsLine({ ...base, basePrice: 85_000 }, vnd, NOW)!, ...Object.values(groupShareContent(base, null))];
    for (const line of lines) expect(FORBIDDEN_TERMS.filter((t) => t.pattern.test(line)).map((t) => t.use), line).toEqual([]);
  });
});
