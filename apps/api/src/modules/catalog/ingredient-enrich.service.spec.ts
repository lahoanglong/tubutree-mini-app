import { BadRequestException, ConflictException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { IngredientOcrService } from '../ai-advisor/ingredient-ocr.service';
import { COPY_INGREDIENTS_MAX } from '../ai-advisor/copy-draft';
import { IngredientEnrichService, ENRICH_MSG } from './ingredient-enrich.service';

const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 7, 7, 7, 7]).toString('base64')}`;

const product = (over: Record<string, unknown> = {}) => ({ id: 'p1', name: 'Sữa hạt óc chó', storefrontId: null, ingredients: null, ...over });

function make(row: unknown, ocrReply: { readable: boolean; ingredients: string[] } | Error = { readable: true, ingredients: ['Đường', 'Muối'] }) {
  const findUnique = jest.fn(async () => row);
  const update = jest.fn(async () => ({ id: 'p1' }));
  const prisma = { product: { findUnique, update } } as unknown as PrismaService;
  const read = jest.fn(async () => {
    if (ocrReply instanceof Error) throw ocrReply;
    return ocrReply;
  });
  const ocr = { read } as unknown as IngredientOcrService;
  return { svc: new IngredientEnrichService(prisma, ocr), findUnique, update, read };
}

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
});
afterEach(() => jest.restoreAllMocks());

describe('IngredientEnrichService.extract', () => {
  it('ảnh sai định dạng hoặc quá lớn: 400 với lý do, không đọc DB, không gọi AI', async () => {
    const { svc, findUnique, read } = make(product());
    const err = await svc.extract('p1', 'https://evil.example/a.png').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe('Ảnh chỉ nhận JPEG, PNG hoặc WebP.');
    expect(findUnique).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('sản phẩm không có: 404; sản phẩm của đối tác: 409; cả hai không gọi AI', async () => {
    const missing = make(null);
    await expect(missing.svc.extract('p1', JPEG)).rejects.toBeInstanceOf(NotFoundException);
    const partner = make(product({ storefrontId: 'shop1' }));
    const err = await partner.svc.extract('p1', JPEG).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(ENRICH_MSG.partner);
    expect(missing.read).not.toHaveBeenCalled();
    expect(partner.read).not.toHaveBeenCalled();
  });

  it('đọc được: trả bản nháp, không ghi DB; gọi AI với ảnh đã tách base64 và tên sản phẩm lấy từ DB', async () => {
    const { svc, update, read } = make(product());
    await expect(svc.extract('p1', JPEG)).resolves.toEqual({ id: 'p1', readable: true, ingredients: ['Đường', 'Muối'], warnings: [] });
    expect(update).not.toHaveBeenCalled();
    const [image, name] = read.mock.calls[0] as unknown as [{ mediaType: string; base64: string }, string];
    expect(image.mediaType).toBe('image/jpeg');
    expect(image.base64.startsWith('data:')).toBe(false);
    expect(name).toBe('Sữa hạt óc chó');
  });

  it('ảnh mờ / không có mục Thành phần: readable=false kèm câu hướng dẫn, không ném lỗi', async () => {
    const { svc } = make(product(), { readable: false, ingredients: [] });
    await expect(svc.extract('p1', JPEG)).resolves.toEqual({ id: 'p1', readable: false, ingredients: [], warnings: [ENRICH_MSG.unreadable] });
  });

  it('bản nháp có tên bộ chặn sẽ từ chối lúc lưu: vẫn trả đủ tên (để admin sửa) kèm cảnh báo nêu tên đó', async () => {
    const { svc } = make(product(), { readable: true, ingredients: ['Bơ tươi', 'Chữa nứt nẻ môi'] });
    const res = await svc.extract('p1', JPEG);
    expect(res.ingredients).toEqual(['Bơ tươi', 'Chữa nứt nẻ môi']);
    expect(res.warnings.join(' ')).toContain('Chữa nứt nẻ môi');
  });

  it(`nhãn có hơn ${COPY_INGREDIENTS_MAX} thành phần: trả đủ và cảnh báo trần ${COPY_INGREDIENTS_MAX}`, async () => {
    const names = Array.from({ length: COPY_INGREDIENTS_MAX + 2 }, (_, i) => `Thành phần ${i}`);
    const { svc } = make(product(), { readable: true, ingredients: names });
    const res = await svc.extract('p1', JPEG);
    expect(res.ingredients).toHaveLength(COPY_INGREDIENTS_MAX + 2);
    expect(res.warnings.join(' ')).toContain(`Tối đa ${COPY_INGREDIENTS_MAX} thành phần`);
  });

  it('AI lỗi hoặc chưa có khoá: 503 của IngredientOcrService đi thẳng ra ngoài', async () => {
    const { svc } = make(product(), new ServiceUnavailableException('Chưa cấu hình AI'));
    await expect(svc.extract('p1', JPEG)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('IngredientEnrichService.save', () => {
  it('sản phẩm không có: 404; của đối tác: 409; không ghi', async () => {
    const missing = make(null);
    await expect(missing.svc.save('admin1', 'p1', ['Đường'])).rejects.toBeInstanceOf(NotFoundException);
    const partner = make(product({ storefrontId: 'shop1' }));
    await expect(partner.svc.save('admin1', 'p1', ['Đường'])).rejects.toBeInstanceOf(ConflictException);
    expect(missing.update).not.toHaveBeenCalled();
    expect(partner.update).not.toHaveBeenCalled();
  });

  it('danh sách rỗng, quá trần hoặc có tuyên bố bị chặn: 400 nêu lý do, không ghi', async () => {
    const empty = make(product());
    const e1 = await empty.svc.save('admin1', 'p1', ['  ', '']).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(BadRequestException);
    expect((e1 as BadRequestException).message).toBe('Chưa có thành phần nào.');

    const blocked = make(product());
    const e2 = await blocked.svc.save('admin1', 'p1', ['Bơ tươi', 'Chữa nứt nẻ môi']).catch((e: unknown) => e);
    expect(e2).toBeInstanceOf(BadRequestException);
    expect((e2 as BadRequestException).message).toContain('Chữa nứt nẻ môi');

    const many = make(product());
    await expect(many.svc.save('admin1', 'p1', Array.from({ length: COPY_INGREDIENTS_MAX + 1 }, (_, i) => `T${i}`))).rejects.toBeInstanceOf(BadRequestException);
    for (const m of [empty, blocked, many]) expect(m.update).not.toHaveBeenCalled();
  });

  it('sản phẩm chưa có thành phần: ghi [{name}] đã chuẩn hoá, trả tên đã lưu và số tên thêm', async () => {
    const { svc, update } = make(product());
    await expect(svc.save('admin1', 'p1', ['  Đường   cát ', 'muối', 'đường CÁT'])).resolves.toEqual({ id: 'p1', ingredients: ['Đường cát', 'muối'], added: 2 });
    expect(update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { ingredients: [{ name: 'Đường cát' }, { name: 'muối' }] }, select: { id: true } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('admin1'));
  });

  it('giữ nguyên dòng đã có (percentage, benefit) và chỉ nối tên mới, không phân biệt dấu/hoa thường', async () => {
    const current = [{ name: 'Enzyme dứa lên men', percentage: '15%', benefit: 'Phân giải vết bẩn' }];
    const { svc, update } = make(product({ ingredients: current }));
    const res = await svc.save('admin1', 'p1', ['enzyme dua len men', 'Tinh dầu sả']);
    expect(res).toEqual({ id: 'p1', ingredients: ['Enzyme dứa lên men', 'Tinh dầu sả'], added: 1 });
    expect((update.mock.calls[0] as unknown as [{ data: { ingredients: unknown } }])[0].data.ingredients).toEqual([...current, { name: 'Tinh dầu sả' }]);
  });

  it('mọi tên đã có sẵn: không ghi DB, added = 0', async () => {
    const { svc, update } = make(product({ ingredients: [{ name: 'Đường' }] }));
    await expect(svc.save('admin1', 'p1', ['đường'])).resolves.toEqual({ id: 'p1', ingredients: ['Đường'], added: 0 });
    expect(update).not.toHaveBeenCalled();
  });
});
