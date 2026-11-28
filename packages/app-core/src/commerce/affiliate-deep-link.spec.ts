import { describe, expect, it } from 'vitest';
import { FORBIDDEN_TERMS } from '../shop-copy';
import { posterContent } from './share-poster';
import {
  affiliateLinkCaption,
  affiliateLinkPath,
  affiliateLinkPoster,
  affiliateLinkStats,
  affiliateLinkTitle,
  AFFILIATE_LINK_TARGETS,
  COMMISSION_AWAITING_PAYMENT_NOTE,
  commissionUnlockNote,
  CTV_FUNNEL_NOTE,
  ctvFunnel,
  ctvFunnelLine,
  LINK_BUILDER_COPY,
  LINK_POSTER_COPY,
  linkCampaignOptions,
  linkCategoryOptions,
  linkOpensTarget,
  linkTargetNeedsPick,
} from './affiliate-deep-link';

const link = (o: Partial<Parameters<typeof affiliateLinkPath>[0]> = {}) => ({ shortCode: 'Ab3_-xY', targetType: 'HOMEPAGE', ...o });

describe('affiliateLinkPath', () => {
  it('Trang chủ: / kèm ref và mã link, hai nền tảng như nhau', () => {
    expect(affiliateLinkPath(link(), 'LINH123', 'web')).toBe('/?ref=LINH123&l=Ab3_-xY');
    expect(affiliateLinkPath(link(), 'LINH123', 'miniapp')).toBe('/?ref=LINH123&l=Ab3_-xY');
  });

  it('Sản phẩm: web /san-pham/<slug>, Mini /product/<slug>; slug được mã hoá', () => {
    const p = link({ targetType: 'PRODUCT', targetId: 'p1', targetSlug: 'nuoc-rua-chen', targetAvailable: true });
    expect(affiliateLinkPath(p, 'LINH123', 'web')).toBe('/san-pham/nuoc-rua-chen?ref=LINH123&l=Ab3_-xY');
    expect(affiliateLinkPath(p, 'LINH123', 'miniapp')).toBe('/product/nuoc-rua-chen?ref=LINH123&l=Ab3_-xY');
    expect(affiliateLinkPath({ ...p, targetSlug: 'a b/c' }, 'LINH123', 'web')).toBe('/san-pham/a%20b%2Fc?ref=LINH123&l=Ab3_-xY');
  });

  it('Danh mục: web /san-pham?category=<id>, Mini /browse?category=<id> (khoá mà trang duyệt hàng đọc)', () => {
    const c = link({ targetType: 'CATEGORY', targetId: 'cat_1', targetSlug: 'nha-bep' });
    expect(affiliateLinkPath(c, 'LINH123', 'web')).toBe('/san-pham?category=cat_1&ref=LINH123&l=Ab3_-xY');
    expect(affiliateLinkPath(c, 'LINH123', 'miniapp')).toBe('/browse?category=cat_1&ref=LINH123&l=Ab3_-xY');
  });

  it('Giờ vàng: web /gio-vang, Mini /flash-sale', () => {
    const d = link({ targetType: 'DEAL' });
    expect(affiliateLinkPath(d, 'LINH123', 'web')).toBe('/gio-vang?ref=LINH123&l=Ab3_-xY');
    expect(affiliateLinkPath(d, 'LINH123', 'miniapp')).toBe('/flash-sale?ref=LINH123&l=Ab3_-xY');
  });

  it('đích đã mất (ngừng bán, thiếu slug/id) hoặc loại lạ: mở Trang chủ, vẫn giữ ref và mã link để còn đếm', () => {
    const gone = [
      link({ targetType: 'PRODUCT', targetSlug: 'sp', targetAvailable: false }),
      link({ targetType: 'PRODUCT', targetSlug: null }),
      link({ targetType: 'CATEGORY', targetId: '  ' }),
      link({ targetType: 'STORE' }),
    ];
    for (const g of gone) {
      expect(linkOpensTarget(g)).toBe(false);
      expect(affiliateLinkPath(g, 'LINH123', 'web')).toBe('/?ref=LINH123&l=Ab3_-xY');
    }
  });

  it('mã sai khuôn bị bỏ khỏi URL, không đưa chuỗi lạ vào link', () => {
    expect(affiliateLinkPath(link({ shortCode: 'x' }), 'LINH123', 'web')).toBe('/?ref=LINH123');
    expect(affiliateLinkPath(link(), 'a&b=c', 'web')).toBe('/?l=Ab3_-xY');
    expect(affiliateLinkPath(link({ shortCode: '' }), '', 'web')).toBe('/');
  });
});

