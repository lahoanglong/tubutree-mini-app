import { MSS_DOC_LIMITS, parseMssProductDoc, payloadSha256 } from './mss-catalog-doc';

const HOST = 'mss.example.test';
const ctx = { mediaHosts: [HOST] };
const img = (h: string) => `https://${HOST}/api/pub/media/${h}.webp`;

/** Đúng ví dụ tài liệu sản phẩm của hợp đồng commerce v0.9 mục 1.2 (URL media thay bằng host thử). */
function contractExample(): Record<string, unknown> {
  return {
    pancake_product_id: 'a1b2c3',
    mss_product_id: 'cmw123',
    state: 'published',
    published_version: 7,
    published_at: '2026-11-16T10:02:11+07:00',
    updated_at: '2026-11-16T10:02:11+07:00',
    source: {
      name: 'Nước giặt sinh học Fuwa3e',
      synced_at: '2026-11-16T09:45:00+07:00',
      variations: [{ pancake_variation_id: 'v1', sku: 'FW-NG-2L', attributes: { 'Dung tích': '2L' }, retail_price: 195000, sale_price: null, stock: 14, weight_g: 2100, hidden: false, removed: false }],
    },
    enrichment: {
      title: 'Nước giặt sinh học Fuwa3e hương bồ hòn',
      short_desc: 'Giặt sạch, an toàn cho da.',
      description_html: '<p>Đoạn <strong>một</strong>.</p><ul><li>Ý A</li></ul>',
      images: [{ url: img('9f00aa11e2'), alt: 'Chai 2L', w: 1600, h: 1600, variation_id: null }],
      videos: [{ url: `https://${HOST}/api/pub/media/77aa00bbcc.mp4`, poster_url: null, duration_s: 42 }],
      ingredients: [{ name: 'Enzyme dứa', note: 'Lên men từ vỏ dứa' }],
      story: { title: 'Câu chuyện', blocks: [{ type: 'text', html: '<p>…</p>' }] },
      certifications: ['Không thử trên động vật'],
      seo: { slug: 'nuoc-giat-sinh-hoc-fuwa3e', meta_title: 'Nước giặt Fuwa3e', meta_desc: 'Mô tả SEO' },
      category_slugs: ['tay-rua-sinh-hoc'],
      tags: ['x'],
      attributes: { mui_huong: 'Bồ hòn' },
      related_product_ids: ['z'],
    },
    quality: { score: 82, missing: ['video', 'story'] },
  };
}

function parse(raw: unknown, preview = false) {
  const r = parseMssProductDoc(raw, { ...ctx, preview });
  if (!r.ok) throw new Error(`không phân tích được: ${r.reason}`);
  return r.doc;
}

