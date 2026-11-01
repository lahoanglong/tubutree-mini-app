import { describe, expect, it } from 'vitest';
import type { CampaignBanner, CampaignCouponDTO } from '../api/campaign';
import type { HomeKindState } from '../home-layout';
import { liveRoute } from '../merch/route-fallback';
import {
  CAMPAIGN_INTERNAL_TARGETS,
  CAMPAIGN_PRODUCTS_PAGE,
  CAMPAIGN_SLIDES_MAX,
  campaignDateRange,
  campaignHref,
  campaignProductPages,
  campaignSlides,
  campaignVisible,
  campaignVoucherViews,
} from './campaign';

const NOW = Date.parse('2026-11-05T05:00:00Z');
const banner = (over: Partial<CampaignBanner> = {}): CampaignBanner => ({
  id: 'c1',
  slug: 'giua-thu',
  title: 'Giữa Thu',
  image: 'https://cdn.example.com/a.jpg',
  linkType: 'CAMPAIGN_PAGE',
  linkValue: null,
  audience: 'ALL',
  startAt: '2026-11-01T00:00:00.000Z',
  endAt: '2026-11-11T16:59:59.000Z',
  ...over,
});

describe('campaignVisible — đối tượng', () => {
  const kinds: HomeKindState[] = ['new', 'returning', 'unknown'];
  const expected: Record<string, Record<HomeKindState, boolean>> = {
    ALL: { new: true, returning: true, unknown: true },
    NEW: { new: true, returning: false, unknown: false },
    RETURNING: { new: false, returning: true, unknown: false },
  };
  for (const audience of ['ALL', 'NEW', 'RETURNING'] as const) {
    for (const kind of kinds) {
      it(`${audience} với khách ${kind} → ${expected[audience]![kind]}`, () => {
        expect(campaignVisible({ ...banner(), audience }, { kind })).toBe(expected[audience]![kind]);
      });
    }
  }
});

describe('campaignVisible — lịch', () => {
  const c = banner();
  const at = (iso: string) => Date.parse(iso);
  it('đúng lúc startAt là hiện, đúng lúc endAt là ẩn', () => {
    expect(campaignVisible(c, { kind: 'new', now: at(c.startAt) })).toBe(true);
    expect(campaignVisible(c, { kind: 'new', now: at(c.startAt) - 1 })).toBe(false);
    expect(campaignVisible(c, { kind: 'new', now: at(c.endAt) - 1 })).toBe(true);
    expect(campaignVisible(c, { kind: 'new', now: at(c.endAt) })).toBe(false);
  });
  it('thiếu now thì bỏ qua lịch (web trước khi hydrate không biết giờ máy khách)', () => {
    expect(campaignVisible({ ...c, endAt: '2020-01-01T00:00:00.000Z' }, { kind: 'new' })).toBe(true);
  });
});

describe('campaignHref', () => {
  it('trang chiến dịch theo nền', () => {
    expect(campaignHref(banner(), 'mini')).toBe('/campaign/giua-thu');
    expect(campaignHref(banner(), 'web')).toBe('/chien-dich/giua-thu');
  });
  it('sản phẩm và danh mục theo slug', () => {
    expect(campaignHref(banner({ linkType: 'PRODUCT', linkValue: 'tra-sen' }), 'mini')).toBe('/product/tra-sen');
    expect(campaignHref(banner({ linkType: 'PRODUCT', linkValue: 'tra-sen' }), 'web')).toBe('/san-pham/tra-sen');
    expect(campaignHref(banner({ linkType: 'CATEGORY', linkValue: 'nha-bep' }), 'mini')).toBe('/browse?category=nha-bep');
    expect(campaignHref(banner({ linkType: 'CATEGORY', linkValue: 'nha-bep' }), 'web')).toBe('/san-pham?category=nha-bep');
  });
  it('sản phẩm/danh mục thiếu hoặc sai dạng slug → null (slide bị bỏ, không dẫn tới trang chết)', () => {
    for (const linkType of ['PRODUCT', 'CATEGORY'] as const) {
      for (const linkValue of [null, '', 'a b', '../x', '/x', 'https://x']) {
        expect(campaignHref(banner({ linkType, linkValue }), 'mini'), `${linkType} ${String(linkValue)}`).toBeNull();
      }
    }
  });
  it('URL_INTERNAL chỉ nhận đích trong danh sách, ra route đúng nền', () => {
    expect(campaignHref(banner({ linkType: 'URL_INTERNAL', linkValue: '/offers' }), 'mini')).toBe('/offers');
    expect(campaignHref(banner({ linkType: 'URL_INTERNAL', linkValue: '/offers' }), 'web')).toBe('/uu-dai');
    expect(campaignHref(banner({ linkType: 'URL_INTERNAL', linkValue: '/group-buy' }), 'web')).toBe('/mua-chung');
    expect(campaignHref(banner({ linkType: 'URL_INTERNAL', linkValue: '/rewards' }), 'web')).toBe('/kho-qua');
    expect(campaignHref(banner({ linkType: 'URL_INTERNAL', linkValue: '/browse' }), 'web')).toBe('/san-pham');
  });
  it('URL_INTERNAL đang chờ trang của gói khác đi theo liveRoute (hết chờ thì tự đổi)', () => {
    for (const platform of ['mini', 'web'] as const) {
      expect(campaignHref(banner({ linkType: 'URL_INTERNAL', linkValue: '/flash-sale' }), platform)).toBe(liveRoute('/flash-sale', platform));
    }
  });
  it('URL_INTERNAL lạ, //host, https và rỗng → null', () => {
    for (const linkValue of ['/khong-co', '//evil.com', 'https://x.com', 'javascript:alert(1)', '', null]) {
      expect(campaignHref(banner({ linkType: 'URL_INTERNAL', linkValue }), 'mini'), String(linkValue)).toBeNull();
    }
  });
  it('mọi đích trong danh sách ra đường dẫn bắt đầu bằng / trên cả hai nền', () => {
    for (const t of CAMPAIGN_INTERNAL_TARGETS) {
      for (const platform of ['mini', 'web'] as const) {
        expect(campaignHref(banner({ linkType: 'URL_INTERNAL', linkValue: t.value }), platform)).toMatch(/^\/[a-z]/);
      }
    }
  });
});