describe('affiliateLinkTitle / affiliateLinkCaption', () => {
  it('tên dòng theo loại đích, kèm tên sản phẩm/danh mục', () => {
    expect(affiliateLinkTitle({ targetType: 'HOMEPAGE' })).toBe('Trang chủ');
    expect(affiliateLinkTitle({ targetType: 'DEAL', targetLabel: 'bỏ qua' })).toBe('Giờ vàng');
    expect(affiliateLinkTitle({ targetType: 'PRODUCT', targetLabel: ' Nước rửa chén ' })).toBe('Sản phẩm · Nước rửa chén');
    expect(affiliateLinkTitle({ targetType: 'CATEGORY', targetLabel: 'Nhà bếp' })).toBe('Danh mục · Nhà bếp');
    expect(affiliateLinkTitle({ targetType: 'PRODUCT', targetLabel: null })).toBe('Sản phẩm');
    expect(affiliateLinkTitle({ targetType: 'STORE' })).toBe('Link');
  });

  it('dòng phụ: lượt bấm, đơn (tỉ lệ của riêng link) và doanh số của link; chưa có doanh số thì không nêu tiền', () => {
    expect(affiliateLinkCaption({ ...link(), clicks: 12, conversions: 3, revenue: 1_250_000 })).toBe('12 lượt bấm · 3 đơn (25%) · 1.250.000đ');
    expect(affiliateLinkCaption({ ...link(), clicks: 340, conversions: 12, revenue: 99_000 })).toBe('340 lượt bấm · 12 đơn (3,5%) · 99.000đ');
    expect(affiliateLinkCaption({ ...link(), clicks: 12, conversions: 0, revenue: 0 })).toBe('12 lượt bấm · 0 đơn');
    // API cũ (chưa trả số đơn): như 0 đơn, không lỗi.
    expect(affiliateLinkCaption({ ...link(), clicks: 0 })).toBe('0 lượt bấm · 0 đơn');
    expect(affiliateLinkCaption({ ...link({ targetType: 'PRODUCT', targetSlug: 'sp', targetAvailable: false }), clicks: 3, conversions: 1, revenue: 50_000 })).toBe(
      '3 lượt bấm · 1 đơn (33,3%) · 50.000đ · Đích không còn, link mở Trang chủ',
    );
  });

  it('sản phẩm bị tắt hoa hồng sau khi tạo link: dòng phụ báo rõ; đích đã mất thì báo mở Trang chủ trước', () => {
    const product = link({ targetType: 'PRODUCT', targetSlug: 'sp', targetCommissionBlocked: true });
    expect(affiliateLinkCaption({ ...product, clicks: 2 })).toBe('2 lượt bấm · 0 đơn · Sản phẩm không còn tính hoa hồng');
    expect(affiliateLinkCaption({ ...product, targetAvailable: false, clicks: 2 })).toBe('2 lượt bấm · 0 đơn · Đích không còn, link mở Trang chủ');
    expect(affiliateLinkCaption({ ...link({ targetCommissionBlocked: true }), clicks: 2 })).toBe('2 lượt bấm · 0 đơn');
  });
});

describe('affiliateLinkStats', () => {
  it('tỉ lệ = đơn / lượt bấm của riêng link; số bẩn (âm, NaN, thiếu) về 0; đơn nhiều hơn lượt bấm thì không nêu phần trăm', () => {
    expect(affiliateLinkStats({ clicks: 8, conversions: 2, revenue: 400_000 })).toEqual({ clicks: 8, orders: 2, ratePct: 25, revenue: 400_000 });
    expect(affiliateLinkStats({ clicks: -1, conversions: Number.NaN, revenue: -5 })).toEqual({ clicks: 0, orders: 0, ratePct: null, revenue: 0 });
    expect(affiliateLinkStats({ clicks: 1, conversions: 3 })).toEqual({ clicks: 1, orders: 3, ratePct: null, revenue: 0 });
  });
});

