import { describe, it, expect } from 'vitest';
import { withReferral } from './share-link';

describe('withReferral — gắn mã giới thiệu của người chia sẻ vào đường dẫn', () => {
  it('đường dẫn trần → thêm ?ref=', () => {
    expect(withReferral('/san-pham/a', 'ABCD1234')).toBe('/san-pham/a?ref=ABCD1234');
  });

  it('đã có query khác → nối bằng &', () => {
    expect(withReferral('/san-pham/a?variant=v1', 'ABCD1234')).toBe('/san-pham/a?variant=v1&ref=ABCD1234');
  });

  it('link web tuyệt đối cũng gắn được', () => {
    expect(withReferral('https://tubutree.com/san-pham/a', 'ABCD1234')).toBe('https://tubutree.com/san-pham/a?ref=ABCD1234');
  });

  it('đã có ref (vd link gian hàng CTV) → giữ nguyên, không ghi đè mã của người khác', () => {
    expect(withReferral('/s/lan?ref=LAN1', 'ABCD1234')).toBe('/s/lan?ref=LAN1');
    expect(withReferral('/p?x=1&ref=LAN1', 'ABCD1234')).toBe('/p?x=1&ref=LAN1');
  });

  it('không nhầm khoá khác có đuôi ref', () => {
    expect(withReferral('/p?xref=1', 'ABCD1234')).toBe('/p?xref=1&ref=ABCD1234');
  });

  it('giữ nguyên fragment', () => {
    expect(withReferral('/p#top', 'ABCD1234')).toBe('/p?ref=ABCD1234#top');
  });

  it.each([[null], [undefined], [''], ['a b'], ['x'.repeat(65)], ['<script>'], ['a&b=c']])(
    'không có mã dùng được (%j) → đường dẫn nguyên vẹn',
    (code) => {
      expect(withReferral('/san-pham/a', code)).toBe('/san-pham/a');
    },
  );
});
