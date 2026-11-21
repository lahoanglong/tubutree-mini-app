import { Logger } from '@nestjs/common';
import type { CopyApproveItem } from '@tubutree/shared-types';
import type { PrismaService } from '../../prisma/prisma.service';
import { COPY_DESCRIPTION_MAX, COPY_INGREDIENTS_MAX } from '../ai-advisor/copy-draft';
import { CopyApproveService } from './copy-approve.service';

const item = (id: string, over: Partial<CopyApproveItem> = {}): CopyApproveItem => ({
  id,
  shortDesc: 'Son dưỡng dạng thỏi.',
  description: 'Son dưỡng bơ tươi dạng thỏi, mang theo dễ dàng.',
  ingredients: ['Bơ tươi'],
  ...over,
});

const product = (id: string, over: Record<string, unknown> = {}) => ({ id, name: `Sản phẩm ${id}`, storefrontId: null, ...over });

type Fresh = { storefrontId: string | null; ingredients: unknown } | null;

/** `fresh`: bản đọc lại SAU khi khoá dòng (khác bản đọc lúc kiểm) theo id, mô phỏng admin khác ghi chen vào giữa. */
function make(rows: unknown[], opts: { fresh?: Record<string, Fresh>; tx?: (run: (tx: unknown) => Promise<unknown>) => Promise<unknown> } = {}) {
  const order: string[] = [];
  const findMany = jest.fn(async () => rows);
  const update = jest.fn(async (args: { where: { id: string } }) => {
    order.push(`update:${args.where.id}`);
    return { id: args.where.id };
  });
  const queryRaw = jest.fn(async (_strings: TemplateStringsArray, id: string) => {
    order.push(`lock:${id}`);
    return [];
  });
  const findUnique = jest.fn(async (args: { where: { id: string } }): Promise<Fresh> => {
    const id = args.where.id;
    if (opts.fresh && id in opts.fresh) return opts.fresh[id]!;
    const row = (rows as { id: string; storefrontId: string | null; ingredients?: unknown }[]).find((r) => r.id === id);
    return row ? { storefrontId: row.storefrontId, ingredients: row.ingredients ?? null } : null;
  });
  const tx = { $queryRaw: queryRaw, product: { findUnique, update } };
  const transaction = jest.fn(opts.tx ?? (async (run: (t: unknown) => Promise<unknown>) => run(tx)));
  const prisma = { product: { findMany }, $transaction: transaction } as unknown as PrismaService;
  return { svc: new CopyApproveService(prisma), findMany, update, transaction, order, queryRaw, findUnique };
}

const dataOf = (update: jest.Mock, i = 0) => (update.mock.calls[i] as [{ where: { id: string }; data: Record<string, unknown> }])[0];

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
});
afterEach(() => jest.restoreAllMocks());

