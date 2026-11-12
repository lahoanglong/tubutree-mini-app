import { findProductCopyFallback, listProductCopyFallbackSlugs } from '@tubutree/shared-types';
import { factLines, productFacts, promptShortDesc, variantSpecs } from './product-context';

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

describe('productFacts: bộ chặn tuyên bố cho chữ nguồn ngoài (DB)', () => {
  const SKU = 'san-pham-la-chua-co-trong-bang';
  const CLAIM_HTML =
    '<p>Nước rửa chén lên men từ vỏ dứa.</p><p>Diệt khuẩn 99% vi khuẩn gây hại.</p><p>Chữa viêm da tay hiệu quả.</p><p>Đạt chứng nhận USDA Organic.</p><p>Quy cách 500ml.</p>';

  it('mô tả HTML: bỏ thẻ và bỏ nguyên câu "diệt khuẩn 99%", "chữa viêm da", chứng nhận USDA; câu sạch còn nguyên', () => {
    const f = productFacts({ slug: SKU, description: CLAIM_HTML, ingredients: null });
    expect(f.description).toBe('Nước rửa chén lên men từ vỏ dứa. Quy cách 500ml.');
    expect(f.description).not.toMatch(/<|diệt khuẩn|viêm da|usda|99/i);
  });

  it('mô tả sạch thì giữ nguyên chữ', () => {
    const f = productFacts({ slug: SKU, description: '<p>Nước rửa chén lên men từ vỏ dứa.</p><p>Quy cách 500ml, dùng với nước ấm.</p>', ingredients: null });
    expect(f.description).toBe('Nước rửa chén lên men từ vỏ dứa. Quy cách 500ml, dùng với nước ấm.');
  });

  it('mô tả DB toàn câu cấm: coi như trống và rơi về chữ dự phòng đã duyệt (lọc DB trước, bù dự phòng sau)', () => {
    const f = productFacts({ slug: PINEBOO, description: '<p>Chữa viêm da cho bé.</p><p>Kháng khuẩn 99%.</p>', ingredients: null });
    expect(f.description).toContain('quy cách 150ml');
    expect(f.description).not.toMatch(/viêm da|kháng khuẩn/i);
  });

  it('mô tả DB toàn câu cấm và slug ngoài bảng dự phòng: không còn gì để nói, ghi rõ là chưa có', () => {
    const f = productFacts({ slug: SKU, description: 'Trị bệnh ngoài da. Chứng nhận ISO.', ingredients: null });
    expect(f).toEqual({ description: '', ingredients: [] });
  });

  it('lọc TRƯỚC khi cắt 400 ký tự: câu cấm dài đứng đầu không chiếm hết phần được giữ', () => {
    const banned = `Chữa viêm da ${'x'.repeat(380)}.`;
    const f = productFacts({ slug: SKU, description: `${banned} Quy cách 500ml.`, ingredients: null });
    expect(f.description).toBe('Quy cách 500ml.');
  });

  it('mô tả sạch quá dài vẫn bị cắt ở 400 ký tự sau khi lọc', () => {
    const f = productFacts({ slug: SKU, description: `Chữa bệnh. ${'Câu sạch thứ nhất. '.repeat(60)}`, ingredients: null });
    expect(f.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS + 1);
    expect(f.description.endsWith('…')).toBe(true);
    expect(f.description).not.toMatch(/chữa/i);
  });

  it('tên thành phần dính tuyên bố ("kháng khuẩn", "hữu cơ") bị bỏ, tên sạch còn lại', () => {
    const f = productFacts({ slug: SKU, description: '', ingredients: [{ name: 'Enzyme dứa' }, { name: 'Chiết xuất kháng khuẩn' }, { name: 'Dầu dừa hữu cơ' }, { name: 'Bột ngô' }] });
    expect(f.ingredients).toEqual(['Enzyme dứa', 'Bột ngô']);
  });

  it('thành phần dạng chuỗi cũng bị lọc từng tên', () => {
    const f = productFacts({ slug: SKU, description: '', ingredients: 'Dầu tràm, Chất kháng khuẩn, Dầu dừa' });
    expect(f.ingredients).toEqual(['Dầu tràm', 'Dầu dừa']);
  });

  it('lọc thành phần trước khi cắt còn 8 tên: tên sạch phía sau được lên thay chỗ tên bị bỏ', () => {
    const names = [{ name: 'Kháng khuẩn A' }, ...Array.from({ length: 9 }, (_, i) => ({ name: `tp${i}` }))];
    const f = productFacts({ slug: SKU, description: '', ingredients: names });
    expect(f.ingredients).toEqual(['tp0', 'tp1', 'tp2', 'tp3', 'tp4', 'tp5', 'tp6', 'tp7']);
  });

  it('thành phần DB toàn tên bị bỏ thì rơi về thành phần dự phòng đã duyệt', () => {
    const f = productFacts({ slug: PINEBOO, description: null, ingredients: [{ name: 'Kháng khuẩn tự nhiên 99%' }] });
    expect(f.ingredients).toEqual(['Eco-enzyme lên men từ vỏ dứa', 'Tràm']);
  });

  it('chữ dự phòng đã duyệt không bị bộ chặn lọc mất: cả 111 SKU ra đúng chữ trong bảng', () => {
    for (const slug of listProductCopyFallbackSlugs()) {
      const fb = findProductCopyFallback(slug)!;
      const f = productFacts({ slug, description: null, ingredients: null });
      expect(f.description).toBe(fb.description.replace(/\s+/g, ' ').trim());
      expect(f.ingredients).toEqual((fb.ingredients ?? []).map((i) => i.name).slice(0, 8));
    }
  });

  it('mô tả DB không lách được bộ chặn bằng NFD, NBSP, thẻ chèn giữa chữ, thực thể số hay ký tự rộng 0', () => {
    const bypass = [
      'Chữa bệnh viêm da.'.normalize('NFD'),
      'Chữa\u00a0bệnh\u00a0viêm da.',
      'Ch<i></i>ữa viêm da.',
      'Ch&#7919;a viêm da.',
      'Ch\u200bữa viêm da.',
      'Sạch 99&#37;.',
      'Sâm trị gàu, giảm bết dầu.',
      'Giảm gãy rụng cho tóc yếu.',
      'Nước uống sáng da.',
    ];
    for (const bad of bypass) {
      const f = productFacts({ slug: SKU, description: `Nước rửa chén lên men từ vỏ dứa. ${bad} Quy cách 500ml.`, ingredients: null });
      expect(f.description).toBe('Nước rửa chén lên men từ vỏ dứa. Quy cách 500ml.');
    }
  });

  it('mô tả mã hoá hai lần không bị giải mã lần hai sau bộ chặn: prompt không thể thấy chữ "ữ" mới sinh ra', () => {
    const f = productFacts({ slug: SKU, description: 'Rửa chén. Ch&amp;#7919;a bình.', ingredients: null });
    expect(f.description).toBe('Rửa chén. Ch&#7919;a bình.');
  });

  it('tên thành phần dính tuyên bố không lách được bằng NFD, NBSP, thực thể hay ký tự rộng 0', () => {
    const f = productFacts({
      slug: SKU,
      description: '',
      ingredients: [{ name: 'Chiết xuất kháng khuẩn'.normalize('NFD') }, { name: 'Chiết xuất kháng\u00a0khuẩn' }, { name: 'Chữa\u200b bệnh' }, { name: 'Ch&#7919;a bệnh' }, { name: 'Trị gàu' }, { name: 'Bột ngô' }],
    });
    expect(f.ingredients).toEqual(['Bột ngô']);
  });

  it('thành phần dạng chuỗi: thực thể có dấu ";" không bị tách làm đôi để qua mặt bộ chặn', () => {
    const f = productFacts({ slug: SKU, description: '', ingredients: 'Dầu tràm, Ch&#7919;a bệnh, Dầu dừa, Chữa bệnh'.normalize('NFD') });
    expect(f.ingredients).toEqual(['Dầu tràm', 'Dầu dừa']);
  });

  it('tên thành phần được chuẩn hoá: bỏ thẻ, đổi NBSP, về NFC', () => {
    const f = productFacts({ slug: SKU, description: '', ingredients: [{ name: '<b>Dầu&nbsp;dừa</b>' }, { name: 'Bột ngô'.normalize('NFD') }] });
    expect(f.ingredients).toEqual(['Dầu dừa', 'Bột ngô']);
    expect(f.ingredients[1]).toBe('Bột ngô'.normalize('NFC'));
  });

  it('chữ DB sạch của chủ hàng vẫn thắng chữ dự phòng sau khi qua bộ chặn', () => {
    const f = productFacts({ slug: PINEBOO, description: '<p>Bản của chủ hàng.</p><p>Diệt khuẩn 99%.</p>', ingredients: [{ name: 'Dầu tràm' }] });
    expect(f.description).toBe('Bản của chủ hàng.');
    expect(f.ingredients).toEqual(['Dầu tràm']);
  });
});

