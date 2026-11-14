import { BadRequestException } from '@nestjs/common';
import { claimsIn } from '@tubutree/shared-types';
import type { PrismaService } from '../../prisma/prisma.service';
import { SEO_DESC_MAX, SEO_TITLE_MAX, SeoEnrichService, buildMetaDesc, buildMetaTitle, draftSeo, type SeoProductInput } from './seo-enrich.service';

const product = (over: Partial<SeoProductInput> = {}): SeoProductInput => ({
  name: 'Dầu gội bồ kết',
  brand: 'Xanh Việt',
  shortDesc: 'Dầu gội nấu từ bồ kết, dùng hằng ngày.',
  description: '',
  metaTitle: null,
  metaDesc: null,
  variations: [{ name: '250ml', isActive: true }],
  ...over,
});

describe('buildMetaTitle', () => {
  it('dạng "<Tên SP> | <Thương hiệu>"', () => {
    expect(buildMetaTitle(product())).toBe('Dầu gội bồ kết | Xanh Việt');
  });

  it('thương hiệu rỗng, null hay chính là Tubu Tree (không phân biệt hoa thường) thì hậu tố là "Tubu Tree"', () => {
    expect(buildMetaTitle(product({ brand: null }))).toBe('Dầu gội bồ kết | Tubu Tree');
    expect(buildMetaTitle(product({ brand: '   ' }))).toBe('Dầu gội bồ kết | Tubu Tree');
    expect(buildMetaTitle(product({ brand: 'TUBU TREE' }))).toBe('Dầu gội bồ kết | Tubu Tree');
  });

  it(`tên dài: cắt theo ranh giới từ, giữ hậu tố thương hiệu, tổng không quá ${SEO_TITLE_MAX} ký tự`, () => {
    const name = 'Nước rửa chén sinh học enzyme vỏ dứa hương sả chanh can lớn tiết kiệm cho cả gia đình';
    const title = buildMetaTitle(product({ name }));
    expect(title.length).toBeLessThanOrEqual(SEO_TITLE_MAX);
    expect(title.endsWith(' | Xanh Việt')).toBe(true);
    const head = title.slice(0, -' | Xanh Việt'.length);
    expect(name.startsWith(head)).toBe(true);
    expect(name[head.length]).toBe(' ');
  });

  it('một từ dài vô tận vẫn không vượt trần', () => {
    const title = buildMetaTitle(product({ name: 'A'.repeat(200) }));
    expect(title.length).toBeLessThanOrEqual(SEO_TITLE_MAX);
    expect(title.endsWith(' | Xanh Việt')).toBe(true);
  });

  it('thương hiệu quá dài: hạ về "Tubu Tree" để tên sản phẩm còn chỗ', () => {
    const title = buildMetaTitle(product({ brand: 'Công ty trách nhiệm hữu hạn thương mại dịch vụ xanh bền vững Việt Nam' }));
    expect(title).toBe('Dầu gội bồ kết | Tubu Tree');
  });

  it('bỏ thẻ HTML và khoảng trắng thừa trong tên', () => {
    expect(buildMetaTitle(product({ name: '  Dầu <b>gội</b> bồ   kết ' }))).toBe('Dầu gội bồ kết | Xanh Việt');
  });
});

