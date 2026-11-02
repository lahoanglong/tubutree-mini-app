import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { FlashAllowanceService, parseAllowanceItemIds } from './flash-allowance.service';
import type { EffectivePrice, FlashSaleService } from './flash-sale.service';

describe('parseAllowanceItemIds', () => {
  it('tách theo dấu phẩy, bỏ trùng, giữ thứ tự', () => {
    expect(parseAllowanceItemIds('a,b')).toEqual(['a', 'b']);
    expect(parseAllowanceItemIds('a,b,a')).toEqual(['a', 'b']);
    expect(parseAllowanceItemIds('clx0_a-B')).toEqual(['clx0_a-B']);
  });

  it('đủ 50 id khác nhau vẫn qua', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `id${i}`);
    expect(parseAllowanceItemIds(ids.join(','))).toEqual(ids);
  });

  it.each([
    ['thiếu', undefined],
    ['rỗng', ''],
    ['đoạn rỗng giữa', 'a,,b'],
    ['có khoảng trắng', 'a b'],
    ['ký tự lạ', '../x'],
    ['dấu chấm phẩy', 'a;b'],
    ['id dài quá 64', 'x'.repeat(65)],
    ['tham số lặp (mảng)', ['a', 'b']],
    ['không phải chuỗi', 42],
    ['51 id khác nhau', Array.from({ length: 51 }, (_, i) => `id${i}`).join(',')],
  ])('400 khi %s', (_name, raw) => {
    expect(() => parseAllowanceItemIds(raw)).toThrow(BadRequestException);
  });

  it('50 id lặp lại thành 1 id thì vẫn qua (đếm sau khi bỏ trùng)', () => {
    expect(parseAllowanceItemIds(Array.from({ length: 80 }, () => 'a').join(','))).toEqual(['a']);
  });
});

describe('FlashAllowanceService.forUser', () => {
  const offer = (over: Partial<EffectivePrice>): EffectivePrice => ({
    flashPrice: 26_000,
    itemId: 'fi1',
    endAt: new Date('2026-11-03T00:00:00Z'),
    soldCount: 0,
    quota: 10,
    ...over,
  });

  function build(rows: { id: string; variationId: string }[], effective: Map<string, EffectivePrice>) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const resolveEffective = jest.fn().mockResolvedValue(effective);
    const svc = new FlashAllowanceService({ flashSaleItem: { findMany } } as unknown as PrismaService, { resolveEffective } as unknown as FlashSaleService);
    return { svc, findMany, resolveEffective };
  }

  it('trả số của đúng suất khớp offer; suất không còn chạy hoặc offer là suất khác thì vắng', async () => {
    const { svc } = build(
      [
        { id: 'fi1', variationId: 'v1' },
        { id: 'fi2', variationId: 'v2' },
      ],
      new Map([
        ['v1', offer({ itemId: 'fi1', perUserLeft: 1, allowance: 1, quotaLeft: 10 })],
        ['v2', offer({ itemId: 'suat-khac', perUserLeft: 3, allowance: 3 })],
      ]),
    );
    await expect(svc.forUser('u1', ['fi1', 'fi2', 'fi3'])).resolves.toEqual({ items: { fi1: { perUserLeft: 1, allowance: 1 } } });
  });

  it('suất của người tạo đợt (ownSale) ra 0/0', async () => {
    const { svc } = build([{ id: 'fi1', variationId: 'v1' }], new Map([['v1', offer({ itemId: 'fi1', perUserLeft: 0, allowance: 0, ownSale: true })]]));
    await expect(svc.forUser('u1', ['fi1'])).resolves.toEqual({ items: { fi1: { perUserLeft: 0, allowance: 0 } } });
  });

  it('offer thiếu số theo khách (không tra theo khách) thì bỏ, không bịa số', async () => {
    const { svc } = build([{ id: 'fi1', variationId: 'v1' }], new Map([['v1', offer({ itemId: 'fi1' })]]));
    await expect(svc.forUser('u1', ['fi1'])).resolves.toEqual({ items: {} });
  });

  it('tra theo đúng khách và giờ truyền vào, theo phân loại của các suất tìm được', async () => {
    const { svc, findMany, resolveEffective } = build([{ id: 'fi1', variationId: 'v1' }], new Map());
    const now = new Date('2026-11-02T10:00:00Z');
    await svc.forUser('u-abc', ['fi1', 'fi2'], now);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['fi1', 'fi2'] } } }));
    expect(resolveEffective).toHaveBeenCalledWith(['v1'], now, 'u-abc');
  });

  it('không có dòng DB nào thì không gọi resolveEffective', async () => {
    const { svc, resolveEffective } = build([], new Map());
    await expect(svc.forUser('u1', ['fi9'])).resolves.toEqual({ items: {} });
    expect(resolveEffective).not.toHaveBeenCalled();
  });
});