describe('promptShortDesc', () => {
  it('lọc câu y tế/chứng nhận ra khỏi mô tả ngắn đưa vào prompt, giữ câu sạch', () => {
    expect(promptShortDesc('Rửa chén lên men từ vỏ dứa. Diệt khuẩn 99%.')).toBe('Rửa chén lên men từ vỏ dứa.');
  });

  it('mô tả ngắn sạch giữ nguyên', () => {
    expect(promptShortDesc('Rửa chén lên men từ vỏ dứa')).toBe('Rửa chén lên men từ vỏ dứa');
  });

  it('mô tả ngắn không lách được bằng NFD, NBSP, thẻ, thực thể hay ký tự rộng 0', () => {
    for (const bad of ['Chữa bệnh viêm da.'.normalize('NFD'), 'Chữa\u00a0bệnh.', 'Ch<i></i>ữa viêm da.', 'Ch&#7919;a viêm da.', 'Ch\u200bữa viêm da.', 'Trị gàu, giảm bết dầu.']) {
      expect(promptShortDesc(`Rửa chén lên men từ vỏ dứa. ${bad}`)).toBe('Rửa chén lên men từ vỏ dứa.');
      expect(promptShortDesc(bad)).toBeNull();
    }
  });

  it.each([[null], [undefined], [''], ['   '], ['Chữa viêm da'], ['<p></p>']])('%p → null (không có gì để nói)', (v) => {
    expect(promptShortDesc(v)).toBeNull();
  });
});