describe('buildMetaDesc', () => {
  it(`ghép tên, thương hiệu, phân loại, câu đầu mô tả; không quá ${SEO_DESC_MAX} ký tự`, () => {
    const desc = buildMetaDesc(product({ variations: [{ name: '250ml', isActive: true }, { name: '500ml', isActive: true }] }));
    expect(desc).toContain('Dầu gội bồ kết');
    expect(desc).toContain('Xanh Việt');
    expect(desc).toContain('250ml');
    expect(desc).toContain('500ml');
    expect(desc).toContain('Dầu gội nấu từ bồ kết, dùng hằng ngày.');
    expect(desc.length).toBeLessThanOrEqual(SEO_DESC_MAX);
  });

  it('phân loại: bỏ biến thể đã tắt, tên "[object Object]", tên rỗng, trùng, và tên trùng tên sản phẩm', () => {
    const desc = buildMetaDesc(
      product({
        shortDesc: null,
        variations: [
          { name: '[object Object]', isActive: true },
          { name: '', isActive: true },
          { name: '250ml', isActive: true },
          { name: '250ML', isActive: true },
          { name: '1 lít', isActive: false },
          { name: 'Dầu gội bồ kết', isActive: true },
          { name: { x: 1 }, isActive: true },
        ],
      }),
    );
    expect(desc).not.toContain('[object Object]');
    expect(desc).toContain('250ml');
    expect(desc).not.toContain('1 lít');
    expect(desc.match(/250ml/gi)).toHaveLength(1);
  });

  it('shortDesc rỗng thì lấy câu đầu của description, đã lọc HTML và thực thể', () => {
    const desc = buildMetaDesc(product({ shortDesc: '  ', description: '<p>Sạch dịu nhẹ &amp; thơm mùi bồ kết.</p><p>Câu hai không dùng.</p>' }));
    expect(desc).toContain('Sạch dịu nhẹ & thơm mùi bồ kết.');
    expect(desc).not.toContain('<');
    expect(desc).not.toContain('Câu hai');
  });

  it('mô tả dài vô tận: cắt gọn tại ranh giới từ, không vượt trần', () => {
    const long = `${'Sản phẩm rất tuyệt vời cho gia đình bạn '.repeat(20)}.`;
    const desc = buildMetaDesc(product({ shortDesc: long }));
    expect(desc.length).toBeLessThanOrEqual(SEO_DESC_MAX);
    expect(desc.startsWith('Dầu gội bồ kết')).toBe(true);
  });

  it('không chép tuyên bố y tế, hữu cơ, thiên nhiên từ mô tả: câu vi phạm bị bỏ, dùng câu sạch kế tiếp', () => {
    const desc = buildMetaDesc(
      product({
        name: 'Dầu gội bồ kết',
        brand: 'Xanh Việt',
        shortDesc: 'Chữa gàu hiệu quả. Chứng nhận hữu cơ. Làm từ thiên nhiên. Mùi thơm dễ chịu.',
      }),
    );
    expect(desc).toContain('Mùi thơm dễ chịu.');
    expect(claimsIn(desc)).toEqual([]);
  });

  it('mọi câu mô tả đều vi phạm: vẫn có mô tả hợp lệ dựng từ tên và thương hiệu, không tuyên bố nào', () => {
    const desc = buildMetaDesc(product({ shortDesc: 'Chữa bệnh. Hữu cơ 100%.', variations: [] }));
    expect(desc.length).toBeGreaterThan(20);
    expect(claimsIn(desc)).toEqual([]);
    expect(desc).toContain('Dầu gội bồ kết');
  });

  it('chỉ chữ có trong nguồn hoặc khung cố định: dữ liệu trơn không sinh từ khoá tuyên bố nào', () => {
    const desc = buildMetaDesc(product({ shortDesc: null, description: '' }));
    expect(claimsIn(desc)).toEqual([]);
    expect(desc).toMatch(/Tubu Tree/);
  });

  it('tên có chữ "hữu cơ" thật của sản phẩm vẫn được giữ nguyên (nguồn thật)', () => {
    const desc = buildMetaDesc(product({ name: 'Gạo hữu cơ ST25', shortDesc: null }));
    expect(desc).toContain('Gạo hữu cơ ST25');
  });

  it('tên đã có sẵn thương hiệu thì không lặp lại thương hiệu', () => {
    const desc = buildMetaDesc(product({ name: 'Xanh Việt dầu gội bồ kết', brand: 'Xanh Việt', shortDesc: null }));
    expect(desc.match(/Xanh Việt/g)).toHaveLength(1);
  });
});

