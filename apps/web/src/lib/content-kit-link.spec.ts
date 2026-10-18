import { describe, expect, it } from 'vitest';
import { absoluteLink, shareFallbackText, withAbsoluteLink } from './content-kit-link';

const ORIGIN = 'https://tubutree.com';

describe('link trong bộ nội dung bán hàng', () => {
  it('đường dẫn tương đối của Mini App thành link trang sản phẩm web đầy đủ', () => {
    expect(absoluteLink('/product/dau-goi?ref=ABC', ORIGIN)).toBe('https://tubutree.com/san-pham/dau-goi?ref=ABC');
    expect(absoluteLink('/san-pham/dau-goi?ref=ABC', ORIGIN)).toBe('https://tubutree.com/san-pham/dau-goi?ref=ABC');
  });
  it('link tuyệt đối giữ nguyên', () => {
    expect(absoluteLink('https://zalo.me/s/123/product/x?ref=A', ORIGIN)).toBe('https://zalo.me/s/123/product/x?ref=A');
  });
  it('chỉ thay link đứng đầu từ, không chèn domain lần hai vào link tuyệt đối admin gõ sẵn', () => {
    const rel = '/product/x?ref=A';
    const abs = absoluteLink(rel, ORIGIN);
    expect(withAbsoluteLink(`Mua ngay ${rel} nhé`, rel, abs)).toBe(`Mua ngay ${abs} nhé`);
    const typed = `https://app.tubutree.com/product/x?ref=A`;
    expect(withAbsoluteLink(`Xem ${typed}`, rel, abs)).toBe(`Xem ${typed}`);
    expect(withAbsoluteLink('abc', rel, rel)).toBe('abc');
  });
  it('bài mẫu thiếu mã giới thiệu thì nối link vào để CTV không mất hoa hồng', () => {
    expect(shareFallbackText('Hay lắm', 'https://x/y?ref=A')).toBe('Hay lắm https://x/y?ref=A');
    expect(shareFallbackText('Hay lắm https://x/y?ref=A', 'https://x/y?ref=A')).toBe('Hay lắm https://x/y?ref=A');
    expect(shareFallbackText(undefined, 'https://x/y?ref=A')).toBe('https://x/y?ref=A');
  });
});