describe('campaignSlides', () => {
  const opts = { kind: 'new' as const, platform: 'mini' as const, now: NOW };
  it('tên slide là tiêu đề chiến dịch, giữ thứ tự API', () => {
    const slides = campaignSlides([banner({ id: 'a', slug: 'a', title: 'A' }), banner({ id: 'b', slug: 'b', title: 'B' })], opts);
    expect(slides).toEqual([
      { id: 'a', image: 'https://cdn.example.com/a.jpg', alt: 'A', href: '/campaign/a' },
      { id: 'b', image: 'https://cdn.example.com/a.jpg', alt: 'B', href: '/campaign/b' },
    ]);
  });
  it('lọc đối tượng, lịch và slide không có đích', () => {
    const slides = campaignSlides(
      [
        banner({ id: 'ok' }),
        banner({ id: 'ret', audience: 'RETURNING' }),
        banner({ id: 'old', endAt: '2026-11-05T05:00:00.000Z' }),
        banner({ id: 'bad', linkType: 'PRODUCT', linkValue: null }),
      ],
      opts,
    );
    expect(slides.map((s) => s.id)).toEqual(['ok']);
  });
  it('tối đa 5 slide; thiếu danh sách → rỗng', () => {
    const many = Array.from({ length: 8 }, (_, i) => banner({ id: `c${i}`, slug: `c${i}` }));
    expect(CAMPAIGN_SLIDES_MAX).toBe(5);
    expect(campaignSlides(many, opts)).toHaveLength(5);
    expect(campaignSlides(null, opts)).toEqual([]);
    expect(campaignSlides(undefined, opts)).toEqual([]);
  });
  it('platform web ra đường dẫn web', () => {
    expect(campaignSlides([banner()], { ...opts, platform: 'web' })[0]?.href).toBe('/chien-dich/giua-thu');
  });
});

describe('campaignDateRange', () => {
  it('đọc ngày theo giờ Việt Nam: 17:30 UTC ngày 10/11 là 11/11', () => {
    expect(campaignDateRange({ startAt: '2026-10-31T17:00:00.000Z', endAt: '2026-11-10T17:30:00.000Z' })).toBe('Từ 01/11 đến 11/11');
  });
  it('mốc không đọc được thì để trống thay vì chữ "NaN"', () => {
    expect(campaignDateRange({ startAt: 'x', endAt: '2026-11-10T00:00:00.000Z' })).toBe('');
  });
});

describe('campaignVoucherViews', () => {
  const coupon = (code: string, endAt: string): CampaignCouponDTO => ({ code, type: 'PERCENT', value: 10, minOrder: 100_000, maxDiscount: null, endAt });
  it('sắp hết hạn đứng trước, trạng thái là saved (mã công khai dùng ngay)', () => {
    const views = campaignVoucherViews([coupon('LATE', '2026-12-01T00:00:00.000Z'), coupon('SOON', '2026-11-06T00:00:00.000Z')], NOW);
    expect(views.map((v) => v.code)).toEqual(['SOON', 'LATE']);
    expect(views.every((v) => v.state === 'saved')).toBe(true);
  });
  it('trang sản phẩm 20 món mỗi lần', () => {
    expect(CAMPAIGN_PRODUCTS_PAGE).toBe(20);
  });
});

describe('campaignProductPages', () => {
  const card = (id: string) => ({ id, slug: id, brand: 'Tubu', name: id, thumbnail: null, basePrice: 1, salePrice: null, isFeatured: false, inStock: true });
  const page = (ids: string[], p: number, total: number) => ({ data: ids.map(card), meta: { page: p, limit: 2, total } });
  it('gộp các trang đã tải theo thứ tự, bỏ sản phẩm lặp giữa hai trang', () => {
    const v = campaignProductPages([page(['a', 'b'], 1, 5), page(['b', 'c'], 2, 5)]);
    expect(v.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
  it('còn trang kế khi trang cuối đã tải chưa phủ hết tổng; hết thì không', () => {
    expect(campaignProductPages([page(['a', 'b'], 1, 3)]).hasMore).toBe(true);
    expect(campaignProductPages([page(['a', 'b'], 1, 3), page(['c'], 2, 3)]).hasMore).toBe(false);
    expect(campaignProductPages([page(['a', 'b'], 1, 2)]).hasMore).toBe(false);
  });
  it('trang chưa về (undefined) bị bỏ qua; chưa có trang nào thì rỗng và không còn gì để xem thêm', () => {
    expect(campaignProductPages([page(['a', 'b'], 1, 5), undefined]).items).toHaveLength(2);
    expect(campaignProductPages([undefined])).toEqual({ items: [], hasMore: false });
    expect(campaignProductPages([])).toEqual({ items: [], hasMore: false });
  });
});