describe('affiliateLinkPoster', () => {
  it('link sản phẩm còn mở: thẻ sản phẩm, QR trỏ trang sản phẩm web kèm ref và l của link', () => {
    const p = link({ targetType: 'PRODUCT', targetId: 'p1', targetSlug: 'nuoc-rua-chen', targetLabel: 'Nước rửa chén', targetAvailable: true });
    const input = affiliateLinkPoster(p, 'LINH123');
    expect(input).toEqual({ kind: 'product', name: 'Nước rửa chén', slug: 'nuoc-rua-chen', referralCode: 'LINH123', linkCode: 'Ab3_-xY' });
    expect(posterContent(input).url).toBe('https://tubutree.com/san-pham/nuoc-rua-chen?ref=LINH123&l=Ab3_-xY');
  });

  it('Trang chủ, Giờ vàng, danh mục, sản phẩm đã ẩn: ảnh kiểu gian hàng, QR trỏ đúng đích web; mã sai khuôn bị bỏ', () => {
    expect(posterContent(affiliateLinkPoster(link(), 'LINH123')).url).toBe('https://tubutree.com/?ref=LINH123&l=Ab3_-xY');
    expect(posterContent(affiliateLinkPoster(link({ targetType: 'DEAL' }), 'LINH123')).url).toBe('https://tubutree.com/gio-vang?ref=LINH123&l=Ab3_-xY');
    const cat = affiliateLinkPoster(link({ targetType: 'CATEGORY', targetId: 'c 1', targetLabel: 'Nhà bếp', targetAvailable: true }), 'LINH123');
    expect(cat).toMatchObject({ kind: 'store', title: 'Danh mục · Nhà bếp' });
    expect(posterContent(cat).url).toBe('https://tubutree.com/san-pham?category=c%201&ref=LINH123&l=Ab3_-xY');
    const gone = affiliateLinkPoster(link({ targetType: 'PRODUCT', targetSlug: 'sp', targetAvailable: false }), 'LINH123');
    expect(posterContent(gone).url).toBe('https://tubutree.com/?ref=LINH123&l=Ab3_-xY');
    expect(posterContent(affiliateLinkPoster(link({ shortCode: 'x' }), 'bad code!')).url).toBe('https://tubutree.com/');
  });
});

describe('ctvFunnel / ctvFunnelLine', () => {
  it('tỉ lệ = đơn / lượt bấm, một chữ số thập phân, dấu phẩy thập phân', () => {
    const f = ctvFunnel({ totalClicks: 340, totalConversions: 12 });
    expect(f).toEqual({ clicks: 340, orders: 12, ratePct: 3.5 });
    expect(ctvFunnelLine(f)).toBe('Tỉ lệ ra đơn chung 3,5% · 12 đơn / 340 lượt bấm');
    expect(ctvFunnelLine(ctvFunnel({ totalClicks: 4, totalConversions: 4 }))).toBe('Tỉ lệ ra đơn chung 100% · 4 đơn / 4 lượt bấm');
  });

  it('chưa có lượt bấm, hoặc đơn nhiều hơn lượt bấm (đơn từ gian hàng/mã): không nêu phần trăm', () => {
    expect(ctvFunnel(undefined)).toEqual({ clicks: 0, orders: 0, ratePct: null });
    expect(ctvFunnelLine(ctvFunnel(undefined))).toBe('Chưa có lượt bấm nào. Gửi link đầu tiên để bắt đầu.');
    expect(ctvFunnelLine(ctvFunnel({ totalClicks: 0, totalConversions: 3 }))).toBe('3 đơn / 0 lượt bấm');
    expect(ctvFunnelLine(ctvFunnel({ totalClicks: 2, totalConversions: 5 }))).toBe('5 đơn / 2 lượt bấm');
    expect(ctvFunnel({ totalClicks: -1, totalConversions: -2 })).toEqual({ clicks: 0, orders: 0, ratePct: null });
  });
});

