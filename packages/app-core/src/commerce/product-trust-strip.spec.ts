import { describe, expect, it } from 'vitest';
import { LEGAL_PAGES } from '../legal';
import { returnsPromise } from '../returns-copy';
import { productTrustStrip } from './product-trust-strip';

const TUBU = { fulfillerKind: 'TUBU', returnWindowDays: 7 };

describe('productTrustStrip: hàng Tubu giao', () => {
  it('ba trụ cột đúng thứ tự, chữ ngắn của đề', () => {
    const v = productTrustStrip(TUBU)!;
    expect(v.pillars.map((p) => [p.key, p.title, p.sub])).toEqual([
      ['origin', 'Nguồn gốc rõ ràng', 'Chọn lọc kỹ từng thương hiệu'],
      ['delivery', 'Giao hàng cẩn thận', 'Đóng gói kỹ trước khi giao'],
      ['returns', 'Đổi trả dễ dàng', 'Hỗ trợ nhanh nếu sản phẩm lỗi'],
    ]);
    expect(v.groupAria).toBe('Cam kết của Tubu Tree khi mua sản phẩm này');
  });

  it('lối xem chính sách mở Chính sách đổi trả, tên truy cập nói rõ đích đến', () => {
    const { cta } = productTrustStrip(TUBU)!;
    expect(cta).toEqual({ slug: 'doi-tra', label: 'Xem chính sách đổi trả', ariaLabel: 'Xem chính sách đổi trả của Tubu Tree' });
    expect(cta.label.toLowerCase()).toContain(LEGAL_PAGES['doi-tra'].title.toLowerCase());
  });

  it('chưa biết ai giao (API cũ) vẫn có dải, như khối Cam kết Tubu ở cuối trang', () => {
    expect(productTrustStrip({ fulfillerKind: undefined, returnWindowDays: 7 })?.pillars).toHaveLength(3);
    expect(productTrustStrip({ fulfillerKind: null, returnWindowDays: 7 })?.pillars).toHaveLength(3);
  });

  it('số ngày đổi trả chưa biết (đang tải, API cũ, giá trị hỏng) vẫn giữ trụ đổi trả: không hứa số nào', () => {
    for (const bad of [undefined, null, NaN, -1, '7']) {
      expect(productTrustStrip({ fulfillerKind: 'TUBU', returnWindowDays: bad })?.pillars.map((p) => p.key), String(bad)).toEqual(['origin', 'delivery', 'returns']);
    }
  });
});

describe('productTrustStrip: không hứa điều không làm được', () => {
  it('hàng gian hàng tự giao hoặc gian hàng tạm nghỉ không có dải', () => {
    expect(productTrustStrip({ fulfillerKind: 'MERCHANT', returnWindowDays: 7 })).toBeNull();
    expect(productTrustStrip({ fulfillerKind: 'UNAVAILABLE', returnWindowDays: 7 })).toBeNull();
  });

  it('đổi trả tắt (0 ngày) thì bỏ trụ đổi trả và lối xem chính sách chuyển sang vận chuyển', () => {
    const v = productTrustStrip({ fulfillerKind: 'TUBU', returnWindowDays: 0 })!;
    expect(v.pillars.map((p) => p.key)).toEqual(['origin', 'delivery']);
    expect(v.cta).toEqual({ slug: 'van-chuyen', label: 'Xem chính sách vận chuyển', ariaLabel: 'Xem chính sách vận chuyển của Tubu Tree' });
    expect(returnsPromise(0)).toBeNull();
  });

  it('không có chữ cần giấy tờ hay giờ giao: hữu cơ, chứng nhận, đúng hẹn, chuẩn mát, trong ngày', () => {
    const v = productTrustStrip(TUBU)!;
    const text = [v.groupAria, v.cta.label, v.cta.ariaLabel, ...v.pillars.flatMap((p) => [p.title, p.sub])].join(' | ');
    expect(text).not.toMatch(/hữu cơ|organic|vietgap|chứng nhận|đúng hẹn|chuẩn mát|trong ngày|\d+ ?(giờ|phút)|nhanh chóng|100%/i);
  });
});
