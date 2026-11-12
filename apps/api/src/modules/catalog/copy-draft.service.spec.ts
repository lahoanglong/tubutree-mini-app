import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CopyAiService } from '../ai-advisor/copy-ai.service';
import type { CopyDraftInput, CopyDraftOutcome } from '../ai-advisor/copy-draft';
import { CopyDraftService } from './copy-draft.service';
import { VARIATION_ORDER_BY } from './variation-order';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  slug: 'son-duong-bo-tuoi-po-lang-a08',
  name: 'Son dưỡng bơ tươi Pơ Lang A08',
  brand: 'Pơ Lang',
  shortDesc: 'Ngắn',
  description: 'Mô tả cũ',
  ingredients: [{ name: 'Bơ tươi' }, { name: '' }, { name: '[object Object]' }],
  categoryIds: ['c1', 'c2'],
  storefrontId: null,
  variations: [{ name: '4g' }, { name: '[object Object]' }, { name: '  ' }, { name: '8g' }],
  ...over,
});

const okDraft = (id: string): CopyDraftOutcome => ({
  id,
  draft: { id, slug: `s-${id}`, name: `Tên ${id}`, shortDesc: 'n', description: 'd', ingredients: [], source: 'ai', warnings: [] },
});

function make(rows: unknown[], draftBatch?: (inputs: readonly CopyDraftInput[]) => Promise<CopyDraftOutcome[]>) {
  const findMany = jest.fn(async () => rows);
  const categoryFindMany = jest.fn(async () => [
    { id: 'c1', name: 'Chăm sóc cá nhân' },
    { id: 'c2', name: 'Son môi' },
  ]);
  const batch = jest.fn(draftBatch ?? (async (inputs: readonly CopyDraftInput[]) => inputs.map((i) => okDraft(i.id))));
  const prisma = { product: { findMany }, category: { findMany: categoryFindMany } } as unknown as PrismaService;
  const svc = new CopyDraftService(prisma, { draftBatch: batch } as unknown as CopyAiService);
  return { svc, findMany, categoryFindMany, batch };
}

describe('CopyDraftService.generate', () => {
  it('lấy dữ liệu từ DB theo id (không nhận chữ từ máy khách), bỏ tên phân loại hỏng và thành phần trống, đổi mã danh mục thành tên', async () => {
    const { svc, findMany, categoryFindMany, batch } = make([row()]);
    await svc.generate(['p1']);
    const arg = (findMany.mock.calls[0] as unknown as [{ where: unknown; select: { variations: unknown } }])[0];
    expect(arg.where).toEqual({ id: { in: ['p1'] } });
    expect(arg.select.variations).toEqual({ select: { name: true }, orderBy: VARIATION_ORDER_BY });
    expect(categoryFindMany).toHaveBeenCalledWith({ where: { id: { in: ['c1', 'c2'] } }, select: { id: true, name: true } });
    expect(batch).toHaveBeenCalledWith([
      {
        id: 'p1',
        slug: 'son-duong-bo-tuoi-po-lang-a08',
        name: 'Son dưỡng bơ tươi Pơ Lang A08',
        brand: 'Pơ Lang',
        categories: ['Chăm sóc cá nhân', 'Son môi'],
        variations: ['4g', '8g'],
        shortDesc: 'Ngắn',
        description: 'Mô tả cũ',
        ingredients: ['Bơ tươi'],
      },
    ]);
  });

  it('không có danh mục thì không truy vấn danh mục; mã danh mục đã xoá bị bỏ', async () => {
    const none = make([row({ categoryIds: [] })]);
    await none.svc.generate(['p1']);
    expect(none.categoryFindMany).not.toHaveBeenCalled();
    expect((none.batch.mock.calls[0]![0] as CopyDraftInput[])[0]!.categories).toEqual([]);

    const gone = make([row({ categoryIds: ['c1', 'xoa'] })]);
    await gone.svc.generate(['p1']);
    expect((gone.batch.mock.calls[0]![0] as CopyDraftInput[])[0]!.categories).toEqual(['Chăm sóc cá nhân']);
  });

  it('sản phẩm không có và sản phẩm đối tác vào failed, không gửi cho AI; thứ tự theo ids yêu cầu', async () => {
    const { svc, batch } = make([row({ id: 'b' }), row({ id: 'partner', storefrontId: 'sf1' }), row({ id: 'a' })]);
    const res = await svc.generate(['a', 'missing', 'partner', 'b']);
    expect((batch.mock.calls[0]![0] as CopyDraftInput[]).map((i) => i.id).sort()).toEqual(['a', 'b']);
    expect(res.drafts.map((d) => d.id)).toEqual(['a', 'b']);
    expect(res.failed).toEqual([
      { id: 'missing', reason: 'Không tìm thấy sản phẩm.' },
      { id: 'partner', reason: expect.stringContaining('đối tác') },
    ]);
  });

  it('không còn sản phẩm nào đủ điều kiện thì không gọi AI (không chiếm cổng, không tốn tiền)', async () => {
    const { svc, batch } = make([row({ id: 'partner', storefrontId: 'sf1' })]);
    const res = await svc.generate(['partner', 'missing']);
    expect(batch).not.toHaveBeenCalled();
    expect(res.drafts).toEqual([]);
    expect(res.failed.map((f) => f.id)).toEqual(['partner', 'missing']);
  });

  it('sản phẩm AI và chữ dự phòng đều không soạn được: lý do của AI service được chuyển nguyên vào failed', async () => {
    const { svc } = make([row({ id: 'a' }), row({ id: 'b' })], async () => [okDraft('a'), { id: 'b', failed: 'AI đang bận, và sản phẩm chưa có chữ dự phòng dùng được nên chưa soạn được.' }]);
    const res = await svc.generate(['a', 'b']);
    expect(res.drafts.map((d) => d.id)).toEqual(['a']);
    expect(res.failed).toEqual([{ id: 'b', reason: 'AI đang bận, và sản phẩm chưa có chữ dự phòng dùng được nên chưa soạn được.' }]);
  });

  it('lô khác đang chạy: 503 của AI service được chuyển lên, không ghi gì', async () => {
    const { svc } = make([row()], async () => {
      throw new ServiceUnavailableException('Đang soạn mô tả cho một lô khác.');
    });
    await expect(svc.generate(['p1'])).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('không bao giờ ghi DB', async () => {
    const { svc } = make([row()]);
    const prisma = (svc as unknown as { prisma: { product: Record<string, unknown> } }).prisma;
    await svc.generate(['p1']);
    expect(Object.keys(prisma.product)).toEqual(['findMany']);
  });
});
