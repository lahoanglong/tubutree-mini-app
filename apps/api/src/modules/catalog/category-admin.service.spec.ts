import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CatalogService } from './catalog.service';
import type { HomeService } from './home.service';
import { CategoryAdminService } from './category-admin.service';
import { CATEGORY_PARENT_HAS_PRODUCTS } from '@tubutree/shared-types';
import { CATEGORY_MSG } from './category-tree';

interface Row {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
  image?: string | null;
}

/** Kho danh mục trong bộ nhớ: đủ để thử luật cây bằng hành vi thay vì đếm lời gọi mock. */
function make(initial: Row[] = [], products: { categoryIds: string[] }[] = []) {
  const rows = initial.map((r) => ({ image: null, ...r }));
  let seq = 0;
  const order: string[] = [];
  // Transaction giả đưa lại chính kho này; giữ qua biến để kiểu của `prisma` không tự tham chiếu.
  const self: { current: unknown } = { current: null };
  const prisma = {
    $executeRaw: jest.fn(async () => {
      order.push('lock');
      return 1;
    }),
    category: {
      findMany: jest.fn(async () => [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))),
      create: jest.fn(async ({ data }: { data: Omit<Row, 'id'> }) => {
        order.push('create');
        const row = { image: null, ...data, id: `new${++seq}` };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        order.push('update');
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        order.push('delete');
        rows.splice(rows.findIndex((r) => r.id === where.id), 1);
        return {};
      }),
    },
    product: {
      count: jest.fn(async ({ where }: { where: { categoryIds: { has: string } } }) => products.filter((p) => p.categoryIds.includes(where.categoryIds.has)).length),
      findMany: jest.fn(async () => products),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(self.current)),
  };
  self.current = prisma;
  const catalog = { invalidateCategoryCache: jest.fn() };
  const home = { invalidateStatic: jest.fn() };
  const svc = new CategoryAdminService(prisma as unknown as PrismaService, catalog as unknown as CatalogService, home as unknown as HomeService);
  return { svc, prisma, rows, catalog, home, order };
}

const root = (id: string, sortOrder = 0): Row => ({ id, name: id.toUpperCase(), slug: id, parentId: null, sortOrder });
const child = (id: string, parentId: string, sortOrder = 0): Row => ({ id, name: id.toUpperCase(), slug: id, parentId, sortOrder });
const roots = (n: number) => Array.from({ length: n }, (_, i) => root(`r${i}`, i));
const kids = (parent: string, n: number) => Array.from({ length: n }, (_, i) => child(`${parent}-c${i}`, parent, i));