describe('CopyApproveService.approve', () => {
  it('ghi description, shortDesc và ingredients dạng [{name}] bằng MỘT $transaction cho các mục được nhận', async () => {
    const { svc, update, transaction } = make([product('a'), product('b')]);
    const res = await svc.approve('admin1', [item('a', { ingredients: ['Bơ tươi', 'Gấc'] }), item('b')]);
    expect(res).toEqual({ saved: ['a', 'b'], rejected: [] });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(2);
    expect(dataOf(update, 0)).toMatchObject({
      where: { id: 'a' },
      data: { description: 'Son dưỡng bơ tươi dạng thỏi, mang theo dễ dàng.', shortDesc: 'Son dưỡng dạng thỏi.', ingredients: [{ name: 'Bơ tươi' }, { name: 'Gấc' }] },
    });
  });

  it('giữ percentage/benefit và thành phần hiện có mà bản duyệt không nhắc tới, chỉ nối tên mới', async () => {
    const current = [{ name: 'Enzyme dứa lên men', percentage: '15%', benefit: 'Phân giải vết bẩn' }, { name: 'Bồ kết', benefit: 'Làm sạch nhẹ' }];
    const { svc, update } = make([product('a', { ingredients: current })]);
    await svc.approve('admin1', [item('a', { ingredients: ['Enzyme dứa lên men', 'Tinh dầu sả'] })]);
    expect(dataOf(update).data).toMatchObject({ ingredients: [...current, { name: 'Tinh dầu sả' }] });
  });

  it('dùng mô tả đã trim; mô tả ngắn rỗng thành null', async () => {
    const { svc, update } = make([product('a')]);
    await svc.approve('admin1', [item('a', { description: '  Mô tả sạch.  ', shortDesc: '   ' })]);
    expect(dataOf(update).data).toMatchObject({ description: 'Mô tả sạch.', shortDesc: null });
  });

  it('ingredients rỗng thì KHÔNG đụng cột ingredients (không xoá thành phần admin đã nhập)', async () => {
    const { svc, update } = make([product('a')]);
    await svc.approve('admin1', [item('a', { ingredients: [] }), item('a', { ingredients: ['', '  '] })]);
    for (const i of [0, 1]) expect(dataOf(update, i).data).not.toHaveProperty('ingredients');
  });

  it('từ chối mục còn câu cấm sau khi lọc lại (admin sửa tay), nêu câu bị chặn; mục sạch cùng lô vẫn được ghi', async () => {
    const { svc, update, transaction } = make([product('a'), product('b')]);
    const res = await svc.approve('admin1', [item('a', { description: 'Son dưỡng dạng thỏi. Giúp chữa nứt nẻ môi.' }), item('b')]);
    expect(res.saved).toEqual(['b']);
    expect(res.rejected).toEqual([{ id: 'a', reasons: ['Mô tả có câu bị chặn: "Giúp chữa nứt nẻ môi."'] }]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(dataOf(update).where.id).toBe('b');
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('từ chối mô tả ngắn có câu cấm, thành phần có tuyên bố cấm, mô tả rỗng và vượt trần độ dài', async () => {
    const { svc, update, transaction } = make([product('s'), product('i'), product('e'), product('l')]);
    const res = await svc.approve('admin1', [
      item('s', { shortDesc: 'Hoàn toàn tự nhiên.' }),
      item('i', { ingredients: ['Cacao hữu cơ'] }),
      item('e', { description: '<p></p>' }),
      item('l', { description: 'a'.repeat(COPY_DESCRIPTION_MAX + 1) }),
    ]);
    expect(res.saved).toEqual([]);
    expect(res.rejected.map((r) => r.id)).toEqual(['s', 'i', 'e', 'l']);
    expect(res.rejected[0]!.reasons[0]).toContain('Hoàn toàn tự nhiên.');
    expect(res.rejected[1]!.reasons[0]).toContain('Cacao hữu cơ');
    expect(res.rejected[2]!.reasons).toEqual(['Mô tả đang trống.']);
    expect(res.rejected[3]!.reasons[0]).toContain(`dài quá ${COPY_DESCRIPTION_MAX}`);
    expect(update).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('sản phẩm không tồn tại hoặc của đối tác bị từ chối, không ghi', async () => {
    const { svc, update } = make([product('partner', { storefrontId: 'sf1' }), product('ok')]);
    const res = await svc.approve('admin1', [item('partner'), item('missing'), item('ok')]);
    expect(res.saved).toEqual(['ok']);
    expect(res.rejected).toEqual([
      { id: 'partner', reasons: [expect.stringContaining('đối tác')] },
      { id: 'missing', reasons: ['Không tìm thấy sản phẩm.'] },
    ]);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('nguyên tử: $transaction lỗi thì lỗi được ném lên và không trả "saved"', async () => {
    const { svc } = make([product('a'), product('b')], {
      tx: async () => {
        throw new Error('deadlock');
      },
    });
    await expect(svc.approve('admin1', [item('a'), item('b')])).rejects.toThrow('deadlock');
  });

  it('chỉ đọc sản phẩm theo id trong yêu cầu; ghi log hành động admin', async () => {
    const { svc, findMany } = make([product('a')]);
    await svc.approve('admin7', [item('a')]);
    expect(findMany).toHaveBeenCalledWith({ where: { id: { in: ['a'] } }, select: { id: true, name: true, storefrontId: true } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Admin admin7 duyệt mô tả sản phẩm a (Sản phẩm a)'));
  });

  describe('đọc-nối-ghi cột ingredients dưới khoá dòng', () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Thành phần ${String.fromCharCode(65 + i)}` }));

    it('khoá dòng products theo thứ tự id rồi mới đọc và ghi, mỗi sản phẩm một lần', async () => {
      const { svc, order } = make([product('a'), product('b')]);
      await svc.approve('admin1', [item('b'), item('a')]);
      expect(order).toEqual(['lock:a', 'update:a', 'lock:b', 'update:b']);
    });

    it('nối vào cột đọc lại SAU khi khoá, không phải bản đọc lúc kiểm (admin khác vừa thêm Gấc)', async () => {
      const stale = [{ name: 'Bơ tươi' }];
      const { svc, update } = make([product('a', { ingredients: stale })], {
        fresh: { a: { storefrontId: null, ingredients: [...stale, { name: 'Gấc' }] } },
      });
      const res = await svc.approve('admin1', [item('a', { ingredients: ['Dầu dừa'] })]);
      expect(res.saved).toEqual(['a']);
      expect(dataOf(update).data).toMatchObject({ ingredients: [{ name: 'Bơ tươi' }, { name: 'Gấc' }, { name: 'Dầu dừa' }] });
    });

    it(`trần ${COPY_INGREDIENTS_MAX} áp lên cột sau khi nối: ${COPY_INGREDIENTS_MAX - 1} tên đã có + 2 tên mới bị từ chối kèm lý do, mục khác trong lô vẫn ghi`, async () => {
      const { svc, update } = make([product('a', { ingredients: names(COPY_INGREDIENTS_MAX - 1) }), product('b')]);
      const res = await svc.approve('admin1', [item('a', { ingredients: ['Gấc', 'Bơ tươi'] }), item('b')]);
      expect(res.saved).toEqual(['b']);
      expect(res.rejected).toEqual([{ id: 'a', reasons: [expect.stringContaining(`vượt trần ${COPY_INGREDIENTS_MAX}`)] }]);
      expect(res.rejected[0]!.reasons[0]).toContain(`đã có ${COPY_INGREDIENTS_MAX - 1} thành phần, thêm 2 tên mới sẽ thành ${COPY_INGREDIENTS_MAX + 1}`);
      expect(update).toHaveBeenCalledTimes(1);
      expect(dataOf(update).where.id).toBe('b');
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('sản phẩm a '));
    });

    it(`${COPY_INGREDIENTS_MAX - 1} tên đã có + 1 tên mới = ${COPY_INGREDIENTS_MAX} vẫn nhận; cột đã quá trần sẵn nhưng không thêm tên nào thì không bị chặn`, async () => {
      const { svc, update } = make([product('a', { ingredients: names(COPY_INGREDIENTS_MAX - 1) }), product('b', { ingredients: names(COPY_INGREDIENTS_MAX + 1) })]);
      const res = await svc.approve('admin1', [item('a', { ingredients: ['Gấc'] }), item('b', { ingredients: ['Thành phần A'] })]);
      expect(res).toEqual({ saved: ['a', 'b'], rejected: [] });
      expect(update).toHaveBeenCalledTimes(2);
    });

    it('sản phẩm bị xoá hay chuyển sang đối tác giữa lúc kiểm và lúc khoá thì từ chối, không ghi', async () => {
      const { svc, update } = make([product('gone'), product('moved'), product('ok')], {
        fresh: { gone: null, moved: { storefrontId: 'sf1', ingredients: null } },
      });
      const res = await svc.approve('admin1', [item('gone'), item('moved'), item('ok')]);
      expect(res.saved).toEqual(['ok']);
      expect(res.rejected).toEqual([
        { id: 'gone', reasons: ['Không tìm thấy sản phẩm.'] },
        { id: 'moved', reasons: [expect.stringContaining('đối tác')] },
      ]);
      expect(update).toHaveBeenCalledTimes(1);
    });
  });
});