describe('draftSeo', () => {
  it('onlyMissing: false sinh lại cả hai trường', () => {
    const d = draftSeo(product({ metaTitle: 'Tay sửa', metaDesc: 'Tay sửa nốt' }), { onlyMissing: false });
    expect(d.metaTitle).toBe('Dầu gội bồ kết | Xanh Việt');
    expect(d.metaDesc).toContain('Dầu gội bồ kết');
  });

  it('onlyMissing: true giữ nguyên trường người đã sửa tay, chỉ điền trường còn trống', () => {
    const onlyTitle = draftSeo(product({ metaTitle: 'Tiêu đề tay', metaDesc: null }), { onlyMissing: true });
    expect(onlyTitle.metaTitle).toBe('Tiêu đề tay');
    expect(onlyTitle.metaDesc).toContain('Dầu gội bồ kết');

    const onlyDesc = draftSeo(product({ metaTitle: '   ', metaDesc: 'Mô tả tay' }), { onlyMissing: true });
    expect(onlyDesc.metaTitle).toBe('Dầu gội bồ kết | Xanh Việt');
    expect(onlyDesc.metaDesc).toBe('Mô tả tay');
  });

  it('onlyMissing: true với cả hai trường đã có: không đổi gì', () => {
    const d = draftSeo(product({ metaTitle: 'A', metaDesc: 'B' }), { onlyMissing: true });
    expect(d).toEqual({ metaTitle: 'A', metaDesc: 'B' });
  });
});

type Row = { id: string; slug: string; name: string; brand: string; shortDesc: string | null; description: string; metaTitle: string | null; metaDesc: string | null; storefrontId: string | null; variations: Array<{ name: string; isActive: boolean }> };
const row = (id: string, over: Partial<Row> = {}): Row => ({ id, slug: `sp-${id}`, name: `Sản phẩm ${id}`, brand: 'Tubu Tree', shortDesc: null, description: '', metaTitle: null, metaDesc: null, storefrontId: null, variations: [], ...over });

function harness(rows: Row[]) {
  const updateMany = jest.fn(async (_args: unknown) => ({ count: 1 }));
  const findMany = jest.fn(async (args?: { where?: { id?: { in: string[] } } }) => {
    const ids = args?.where?.id?.in;
    return ids ? rows.filter((r) => ids.includes(r.id)) : rows;
  });
  const $transaction = jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops));
  const prisma = { product: { findMany, updateMany }, $transaction } as unknown as PrismaService;
  return { service: new SeoEnrichService(prisma), findMany, updateMany, $transaction };
}