describe('commissionUnlockNote', () => {
  const fmt = (iso: string) => iso.slice(0, 10);
  it('chỉ khoản LOCKED có ngày dự kiến mới có dòng', () => {
    expect(commissionUnlockNote({ status: 'LOCKED', unlockEstimateAt: '2026-12-04T03:00:00.000Z' }, fmt)).toBe('Dự kiến chốt từ 2026-12-04 nếu không có đổi/trả');
    expect(commissionUnlockNote({ status: 'PENDING', unlockEstimateAt: '2026-12-04T03:00:00.000Z' }, fmt)).toBeNull();
    expect(commissionUnlockNote({ status: 'LOCKED', unlockEstimateAt: null }, fmt)).toBeNull();
    expect(commissionUnlockNote({ status: 'LOCKED' }, fmt)).toBeNull();
    expect(commissionUnlockNote({ status: 'LOCKED', unlockEstimateAt: 'không phải ngày' }, fmt)).toBeNull();
  });

  it('đơn khách vãng lai chưa thu tiền (PO A3): không hứa ngày, nói rõ chốt sau khi đơn thanh toán xong', () => {
    expect(commissionUnlockNote({ status: 'LOCKED', unlockEstimateAt: null, awaitingPayment: true }, fmt)).toBe(COMMISSION_AWAITING_PAYMENT_NOTE);
    expect(COMMISSION_AWAITING_PAYMENT_NOTE).toBe('Chốt sau khi đơn thanh toán xong');
    expect(COMMISSION_AWAITING_PAYMENT_NOTE.length).toBeLessThanOrEqual(40);
    expect(commissionUnlockNote({ status: 'PENDING', awaitingPayment: true }, fmt)).toBeNull();
    expect(commissionUnlockNote({ status: 'LOCKED', unlockEstimateAt: '2026-12-04T03:00:00.000Z', awaitingPayment: false }, fmt)).toBe('Dự kiến chốt từ 2026-12-04 nếu không có đổi/trả');
  });
});

describe('đích Chiến dịch và Bộ quà tặng', () => {
  const campaign = link({ targetType: 'CAMPAIGN', targetId: 'cmp_1', targetSlug: 'tet-xanh', targetLabel: 'Tết Xanh', targetAvailable: true });

  it('Chiến dịch: web /chien-dich/<slug>, Mini /campaign/<slug>, kèm ref và mã link', () => {
    expect(affiliateLinkPath(campaign, 'LINH123', 'web')).toBe('/chien-dich/tet-xanh?ref=LINH123&l=Ab3_-xY');
    expect(affiliateLinkPath(campaign, 'LINH123', 'miniapp')).toBe('/campaign/tet-xanh?ref=LINH123&l=Ab3_-xY');
    expect(affiliateLinkPath({ ...campaign, targetSlug: 'a b/c' }, 'LINH123', 'web')).toBe('/chien-dich/a%20b%2Fc?ref=LINH123&l=Ab3_-xY');
  });

  it('Bộ quà tặng: web /bo-qua-tang, Mini /gift-combos, không cần đích', () => {
    const combo = link({ targetType: 'COMBO' });
    expect(affiliateLinkPath(combo, 'LINH123', 'web')).toBe('/bo-qua-tang?ref=LINH123&l=Ab3_-xY');
    expect(affiliateLinkPath(combo, 'LINH123', 'miniapp')).toBe('/gift-combos?ref=LINH123&l=Ab3_-xY');
    expect(linkOpensTarget(combo)).toBe(true);
  });

  it('chiến dịch đã kết thúc hoặc thiếu slug: link mở Trang chủ và dòng phụ nói rõ', () => {
    const gone = { ...campaign, targetAvailable: false };
    expect(linkOpensTarget(gone)).toBe(false);
    expect(affiliateLinkPath(gone, 'LINH123', 'web')).toBe('/?ref=LINH123&l=Ab3_-xY');
    expect(affiliateLinkCaption({ ...gone, clicks: 2 })).toBe('2 lượt bấm · 0 đơn · Đích không còn, link mở Trang chủ');
    expect(linkOpensTarget({ ...campaign, targetSlug: ' ' })).toBe(false);
  });

  it('tên dòng link và ảnh QR đi cùng đường dẫn web của đích', () => {
    expect(affiliateLinkTitle(campaign)).toBe('Chiến dịch · Tết Xanh');
    expect(affiliateLinkTitle({ targetType: 'COMBO' })).toBe('Bộ quà tặng');
    expect(linkTargetNeedsPick('CAMPAIGN')).toBe(true);
    expect(linkTargetNeedsPick('COMBO')).toBe(false);
    expect(affiliateLinkPoster(campaign, 'LINH123')).toMatchObject({ kind: 'store', title: 'Chiến dịch · Tết Xanh', path: '/chien-dich/tet-xanh', referralCode: 'LINH123', linkCode: 'Ab3_-xY' });
    expect(affiliateLinkPoster(link({ targetType: 'COMBO' }), 'LINH123')).toMatchObject({ kind: 'store', title: 'Bộ quà tặng', path: '/bo-qua-tang' });
  });
});

