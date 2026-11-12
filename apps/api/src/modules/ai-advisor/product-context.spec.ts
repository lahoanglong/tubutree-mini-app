import { listProductCopyFallbackSlugs } from '@tubutree/shared-types';
import { factLines, productFacts } from './product-context';

const PINEBOO = 'xit-tram-cho-be-pineboo-150ml';
const MAX_DESCRIPTION_CHARS = 400;

describe('productFacts: chữ dự phòng từ @tubutree/shared-types', () => {
  it('mô tả null trong DB vẫn nhận quy cách và cách dùng từ bảng dự phòng', () => {
    const f = productFacts({ slug: PINEBOO, description: null, ingredients: null });
    expect(f.description).toContain('quy cách 150ml');
    expect(f.description).toContain('bình xịt');
    expect(f.description).toContain('Bao bì ghi');
    expect(f.ingredients).toEqual(['Eco-enzyme lên men từ vỏ dứa', 'Tràm']);
  });

  it('slug có hậu tố băm Pancake vẫn khớp slug gốc', () => {
    const f = productFacts({ slug: `${PINEBOO}-1a2b3c4d`, description: '', ingredients: [] });
    expect(f.description).toContain('quy cách 150ml');
  });

  it('mô tả HTML trống (`<p></p>`, `&nbsp;`) tính là thiếu', () => {
    const f = productFacts({ slug: PINEBOO, description: '<p>&nbsp;</p><br/>', ingredients: [] });
    expect(f.description).toContain('quy cách 150ml');
  });

  it('mô tả trong DB thắng, chỉ bù thành phần còn thiếu (từng trường độc lập)', () => {
    const f = productFacts({ slug: PINEBOO, description: '<p>Mô tả của chủ hàng.</p>', ingredients: [] });
    expect(f.description).toBe('Mô tả của chủ hàng.');
    expect(f.ingredients).toEqual(['Eco-enzyme lên men từ vỏ dứa', 'Tràm']);
  });

  it('thành phần trong DB thắng, chỉ bù mô tả còn thiếu', () => {
    const f = productFacts({ slug: PINEBOO, description: null, ingredients: [{ name: 'Dầu dừa' }] });
    expect(f.ingredients).toEqual(['Dầu dừa']);
    expect(f.description).toContain('quy cách 150ml');
  });

  it('slug ngoài bảng: không bịa gì, vẫn ghi rõ là chưa có', () => {
    const f = productFacts({ slug: 'san-pham-la-chua-co-trong-bang', description: null, ingredients: null });
    expect(f).toEqual({ description: '', ingredients: [] });
    expect(factLines(f)).toEqual(['  (chưa có mô tả hay thành phần chi tiết)']);
  });

  it('cột Json ingredients là đối tượng lạ hay số thì không ném lỗi và vẫn bù được', () => {
    expect(() => productFacts({ slug: PINEBOO, description: null, ingredients: { a: 1 } })).not.toThrow();
    expect(productFacts({ slug: PINEBOO, description: null, ingredients: 42 }).description).toContain('quy cách 150ml');
    expect(productFacts({ slug: PINEBOO, description: null, ingredients: [null, 7, { name: '[object Object]' }] }).ingredients).toEqual(['Eco-enzyme lên men từ vỏ dứa', 'Tràm']);
  });

  it('dòng bù không chứa lời chữa bệnh, diệt khuẩn kèm %, chứng nhận (luật trung thực của prompt)', () => {
    const text = factLines(productFacts({ slug: PINEBOO, description: null, ingredients: null })).join('\n').toLowerCase();
    expect(text).not.toMatch(/chữa|điều trị|phòng bệnh|diệt khuẩn|kháng khuẩn|chứng nhận|\d+\s*%/);
  });

  describe('toàn bộ bảng dự phòng', () => {
    const slugs = listProductCopyFallbackSlugs();

    it('phủ 111 SKU PROD', () => {
      expect(slugs).toHaveLength(111);
    });

    it('mô tả bù của mọi SKU nằm gọn trong trần 400 ký tự, không bị cắt mất quy cách ở cuối', () => {
      for (const slug of slugs) {
        const { description } = productFacts({ slug, description: null, ingredients: null });
        expect(description).not.toBe('');
        expect(description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
        expect(description.endsWith('…')).toBe(false);
      }
    });

    it('không SKU nào để mô tả bù lọt thẻ HTML', () => {
      for (const slug of slugs) {
        expect(productFacts({ slug, description: null, ingredients: null }).description).not.toMatch(/<[^>]*>|&nbsp;/);
      }
    });
  });
});