describe('CategoryAdminService.create', () => {
  it('gốc thứ 9 bị chặn bằng câu tiếng Việt và không ghi gì', async () => {
    const { svc, prisma } = make(roots(8));
    await expect(svc.create('a', { name: 'Mới' })).rejects.toThrow(CATEGORY_MSG.rootsFull());
    await expect(svc.create('a', { name: 'Mới' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.category.create).not.toHaveBeenCalled();
  });

  it('mục con thứ 9 của một cha bị chặn nêu tên cha; cha khác vẫn thêm được', async () => {
    const { svc, prisma } = make([root('a'), root('b', 1), ...kids('a', 8)]);
    await expect(svc.create('x', { name: 'Thừa', parentId: 'a' })).rejects.toThrow(CATEGORY_MSG.childrenFull('A'));
    expect(prisma.category.create).not.toHaveBeenCalled();
    await expect(svc.create('x', { name: 'Vừa', parentId: 'b' })).resolves.toMatchObject({ name: 'Vừa', parentId: 'b' });
  });

  it('chỉ hai tầng: không tạo con của một mục con; cha không tồn tại là 404', async () => {
    const { svc } = make([root('a'), child('a1', 'a')]);
    await expect(svc.create('x', { name: 'Sâu', parentId: 'a1' })).rejects.toThrow(CATEGORY_MSG.parentNotRoot());
    await expect(svc.create('x', { name: 'Lạ', parentId: 'zz' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tên trùng cùng cấp (khác hoa thường, dấu) bị chặn; cùng tên ở cấp khác thì được', async () => {
    const { svc } = make([{ ...root('a'), name: 'Nhà bếp' }, root('b', 1)]);
    await expect(svc.create('x', { name: ' nha BEP ' })).rejects.toThrow(CATEGORY_MSG.duplicateName('nha BEP'));
    await expect(svc.create('x', { name: 'Nhà bếp', parentId: 'b' })).resolves.toMatchObject({ parentId: 'b' });
  });

  it('ghi sortOrder cuối nhóm, slug không dấu và duy nhất, rồi làm mới cache đúng một lần', async () => {
    const { svc, catalog, home, order } = make([{ ...root('a', 4), slug: 'cham-soc' }]);
    const r = await svc.create('x', { name: 'Chăm sóc' });
    expect(r).toMatchObject({ name: 'Chăm sóc', slug: 'cham-soc-2', parentId: null, sortOrder: 5, productCount: 0, totalCount: 0 });
    expect(order[0]).toBe('lock');
    expect(catalog.invalidateCategoryCache).toHaveBeenCalledTimes(1);
    expect(home.invalidateStatic).toHaveBeenCalledTimes(1);
  });

  it('lỗi thì không làm mới cache', async () => {
    const { svc, catalog, home } = make(roots(8));
    await svc.create('x', { name: 'Mới' }).catch(() => undefined);
    expect(catalog.invalidateCategoryCache).not.toHaveBeenCalled();
    expect(home.invalidateStatic).not.toHaveBeenCalled();
  });
});

/** Lỗi 400 mang mã nghiệp vụ để giao diện hỏi xác nhận thay vì hiện lỗi. */
const codeOf = (e: unknown) => (e instanceof BadRequestException ? (e.getResponse() as { code?: string }).code : undefined);

describe('CategoryAdminService: gốc đang có sản phẩm gắn thẳng thành mục cha', () => {
  const owned = [{ categoryIds: ['a'] }, { categoryIds: ['a', 'x'] }, { categoryIds: ['b'] }];

  it('tạo mục con đầu tiên dưới gốc có 2 sản phẩm gắn thẳng: 400 mã riêng nêu số sản phẩm, không ghi, không làm mới cache', async () => {
    const { svc, prisma, catalog, home } = make([root('a'), root('b', 1)], owned);
    const err = await svc.create('x', { name: 'Con', parentId: 'a' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(codeOf(err)).toBe(CATEGORY_PARENT_HAS_PRODUCTS);
    expect((err as Error).message).toBe(CATEGORY_MSG.parentHasProducts('A', 2));
    expect((err as Error).message).toContain('2 sản phẩm');
    expect(prisma.category.create).not.toHaveBeenCalled();
    expect(catalog.invalidateCategoryCache).not.toHaveBeenCalled();
    expect(home.invalidateStatic).not.toHaveBeenCalled();
  });

  it('có confirmDirectProducts thì tạo được; sản phẩm vẫn giữ nguyên danh mục cha', async () => {
    const { svc, rows } = make([root('a')], owned);
    await expect(svc.create('x', { name: 'Con', parentId: 'a', confirmDirectProducts: true })).resolves.toMatchObject({ parentId: 'a' });
    expect(rows.filter((r) => r.parentId === 'a')).toHaveLength(1);
    expect(owned[0]!.categoryIds).toContain('a');
  });

  it('gốc không có sản phẩm gắn thẳng thì tạo con không cần xác nhận', async () => {
    const { svc } = make([root('a'), root('c', 2)], owned);
    await expect(svc.create('x', { name: 'Con', parentId: 'c' })).resolves.toMatchObject({ parentId: 'c' });
  });

  it('gốc đã có con từ trước (kể cả còn sản phẩm gắn thẳng từ dữ liệu cũ): thêm con tiếp không hỏi lại', async () => {
    const { svc } = make([root('a'), child('a1', 'a')], owned);
    await expect(svc.create('x', { name: 'Con hai', parentId: 'a' })).resolves.toMatchObject({ parentId: 'a' });
  });

  it('chuyển gốc lá vào gốc đang có sản phẩm gắn thẳng: chặn không cờ, có cờ thì được', async () => {
    const { svc, rows } = make([root('a'), root('c', 2)], owned);
    const err = await svc.update('x', 'c', { parentId: 'a' }).catch((e: unknown) => e);
    expect(codeOf(err)).toBe(CATEGORY_PARENT_HAS_PRODUCTS);
    expect(rows.find((r) => r.id === 'c')!.parentId).toBeNull();
    await expect(svc.update('x', 'c', { parentId: 'a', confirmDirectProducts: true })).resolves.toMatchObject({ id: 'c', parentId: 'a' });
  });

  it('chuyển vào gốc không có sản phẩm gắn thẳng thì không hỏi, dù chính mục được chuyển còn sản phẩm', async () => {
    const { svc } = make([root('a'), root('b', 1), root('c', 2)], owned);
    await expect(svc.update('x', 'b', { parentId: 'c' })).resolves.toMatchObject({ id: 'b', parentId: 'c' });
  });
});

describe('CategoryAdminService.update', () => {
  it('đổi tên giữ nguyên slug; tên trùng anh em bị chặn', async () => {
    const { svc, rows } = make([root('a'), root('b', 1)]);
    await expect(svc.update('x', 'a', { name: 'b' })).rejects.toThrow(CATEGORY_MSG.duplicateName('b'));
    await svc.update('x', 'a', { name: 'Tên mới' });
    expect(rows.find((r) => r.id === 'a')).toMatchObject({ name: 'Tên mới', slug: 'a' });
  });

  it('chuyển gốc không có con vào một gốc khác: thành con, nằm cuối nhóm mới', async () => {
    const { svc, rows } = make([root('a'), root('b', 1), child('a1', 'a', 5)]);
    const r = await svc.update('x', 'b', { parentId: 'a' });
    expect(r).toMatchObject({ id: 'b', parentId: 'a', sortOrder: 6 });
    expect(rows.find((x) => x.id === 'b')!.parentId).toBe('a');
  });

  it('mục đang có con không chuyển thành mục con được', async () => {
    const { svc } = make([root('a'), root('b', 1), child('b1', 'b')]);
    await expect(svc.update('x', 'b', { parentId: 'a' })).rejects.toThrow(CATEGORY_MSG.hasChildrenCannotNest('B'));
  });

  it('cha đích đủ 8 con thì chặn; đích là một mục con thì chặn (chỉ hai tầng)', async () => {
    const { svc } = make([root('a'), root('b', 1), ...kids('a', 8)]);
    await expect(svc.update('x', 'b', { parentId: 'a' })).rejects.toThrow(CATEGORY_MSG.childrenFull('A'));
    await expect(svc.update('x', 'b', { parentId: 'a-c0' })).rejects.toThrow(CATEGORY_MSG.parentNotRoot());
  });

  it('chuyển con lên gốc khi đã đủ 8 gốc bị chặn; còn chỗ thì được', async () => {
    const full = make([...roots(8), child('k', 'r0')]);
    await expect(full.svc.update('x', 'k', { parentId: null })).rejects.toThrow(CATEGORY_MSG.rootsFull());
    const roomy = make([...roots(3), child('k', 'r0')]);
    await expect(roomy.svc.update('x', 'k', { parentId: null })).resolves.toMatchObject({ id: 'k', parentId: null, sortOrder: 3 });
  });

  it('mục không tồn tại là 404', async () => {
    await expect(make().svc.update('x', 'zz', { name: 'A' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CategoryAdminService.reorder', () => {
  it('đúng bộ anh em thì ghi sortOrder 0..n-1 theo thứ tự gửi và trả danh sách mới', async () => {
    const { svc, rows } = make([root('a', 7), root('b', 7), root('c', 7)]);
    const list = await svc.reorder('x', null, ['c', 'a', 'b']);
    expect(rows.map((r) => [r.id, r.sortOrder]).sort()).toEqual([['a', 1], ['b', 2], ['c', 0]]);
    expect(list.items.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('sắp trong một cha chỉ đụng các mục con của cha đó', async () => {
    const { svc, rows } = make([root('a'), root('b', 1), child('a1', 'a', 0), child('a2', 'a', 1)]);
    await svc.reorder('x', 'a', ['a2', 'a1']);
    expect(rows.find((r) => r.id === 'a2')!.sortOrder).toBe(0);
    expect(rows.find((r) => r.id === 'b')!.sortOrder).toBe(1);
  });

  it('danh sách đã đổi (thiếu, thừa, trùng hoặc id lạ) là 409 và không ghi', async () => {
    const { svc, prisma } = make([root('a'), root('b', 1)]);
    for (const ids of [['a'], ['a', 'b', 'c'], ['a', 'a'], ['a', 'zz']]) {
      await expect(svc.reorder('x', null, ids)).rejects.toBeInstanceOf(ConflictException);
    }
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it('cha không tồn tại là 404', async () => {
    await expect(make([root('a')]).svc.reorder('x', 'zz', ['a'])).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CategoryAdminService.remove', () => {
  it('còn mục con hoặc còn sản phẩm thì chặn; trống thì xoá và làm mới cache', async () => {
    const { svc, rows, catalog } = make([root('a'), root('b', 1), root('c', 2), child('a1', 'a')], [{ categoryIds: ['b'] }]);
    await expect(svc.remove('x', 'a')).rejects.toThrow(CATEGORY_MSG.removeHasChildren('A', 1));
    await expect(svc.remove('x', 'b')).rejects.toThrow(CATEGORY_MSG.removeHasProducts('B', 1));
    expect(catalog.invalidateCategoryCache).not.toHaveBeenCalled();
    await expect(svc.remove('x', 'c')).resolves.toEqual({ id: 'c' });
    expect(rows.map((r) => r.id)).not.toContain('c');
    expect(catalog.invalidateCategoryCache).toHaveBeenCalledTimes(1);
  });

  it('mục không tồn tại là 404', async () => {
    await expect(make().svc.remove('x', 'zz')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CategoryAdminService.list', () => {
  it('kèm giới hạn, productCount trực tiếp và totalCount cộng con (mỗi SP một lần); cha không còn coi như gốc', async () => {
    const { svc } = make(
      [root('a', 0), child('a1', 'a', 0), child('a2', 'a', 1), { ...child('mo-coi', 'da-xoa', 2) }],
      [{ categoryIds: ['a1'] }, { categoryIds: ['a', 'a1'] }, { categoryIds: ['a2'] }, { categoryIds: [] }],
    );
    const list = await svc.list();
    expect(list.limits).toEqual({ maxRoots: 8, maxChildren: 8 });
    const byId = new Map(list.items.map((i) => [i.id, i]));
    expect(byId.get('a')).toMatchObject({ productCount: 1, totalCount: 3, parentId: null });
    expect(byId.get('a1')).toMatchObject({ productCount: 2, totalCount: 2, parentId: 'a' });
    expect(byId.get('mo-coi')).toMatchObject({ parentId: null, productCount: 0 });
  });

  it('không dùng cache công khai: mỗi lần gọi đọc lại DB', async () => {
    const { svc, prisma } = make([root('a')]);
    await svc.list();
    await svc.list();
    expect(prisma.category.findMany).toHaveBeenCalledTimes(2);
  });
});
