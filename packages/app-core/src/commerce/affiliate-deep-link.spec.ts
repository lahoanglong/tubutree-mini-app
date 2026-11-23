import { describe, expect, it } from 'vitest';
import { FORBIDDEN_TERMS } from '../shop-copy';
import {
  affiliateLinkCaption,
  affiliateLinkPath,
  affiliateLinkTitle,
  AFFILIATE_LINK_TARGETS,
  commissionUnlockNote,
  CTV_FUNNEL_NOTE,
  ctvFunnel,
  ctvFunnelLine,
  LINK_BUILDER_COPY,
  linkCategoryOptions,
  linkOpensTarget,
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

  it('dòng phụ chỉ nói lượt bấm, không hứa số đơn theo link', () => {
    expect(affiliateLinkCaption({ ...link(), clicks: 12 })).toBe('12 lượt bấm');
    expect(affiliateLinkCaption({ ...link({ targetType: 'PRODUCT', targetSlug: 'sp', targetAvailable: false }), clicks: 3 })).toBe(
      '3 lượt bấm · Đích không còn, link mở Trang chủ',
    );
    expect(affiliateLinkCaption({ ...link(), clicks: 12 })).not.toMatch(/đơn/);
  });
});

describe('ctvFunnel / ctvFunnelLine', () => {
  it('tỉ lệ = đơn / lượt bấm, một chữ số thập phân, dấu phẩy thập phân', () => {
    const f = ctvFunnel({ totalClicks: 340, totalConversions: 12 });
    expect(f).toEqual({ clicks: 340, orders: 12, ratePct: 3.5 });
    expect(ctvFunnelLine(f)).toBe('Tỉ lệ ra đơn 3,5% · 12 đơn / 340 lượt bấm');
    expect(ctvFunnelLine(ctvFunnel({ totalClicks: 4, totalConversions: 4 }))).toBe('Tỉ lệ ra đơn 100% · 4 đơn / 4 lượt bấm');
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

describe('chữ của bộ tạo link', () => {
  it('đủ 4 đích theo thứ tự API, không dùng thuật ngữ cấm', () => {
    expect(AFFILIATE_LINK_TARGETS.map((t) => t.key)).toEqual(['HOMEPAGE', 'PRODUCT', 'CATEGORY', 'DEAL']);
    const texts = [...AFFILIATE_LINK_TARGETS.map((t) => t.label), ...Object.values(LINK_BUILDER_COPY), CTV_FUNNEL_NOTE];
    for (const text of texts) for (const { pattern } of FORBIDDEN_TERMS) expect(text).not.toMatch(pattern);
  });
});
