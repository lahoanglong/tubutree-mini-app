import { describe, expect, it } from 'vitest';
import {
  absoluteKitLink,
  comboPctValue,
  questPercent,
  shareCaptions,
  shareFallbackText,
  statsRows,
  storefrontHost,
  storefrontShareUrl,
  withAbsoluteLink,
} from './storefront-rules';
import { DEFAULT_STOREFRONT_THEME_COLOR, STOREFRONT_THEME_COLORS } from './storefront-theme';

describe('màu chủ đề gian hàng', () => {
  it('mặc định là màu đầu bảng, khớp mặc định của API', () => {
    expect(DEFAULT_STOREFRONT_THEME_COLOR).toBe('#16a34a');
    expect(STOREFRONT_THEME_COLORS.map((c) => c.code)).toEqual(['#16a34a', '#0d9488', '#2563eb', '#7c3aed', '#ea580c']);
  });
});

describe('storefrontHost', () => {
  it('subdomain bật và có tên: dùng subdomain; ngược lại /s/<slug>', () => {
    expect(storefrontHost({ slug: 'a', subdomain: 'brand1', subdomainEnabled: true })).toBe('brand1.tubutree.com');
    expect(storefrontHost({ slug: 'a', subdomain: 'brand1', subdomainEnabled: false })).toBe('/s/a');
    expect(storefrontHost({ slug: 'a', subdomain: null, subdomainEnabled: true })).toBe('/s/a');
  });
});

describe('comboPctValue', () => {
  it('chỉ nhận số nguyên 0..100', () => {
    expect(comboPctValue('15')).toBe(15);
    expect(comboPctValue(' 0 ')).toBe(0);
    expect(comboPctValue('100')).toBe(100);
    expect(comboPctValue('101')).toBeNull();
    expect(comboPctValue('-1')).toBeNull();
    expect(comboPctValue('7.5')).toBeNull();
    expect(comboPctValue('')).toBeNull();
    expect(comboPctValue('abc')).toBeNull();
  });
});

describe('statsRows', () => {
  const p = (n: number, qty = 1, revenue = 1000) => ({ productSlug: `s${n}`, productName: `SP ${n}`, qty, revenue });
  it('top 5 sản phẩm, phần còn lại gộp một dòng, phần cấp đơn một dòng, bỏ dòng 0 món', () => {
    const rows = statsRows({
      orders7d: 0, orders30d: 0, revenue30d: 0, commission30d: 0,
      byProduct: [p(1), p(2), p(3), p(4), p(5), p(6, 2, 500), p(7, 1, 250), p(8, 0, 0)],
      shippingAndOrderDiscount30d: -20_000,
    });
    expect(rows.map((r) => r.name)).toEqual(['SP 1', 'SP 2', 'SP 3', 'SP 4', 'SP 5', '2 sản phẩm khác', 'Phí ship, giảm giá, chênh lệch hoàn tiền']);
    expect(rows[5]!.value).toBe('3 món · 750đ');
    expect(rows[6]!.value).toBe('-20.000đ');
  });
  it('phần cấp đơn bằng 0 hoặc API cũ không trả: không có dòng đó', () => {
    const base = { orders7d: 0, orders30d: 0, revenue30d: 0, commission30d: 0, byProduct: [p(1)] };
    expect(statsRows({ ...base, shippingAndOrderDiscount30d: 0 })).toHaveLength(1);
    expect(statsRows(base)).toHaveLength(1);
  });
});

describe('questPercent', () => {
  it('goal = 0 là đạt 100%, không chia cho 0; không vượt 100', () => {
    expect(questPercent({ goal: 0, progress: 0 })).toBe(100);
    expect(questPercent({ goal: 3, progress: 1 })).toBe(33);
    expect(questPercent({ goal: 3, progress: 9 })).toBe(100);
  });
});

describe('liên kết chia sẻ', () => {
  it('link gian hàng kèm mã giới thiệu của chủ', () => {
    expect(storefrontShareUrl('https://app.tubutree.com', 'shop', 'AN1')).toBe('https://app.tubutree.com/s/shop?ref=AN1');
    expect(storefrontShareUrl('https://app.tubutree.com', 'shop', null)).toBe('https://app.tubutree.com/s/shop');
  });
  it('bài mẫu luôn mang link', () => {
    const url = 'https://x/s/a?ref=B';
    const caps = shareCaptions(url);
    expect(caps).toHaveLength(3);
    for (const c of caps) expect(c).toContain(url);
  });
  it('đường dẫn Mini App của bộ nội dung thành link web đầy đủ', () => {
    expect(absoluteKitLink('https://app.tubutree.com', '/product/tra?ref=A')).toBe('https://app.tubutree.com/san-pham/tra?ref=A');
    expect(absoluteKitLink('https://app.tubutree.com', 'https://zalo.me/s/1/product/tra?ref=A')).toBe('https://zalo.me/s/1/product/tra?ref=A');
  });
  it('chỉ thay link tương đối đứng đầu từ, không chèn domain lần hai', () => {
    const rel = '/product/tra?ref=A';
    const abs = 'https://app.tubutree.com/san-pham/tra?ref=A';
    expect(withAbsoluteLink(`Xem ${rel} nhé`, rel, abs)).toBe(`Xem ${abs} nhé`);
    expect(withAbsoluteLink(`Xem https://app.tubutree.com${rel}`, rel, abs)).toBe(`Xem https://app.tubutree.com${rel}`);
    expect(withAbsoluteLink('abc', rel, rel)).toBe('abc');
  });
  it('bài mẫu thiếu mã giới thiệu thì chép kèm link', () => {
    expect(shareFallbackText('Xem đi', 'https://x?ref=A')).toBe('Xem đi https://x?ref=A');
    expect(shareFallbackText('Xem https://x?ref=A', 'https://x?ref=A')).toBe('Xem https://x?ref=A');
    expect(shareFallbackText(undefined, 'https://x?ref=A')).toBe('https://x?ref=A');
  });
});