describe('parseMssProductDoc: tài liệu sản phẩm MSS (hợp đồng v0.9 mục 1.2)', () => {
  it('ví dụ của hợp đồng phân tích được, đủ trường bổ sung', () => {
    const d = parse(contractExample());
    expect(d).toMatchObject({ pancakeProductId: 'a1b2c3', mssProductId: 'cmw123', state: 'published', version: 7 });
    expect(d.updatedAt.toISOString()).toBe('2026-11-16T03:02:11.000Z');
    expect(d.payload).toEqual({
      v: 1,
      title: 'Nước giặt sinh học Fuwa3e hương bồ hòn',
      shortDesc: 'Giặt sạch, an toàn cho da.',
      descriptionHtml: '<p>Đoạn <strong>một</strong>.</p><ul><li>Ý A</li></ul>',
      images: [{ url: img('9f00aa11e2'), alt: 'Chai 2L', w: 1600, h: 1600, variationId: null }],
      videos: [{ url: `https://${HOST}/api/pub/media/77aa00bbcc.mp4`, posterUrl: null, durationS: 42 }],
      ingredients: [{ name: 'Enzyme dứa', note: 'Lên men từ vỏ dứa' }],
      certifications: ['Không thử trên động vật'],
      metaTitle: 'Nước giặt Fuwa3e',
      metaDesc: 'Mô tả SEO',
      categoryIds: null,
    });
    expect(d.categorySlugs).toEqual(['tay-rua-sinh-hoc']);
    expect(d.issues).toEqual({});
  });

  it('không đọc `source` (giá, tồn vẫn theo Pancake): payload không có số nào của source', () => {
    const d = parse(contractExample());
    expect(JSON.stringify(d.payload)).not.toMatch(/195000|FW-NG-2L|stock/);
  });

  it('trường null hoặc thiếu = không có ý kiến (null), Tubu giữ giá trị của mình', () => {
    const raw = contractExample();
    raw.enrichment = { title: null, short_desc: null, images: null };
    expect(parse(raw).payload).toEqual({
      v: 1,
      title: null,
      shortDesc: null,
      descriptionHtml: null,
      images: null,
      videos: null,
      ingredients: null,
      certifications: null,
      metaTitle: null,
      metaDesc: null,
      categoryIds: null,
    });
    raw.enrichment = null;
    expect(parse(raw).payload.images).toBeNull();
  });

  it('mảng rỗng = cố ý để trống; chuỗi rỗng ở trường không bắt buộc = cố ý để trống; tên rỗng = không có ý kiến', () => {
    const raw = contractExample();
    raw.enrichment = { title: '  ', short_desc: '', description_html: '', images: [], videos: [], ingredients: [], certifications: [], seo: { meta_title: '', meta_desc: '' }, category_slugs: [] };
    const d = parse(raw);
    expect(d.payload).toMatchObject({ title: null, shortDesc: '', descriptionHtml: '', images: [], videos: [], ingredients: [], certifications: [], metaTitle: '', metaDesc: '' });
    expect(d.categorySlugs).toEqual([]);
  });

  it('description_html: script, style, on*, javascript:, iframe bị bỏ; thẻ cho phép giữ, không thuộc tính nào sống sót', () => {
    const raw = contractExample();
    (raw.enrichment as Record<string, unknown>).description_html =
      '<p onclick="x()">A<script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">link</a></p><iframe src="https://evil"></iframe><style>p{}</style><h1>T</h1>';
    const html = parse(raw).payload.descriptionHtml!;
    expect(html).toBe('<p>Alink</p><h2>T</h2>');
    expect(html).not.toMatch(/script|onerror|onclick|javascript:|iframe|style|<img|<a/i);
  });

  it('description_html chỉ toàn nội dung bị bỏ: không có ý kiến (giữ mô tả Tubu) và đếm', () => {
    const raw = contractExample();
    (raw.enrichment as Record<string, unknown>).description_html = '<script>alert(1)</script>';
    const d = parse(raw);
    expect(d.payload.descriptionHtml).toBeNull();
    expect(d.issues.html_emptied).toBe(1);
  });

  it('URL ảnh/video ngoài host cho phép, không https, sai đường media bị loại và đếm; còn lại giữ', () => {
    const raw = contractExample();
    (raw.enrichment as Record<string, unknown>).images = [
      { url: 'https://evil.test/api/pub/media/abcdef1234.webp' },
      { url: `http://${HOST}/api/pub/media/abcdef1234.webp` },
      { url: `https://${HOST}/etc/passwd` },
      { url: `https://${HOST}/api/pub/media/abcdef1234.webp?token=abcdefghijklmnopqrst` },
      { url: img('ok000000001') },
    ];
    const d = parse(raw);
    expect(d.payload.images!.map((i) => i.url)).toEqual([img('ok000000001')]);
    expect(d.issues.media_rejected).toBe(4);
  });

  it('mọi ảnh đều bị loại: không có ý kiến (không xoá ảnh Tubu)', () => {
    const raw = contractExample();
    (raw.enrichment as Record<string, unknown>).images = [{ url: 'https://evil.test/api/pub/media/abcdef1234.webp' }];
    expect(parse(raw).payload.images).toBeNull();
  });

  it('bản xem trước nhận URL media có ?token=, bản thường thì không', () => {
    const raw = contractExample();
    raw.state = 'preview';
    const tokenUrl = `https://${HOST}/api/pub/catalog-media/abcdef1234.webp?token=abcdefghijklmnopqrst`;
    (raw.enrichment as Record<string, unknown>).images = [{ url: tokenUrl }];
    expect(parse(raw, true).payload.images![0]!.url).toBe(tokenUrl);
    expect(parseMssProductDoc(raw, ctx)).toEqual({ ok: false, reason: 'invalid_doc' });
    expect(parseMssProductDoc(contractExample(), { ...ctx, preview: true })).toEqual({ ok: false, reason: 'invalid_doc' });
  });

  it('chuỗi và mảng quá dài bị cắt theo trần và đếm', () => {
    const raw = contractExample();
    const e = raw.enrichment as Record<string, unknown>;
    e.title = 'x'.repeat(MSS_DOC_LIMITS.title + 50);
    e.certifications = Array.from({ length: MSS_DOC_LIMITS.certifications + 3 }, (_, i) => `c${i}`);
    e.description_html = `<p>${'y'.repeat(MSS_DOC_LIMITS.descriptionHtml)}</p>`;
    const d = parse(raw);
    expect(d.payload.title).toHaveLength(MSS_DOC_LIMITS.title);
    expect(d.payload.certifications).toHaveLength(MSS_DOC_LIMITS.certifications);
    expect(d.payload.descriptionHtml!.length).toBeLessThanOrEqual(MSS_DOC_LIMITS.descriptionHtml);
    expect(d.payload.descriptionHtml!.endsWith('</p>')).toBe(true);
    expect(d.issues).toMatchObject({ string_truncated: 1, array_truncated: 1 });
  });

  it.each([
    ['title là số', (e: Record<string, unknown>) => (e.title = 123)],
    ['images không phải mảng', (e: Record<string, unknown>) => (e.images = 'x')],
    ['phần tử ảnh không phải object', (e: Record<string, unknown>) => (e.images = ['x'])],
    ['variation_id sai dạng', (e: Record<string, unknown>) => (e.images = [{ url: img('abcdef1234'), variation_id: '../x' }])],
    ['seo không phải object', (e: Record<string, unknown>) => (e.seo = 'x')],
    ['category_slugs có phần tử số', (e: Record<string, unknown>) => (e.category_slugs = [1])],
    ['description_html là mảng', (e: Record<string, unknown>) => (e.description_html = ['x'])],
  ])('lược đồ chặt: %s → bỏ cả tài liệu', (_label, mutate) => {
    const raw = contractExample();
    mutate(raw.enrichment as Record<string, unknown>);
    expect(parseMssProductDoc(raw, ctx)).toEqual({ ok: false, reason: 'invalid_doc' });
  });

  it.each([
    ['không phải object', 'x'],
    ['state lạ', { ...contractExample(), state: 'draft' }],
    ['updated_at không có múi giờ', { ...contractExample(), updated_at: '2026-11-16 10:02:11' }],
    ['published_version âm', { ...contractExample(), published_version: -1 }],
    ['pancake_product_id có ký tự lạ', { ...contractExample(), pancake_product_id: 'a/../b' }],
  ])('tài liệu hỏng: %s', (_label, raw) => {
    expect(parseMssProductDoc(raw, ctx)).toEqual({ ok: false, reason: 'invalid_doc' });
  });

  it('combo không có mã Pancake: bỏ qua với lý do riêng', () => {
    expect(parseMssProductDoc({ ...contractExample(), pancake_product_id: null }, ctx)).toEqual({ ok: false, reason: 'no_pancake_id' });
  });

  it('unpublished/removed vẫn phân tích được (để chặn bản cũ đến muộn); chưa từng xuất bản thì phiên bản 0', () => {
    expect(parse({ ...contractExample(), state: 'unpublished', published_version: null }).version).toBe(0);
    expect(parse({ ...contractExample(), state: 'removed' }).state).toBe('removed');
  });

  it('slug danh mục chuẩn hoá chữ thường, bỏ trùng, bỏ slug sai dạng', () => {
    const raw = contractExample();
    (raw.enrichment as Record<string, unknown>).category_slugs = ['Tay-Rua', 'tay-rua', 'bad slug', ''];
    expect(parse(raw).categorySlugs).toEqual(['tay-rua']);
  });

  it('băm ổn định: cùng nội dung cùng băm, đổi trạng thái thì khác', () => {
    const d = parse(contractExample());
    expect(payloadSha256('published', d.payload)).toBe(payloadSha256('published', parse(contractExample()).payload));
    expect(payloadSha256('unpublished', d.payload)).not.toBe(payloadSha256('published', d.payload));
  });
});