describe('variantSpecs', () => {
  const v = (name: string | null, retailPrice: number, salePrice: number | null = null, id = name ?? 'x') => ({ id, sku: id, name, retailPrice, salePrice });

  it('mỗi dòng "tên quy cách — giá", rẻ trước, giá là giá đang bán nếu có', () => {
    expect(variantSpecs([v('Chai 3,8L', 250_000), v('Túi refill 500ml', 60_000, 45_000), v('Chai 500ml', 80_000)])).toEqual([
      'Túi refill 500ml — 45.000đ',
      'Chai 500ml — 80.000đ',
      'Chai 3,8L — 250.000đ',
    ]);
  });

  it('bỏ biến thể tên rỗng, toàn khoảng trắng, null hay "[object Object]"', () => {
    expect(variantSpecs([v('', 10_000, null, 'a'), v('   ', 20_000, null, 'b'), v(null, 30_000, null, 'c'), v('[object Object]', 40_000, null, 'd'), v('Chai 1L', 50_000, null, 'e')])).toEqual(['Chai 1L — 50.000đ']);
  });

  it('tối đa 6 dòng, giữ 6 biến thể rẻ nhất', () => {
    const many = Array.from({ length: 9 }, (_, i) => v(`Loại ${i}`, 10_000 * (i + 1), null, `id${i}`));
    const lines = variantSpecs(many);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe('Loại 0 — 10.000đ');
    expect(lines[5]).toBe('Loại 5 — 60.000đ');
  });

  it('không có biến thể (mock cũ, null) → không dòng nào', () => {
    expect(variantSpecs(undefined)).toEqual([]);
    expect(variantSpecs(null)).toEqual([]);
    expect(variantSpecs([])).toEqual([]);
  });

  it('tên bị bỏ thẻ HTML và cắt gọn, không lộ thẻ vào prompt', () => {
    const [line] = variantSpecs([v('<b>Chai 500ml</b>', 10_000)]);
    expect(line).toBe('Chai 500ml — 10.000đ');
  });
});
