import { describe, expect, it } from 'vitest';
import { productFaqItems } from './product-faq';

describe('productFaqItems — hỏi đáp có sẵn trong mô tả sản phẩm (FAQPage)', () => {
  it('tiêu đề kết thúc bằng "?" là câu hỏi; các khối sau nó tới tiêu đề kế là câu trả lời', () => {
    const html = '<p>Mở đầu.</p><h3>Bé mấy tháng dùng được?</h3><p>Từ 6 tháng.</p><ul><li>Thử trên da tay trước.</li></ul><h3>Bảo quản</h3><p>Nơi khô ráo.</p>';
    expect(productFaqItems(html)).toEqual([{ q: 'Bé mấy tháng dùng được?', a: 'Từ 6 tháng.\n• Thử trên da tay trước.' }]);
  });

  it('đoạn in đậm trọn vẹn kết thúc bằng "?" cũng là câu hỏi (kiểu WordPress <p><strong>…?</strong></p>)', () => {
    const html = '<p><strong>Có mùi không?</strong></p><p>Mùi sả nhẹ.</p><p><b>Dùng bao lâu?</b></p><p>Khoảng 2 tháng.</p>';
    expect(productFaqItems(html)).toEqual([
      { q: 'Có mùi không?', a: 'Mùi sả nhẹ.' },
      { q: 'Dùng bao lâu?', a: 'Khoảng 2 tháng.' },
    ]);
  });

  it('không có câu hỏi, câu hỏi không có trả lời, hay chỉ có chữ đậm một phần: không có mục nào', () => {
    expect(productFaqItems('<h3>Hướng dẫn sử dụng</h3><p>Thoa đều.</p>')).toEqual([]);
    expect(productFaqItems('<h3>Có an toàn không?</h3>')).toEqual([]);
    expect(productFaqItems('<h3>Có an toàn không?</h3><h3>Dùng thế nào?</h3><p>Pha loãng.</p>')).toEqual([{ q: 'Dùng thế nào?', a: 'Pha loãng.' }]);
    expect(productFaqItems('<p><strong>Lưu ý:</strong> bạn có hỏi gì không?</p><p>x</p>')).toEqual([]);
    expect(productFaqItems('')).toEqual([]);
    expect(productFaqItems(null)).toEqual([]);
  });

  it('câu hỏi trùng chỉ lấy lần đầu; tối đa 10 mục; chữ thường không thẻ không có tiêu đề nên không có mục', () => {
    const many = Array.from({ length: 14 }, (_, i) => `<h4>Câu ${i}?</h4><p>Đáp ${i}.</p>`).join('');
    expect(productFaqItems(many)).toHaveLength(10);
    expect(productFaqItems('<h3>A?</h3><p>1</p><h3>A?</h3><p>2</p>')).toEqual([{ q: 'A?', a: '1' }]);
    expect(productFaqItems('Chỉ là chữ thường?\n\nKhông có thẻ.')).toEqual([]);
  });

  it('dấu hỏi toàn khổ và khoảng trắng cuối vẫn nhận; chữ trong JSON là chữ thường (không còn thẻ)', () => {
    expect(productFaqItems('<h2>  Giao hàng mất mấy ngày？ </h2><p><em>2–4</em> ngày làm việc.</p>')).toEqual([{ q: 'Giao hàng mất mấy ngày？', a: '2–4 ngày làm việc.' }]);
  });
});
