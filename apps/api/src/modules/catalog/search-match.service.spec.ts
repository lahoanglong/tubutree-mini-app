import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { SEARCH_FUZZY_FLAG } from './search-fuzzy';
import { SearchMatchService, normalizePair } from './search-match.service';

const config = (on: boolean) => ({ get: jest.fn(async (k: string, fb: unknown) => (k === SEARCH_FUZZY_FLAG ? on : fb)) }) as unknown as SystemConfigService;

const NAMES = ['Nước giặt hương Cam Fuwa3e 500ml', 'Nước giặt cho bé Pineboo 500ml', 'Nước rửa chén Fuwa3e 100ml'];

function setup(on: boolean, opts: { synonyms?: { term: string; canonical: string }[]; fuzzy?: { id: string; name: string }[] } = {}) {
  const tx = { $queryRaw: jest.fn().mockResolvedValueOnce([{ set_config: '0.35' }]).mockResolvedValueOnce(opts.fuzzy ?? []) };
  const prisma = {
    searchSynonym: { findMany: jest.fn().mockResolvedValue(opts.synonyms ?? []) },
    product: { findMany: jest.fn().mockResolvedValue(NAMES.map((name) => ({ name }))) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  return { svc: new SearchMatchService(prisma, config(on)), prisma, tx };
}

describe('SearchMatchService.refine', () => {
  it('cờ tắt: trả đúng id và thứ tự của bước chính xác, không đọc bảng nào', async () => {
    const { svc, prisma } = setup(false);
    const exact = jest.fn();
    await expect(svc.refine('nuoc gait', ['b', 'a'], exact)).resolves.toEqual({ ids: ['b', 'a'], corrected: false, didYouMean: null });
    await expect(svc.refine('nuoc gait', [], exact)).resolves.toEqual({ ids: [], corrected: false, didYouMean: null });
    expect(exact).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.searchSynonym.findMany).not.toHaveBeenCalled();
  });

  it('không có SystemConfigService (spec dựng tay): như cờ tắt', async () => {
    const svc = new SearchMatchService({} as PrismaService);
    await expect(svc.refine('x', ['a'], jest.fn())).resolves.toEqual({ ids: ['a'], corrected: false, didYouMean: null });
  });

  it('đủ 3 món chính xác: không chạy bước gần đúng', async () => {
    const { svc, prisma } = setup(true);
    const out = await svc.refine('nuoc giat', ['a', 'b', 'c'], jest.fn());
    expect(out).toEqual({ ids: ['a', 'b', 'c'], corrected: false, didYouMean: null });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('từ đồng nghĩa: nối kết quả của cụm thay sau kết quả chính xác, không trùng', async () => {
    const { svc } = setup(true, { synonyms: [{ term: 'rua bat', canonical: 'rua chen' }] });
    const exact = jest.fn(async (q: string) => (q === 'nuoc rua chen' ? ['x', 'a', 'y'] : []));
    const out = await svc.refine('nước rửa bát', ['a'], exact);
    expect(exact).toHaveBeenCalledWith('nuoc rua chen');
    expect(out).toEqual({ ids: ['a', 'x', 'y'], corrected: false, didYouMean: null });
  });

  it('chính xác 0 món: sửa chính tả + gần đúng, corrected=true, didYouMean là cụm đã sửa có dấu; ngưỡng đặt trong transaction', async () => {
    const { svc, tx } = setup(true, { fuzzy: [{ id: 'f1', name: 'Nước giặt cho bé' }, { id: 'g1', name: 'x' }] });
    const exact = jest.fn(async (q: string) => (q === 'nuoc giat' ? ['g1', 'g2'] : []));
    const out = await svc.refine('nuoc gait', [], exact);
    expect(out).toEqual({ ids: ['g1', 'g2', 'f1'], corrected: true, didYouMean: 'nước giặt' });
    const session = (tx.$queryRaw.mock.calls[0] as unknown[])[0] as { sql: string; values: unknown[] };
    expect(session.sql).toContain("set_config('pg_trgm.word_similarity_threshold'");
    expect(session.sql).toContain("set_config('enable_seqscan', 'off', true)");
    expect(session.values).toEqual(['0.35']);
  });

  it('không sửa chính tả được nhưng gần đúng có hàng: didYouMean là tên món gần nhất', async () => {
    const { svc } = setup(true, { fuzzy: [{ id: 'f1', name: 'Nước giặt cho bé Pineboo 500ml' }] });
    const out = await svc.refine('pinebooo', [], async () => []);
    expect(out.corrected).toBe(true);
    expect(out.didYouMean).toBe('Nước giặt cho bé Pineboo 500ml');
  });

  it('chính xác ra 1–2 món: nối thêm gần đúng, không báo "đã sửa"', async () => {
    const { svc } = setup(true, { fuzzy: [{ id: 'a', name: 'A' }, { id: 'f', name: 'F' }] });
    await expect(svc.refine('nuoc giat cam', ['a'], async () => [])).resolves.toEqual({ ids: ['a', 'f'], corrected: false, didYouMean: null });
  });

  it('vô nghĩa: không món nào, không gợi ý', async () => {
    const { svc } = setup(true);
    await expect(svc.refine('qzxwv', [], async () => [])).resolves.toEqual({ ids: [], corrected: false, didYouMean: null });
  });

  it('SQL gần đúng lỗi: giữ kết quả chính xác', async () => {
    const { svc, prisma } = setup(true);
    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('pg_trgm missing'));
    await expect(svc.refine('nuoc gait', [], async () => [])).resolves.toEqual({ ids: [], corrected: false, didYouMean: null });
  });
});

describe('SearchMatchService: admin từ đồng nghĩa', () => {
  it('normalizePair: gấp dấu, chặn hai vế giống nhau và độ dài sai', () => {
    expect(normalizePair('Nước Rửa  Bát', 'nước rửa chén')).toEqual({ term: 'nuoc rua bat', canonical: 'nuoc rua chen' });
    expect(() => normalizePair('rửa bát', 'rua bat')).toThrow(BadRequestException);
    expect(() => normalizePair('a', 'abc')).toThrow(BadRequestException);
  });

  it('tạo trùng term → 409; sửa/xoá id lạ → 404; ghi xong thì bỏ bộ đệm', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    const prisma = {
      searchSynonym: {
        create: jest.fn().mockRejectedValueOnce(p2002).mockResolvedValueOnce({ id: 's1' }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;
    const svc = new SearchMatchService(prisma, config(true));
    await expect(svc.createSynonym({ term: 'rửa bát', canonical: 'rửa chén' })).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.createSynonym({ term: 'rửa bát', canonical: 'rửa chén' })).resolves.toEqual({ id: 's1' });
    expect((prisma.searchSynonym.create as jest.Mock).mock.calls[1][0].data).toEqual({ term: 'rua bat', canonical: 'rua chen', isActive: true });
    await expect(svc.updateSynonym('nope', { isActive: false })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.removeSynonym('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