describe('linkCategoryOptions', () => {
  it('phẳng theo thứ tự cây, con kèm tên cha, bỏ danh mục hết hàng nhưng vẫn xét con của nó', () => {
    const tree = [
      { id: 'a', name: 'Nhà bếp', productCount: 5, children: [{ id: 'a1', name: 'Rửa chén', productCount: 3 }, { id: 'a2', name: 'Lau sàn', productCount: 0 }] },
      { id: 'b', name: 'Cá nhân', productCount: 0, children: [{ id: 'b1', name: 'Gội đầu', productCount: 2 }] },
      { id: 'c', name: 'API cũ' },
      { id: 'a', name: 'Trùng id', productCount: 9 },
    ];
    expect(linkCategoryOptions(tree)).toEqual([
      { id: 'a', label: 'Nhà bếp' },
      { id: 'a1', label: 'Nhà bếp › Rửa chén' },
      { id: 'b1', label: 'Cá nhân › Gội đầu' },
      { id: 'c', label: 'API cũ' },
    ]);
    expect(linkCategoryOptions(undefined)).toEqual([]);
  });
});

describe('linkCampaignOptions', () => {
  const now = Date.parse('2026-12-01T03:00:00.000Z');
  const c = (id: string, title: string, startAt = '2026-11-20T00:00:00.000Z', endAt = '2026-12-20T00:00:00.000Z', linkType: 'CAMPAIGN_PAGE' | 'PRODUCT' | 'CATEGORY' | 'URL_INTERNAL' = 'CAMPAIGN_PAGE') => ({
    id,
    title,
    startAt,
    endAt,
    linkType,
  });

  it('gộp các vị trí, bỏ trùng id, giữ thứ tự, bỏ chiến dịch đã hết hoặc chưa tới giờ', () => {
    const home = [c('a', 'Tết Xanh'), c('old', 'Đã hết', '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')];
    const offers = [c('a', 'Tết Xanh'), c('b', 'Ưu đãi cuối năm'), c('soon', 'Sắp chạy', '2026-12-10T00:00:00.000Z')];
    expect(linkCampaignOptions([home, offers], now)).toEqual([
      { id: 'a', label: 'Tết Xanh' },
      { id: 'b', label: 'Ưu đãi cuối năm' },
    ]);
  });

  it('chỉ chiến dịch có trang riêng (CAMPAIGN_PAGE): banner trỏ sản phẩm, danh mục hay màn nội bộ không vào danh sách', () => {
    const home = [c('page', 'Có trang'), c('prod', 'Trỏ sản phẩm', undefined, undefined, 'PRODUCT'), c('cat', 'Trỏ danh mục', undefined, undefined, 'CATEGORY'), c('route', 'Trỏ màn', undefined, undefined, 'URL_INTERNAL')];
    expect(linkCampaignOptions([home], now)).toEqual([{ id: 'page', label: 'Có trang' }]);
  });

  it('danh sách chưa về hoặc rỗng: không có lựa chọn', () => {
    expect(linkCampaignOptions([undefined, []], now)).toEqual([]);
    expect(linkCampaignOptions([], now)).toEqual([]);
  });

  it('đúng lúc endAt là đã hết, đúng lúc startAt là đã chạy', () => {
    expect(linkCampaignOptions([[c('a', 'A', '2026-12-01T03:00:00.000Z', '2026-12-02T00:00:00.000Z')]], now)).toHaveLength(1);
    expect(linkCampaignOptions([[c('a', 'A', '2026-11-30T00:00:00.000Z', '2026-12-01T03:00:00.000Z')]], now)).toHaveLength(0);
  });
});

describe('chữ của bộ tạo link', () => {
  it('đủ 6 đích theo thứ tự API, không dùng thuật ngữ cấm', () => {
    expect(AFFILIATE_LINK_TARGETS.map((t) => t.key)).toEqual(['HOMEPAGE', 'PRODUCT', 'CATEGORY', 'DEAL', 'CAMPAIGN', 'COMBO']);
    const texts = [...AFFILIATE_LINK_TARGETS.map((t) => t.label), ...Object.values(LINK_BUILDER_COPY), ...Object.values(LINK_POSTER_COPY), CTV_FUNNEL_NOTE, COMMISSION_AWAITING_PAYMENT_NOTE];
    for (const text of texts) for (const { pattern } of FORBIDDEN_TERMS) expect(text).not.toMatch(pattern);
  });
});