describe('SeoEnrichService.list', () => {
  it('chỉ đọc sản phẩm nhà đang bán; trả hiện trạng, độ dài, cờ và bản đề xuất', async () => {
    const h = harness([
      row('a'),
      row('b', { metaTitle: 'Có tiêu đề', metaDesc: 'x'.repeat(SEO_DESC_MAX + 5) }),
      row('c', { metaTitle: 'T'.repeat(SEO_TITLE_MAX + 1), metaDesc: 'Đủ mô tả' }),
    ]);
    const res = await h.service.list();
    expect(h.findMany.mock.calls[0]![0]).toMatchObject({ where: { storefrontId: null, isActive: true } });
    expect(res.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    const [a, b, c] = res.rows;
    expect(a).toMatchObject({ missingTitle: true, missingDesc: true, titleLength: 0, descLength: 0, tooLongTitle: false, tooLongDesc: false });
    expect(a!.suggested.metaTitle).toBe('Sản phẩm a | Tubu Tree');
    expect(b).toMatchObject({ missingTitle: false, missingDesc: false, tooLongDesc: true, descLength: SEO_DESC_MAX + 5 });
    expect(c).toMatchObject({ tooLongTitle: true, titleLength: SEO_TITLE_MAX + 1 });
    expect(res.missing).toBe(1);
    expect(res.total).toBe(3);
  });

  it('chuỗi chỉ có khoảng trắng tính là thiếu', async () => {
    const h = harness([row('a', { metaTitle: '  ', metaDesc: '\n' })]);
    const res = await h.service.list();
    expect(res.rows[0]).toMatchObject({ missingTitle: true, missingDesc: true });
  });
});

describe('SeoEnrichService.apply', () => {
  const ok = (id: string, over: object = {}) => ({ productId: id, metaTitle: `Sản phẩm ${id} | Tubu Tree`, metaDesc: `Mô tả sản phẩm ${id} tại Tubu Tree.`, ...over });

  it('ghi cả lô trong MỘT giao dịch và trả số dòng cập nhật', async () => {
    const h = harness([row('a'), row('b')]);
    const res = await h.service.apply('admin1', [ok('a'), ok('b')]);
    expect(h.$transaction).toHaveBeenCalledTimes(1);
    expect(h.updateMany).toHaveBeenCalledTimes(2);
    expect(h.updateMany.mock.calls[0]![0]).toMatchObject({ where: { id: 'a', storefrontId: null }, data: { metaTitle: 'Sản phẩm a | Tubu Tree', metaDesc: 'Mô tả sản phẩm a tại Tubu Tree.' } });
    expect(res).toEqual({ updated: 2, skippedIds: [] });
  });

  it('chuỗi rỗng hoặc chỉ khoảng trắng: 400, không ghi gì', async () => {
    const h = harness([row('a'), row('b')]);
    await expect(h.service.apply('admin1', [ok('a'), ok('b', { metaTitle: '   ' })])).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.apply('admin1', [ok('a', { metaDesc: '' })])).rejects.toBeInstanceOf(BadRequestException);
    expect(h.$transaction).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it('vượt trần độ dài: 400 nêu rõ trần, không ghi gì', async () => {
    const h = harness([row('a')]);
    await expect(h.service.apply('admin1', [ok('a', { metaTitle: 'T'.repeat(SEO_TITLE_MAX + 1) })])).rejects.toThrow(String(SEO_TITLE_MAX));
    await expect(h.service.apply('admin1', [ok('a', { metaDesc: 'D'.repeat(SEO_DESC_MAX + 1) })])).rejects.toThrow(String(SEO_DESC_MAX));
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it('đúng trần thì qua', async () => {
    const h = harness([row('a')]);
    const res = await h.service.apply('admin1', [ok('a', { metaTitle: 'T'.repeat(SEO_TITLE_MAX), metaDesc: 'D'.repeat(SEO_DESC_MAX) })]);
    expect(res.updated).toBe(1);
  });

  it('thẻ HTML hoặc "[object Object]": 400', async () => {
    const h = harness([row('a')]);
    await expect(h.service.apply('admin1', [ok('a', { metaDesc: 'Mô tả <b>đậm</b>' })])).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.apply('admin1', [ok('a', { metaTitle: '[object Object] | Tubu Tree' })])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tuyên bố y tế/hữu cơ không có trong tên sản phẩm: 400; chữ thuộc về tên thật thì qua', async () => {
    const h = harness([row('a', { name: 'Gạo hữu cơ ST25' }), row('b')]);
    await expect(h.service.apply('admin1', [ok('b', { metaDesc: 'Chữa bệnh hiệu quả tại Tubu Tree.' })])).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.apply('admin1', [ok('b', { metaTitle: 'Sản phẩm b hữu cơ | Tubu Tree' })])).rejects.toBeInstanceOf(BadRequestException);
    const res = await h.service.apply('admin1', [ok('a', { metaTitle: 'Gạo hữu cơ ST25 | Tubu Tree', metaDesc: 'Gạo hữu cơ ST25 bán tại Tubu Tree.' })]);
    expect(res.updated).toBe(1);
  });

  it('sản phẩm đối tác hoặc không tồn tại: bỏ qua, nằm trong skippedIds, không chặn mục khác', async () => {
    const h = harness([row('a'), row('p', { storefrontId: 'sf1' })]);
    const res = await h.service.apply('admin1', [ok('a'), ok('p'), ok('ghost')]);
    expect(res.updated).toBe(1);
    expect(res.skippedIds.sort()).toEqual(['ghost', 'p']);
    expect(h.updateMany).toHaveBeenCalledTimes(1);
  });
});
