import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RefillPairsService } from '../../src/modules/catalog/refill/refill-pairs.service';
import { REFILL_PAIRS_BLOCK_KEY, REFILL_PAIRS_OVERRIDE_KEY, type RefillPairOverride } from '../../src/modules/catalog/refill/refill-pairs';
import { pinConfig, warmPool } from './helpers';

/**
 * tubu-w10-01 (M1 của review w9-04): hai admin ghép tay hai chai khác nhau cùng lúc thì cả hai cặp phải còn. Trước đây `adminSave` đọc danh sách
 * ghép tay (qua cache của SystemConfigService), gộp, rồi ghi cả mảng: hai lần lưu cùng đọc một bản cũ và lần ghi sau xoá mất cặp của lần trước,
 * không báo lỗi. Mỗi service ở đây có SystemConfigService riêng, như hai tiến trình API.
 */
describe('Cặp Refill: ghép tay đồng thời không mất cặp (real Postgres)', () => {
  let prisma: PrismaService;
  const BRAND = 'W10Lock';
  const REFILL = 'refill-nuoc-rua-chen-w10lock-10l';
  const BOTTLES = ['nuoc-rua-chen-w10lock-100ml', 'nuoc-rua-chen-w10lock-500ml', 'nuoc-rua-chen-w10lock-1l', 'nuoc-rua-chen-w10lock-2l'];
  const pair = (bottleSlug: string): RefillPairOverride => ({ bottleSlug, refillSlug: REFILL });
  const restores: Array<() => Promise<void>> = [];
  const apiProcess = () => new RefillPairsService(prisma, null as never, new SystemConfigService(prisma));

  async function stored(): Promise<RefillPairOverride[]> {
    const row = await prisma.systemConfig.findUnique({ where: { key: REFILL_PAIRS_OVERRIDE_KEY } });
    return (row?.value ?? []) as unknown as RefillPairOverride[];
  }
  async function history(): Promise<Array<{ oldValue: unknown; newValue: unknown }>> {
    return prisma.systemConfigHistory.findMany({ where: { key: REFILL_PAIRS_OVERRIDE_KEY, changedBy: { startsWith: 'w10-lock' } }, select: { oldValue: true, newValue: true } });
  }
  /**
   * Xếp lịch sử theo chuỗi giá trị (bản cũ của dòng sau = bản mới của dòng trước), bắt đầu từ `start`. `changedAt` là giờ bắt đầu transaction,
   * không phải giờ ghi, nên không dùng để xếp. Thiếu mắt xích (hai lần ghi cùng gộp trên một bản) thì chuỗi ngắn hơn số dòng.
   */
  function chain(rows: Array<{ oldValue: unknown; newValue: unknown }>, start: unknown): unknown[] {
    const left = [...rows];
    const values = [start];
    for (;;) {
      const i = left.findIndex((r) => JSON.stringify(r.oldValue) === JSON.stringify(values.at(-1)));
      if (i < 0) return values;
      values.push(left.splice(i, 1)[0].newValue);
    }
  }

  /** N lần quét danh mục đầu tiên chạy thật nhưng không ai nhận kết quả trước khi cả N xong: mọi lần lưu tới bước gộp cùng lúc. */
  function holdCatalogScans(n: number) {
    const original = prisma.product.findMany.bind(prisma.product);
    let started = 0;
    let done = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    return jest.spyOn(prisma.product, 'findMany').mockImplementation((async (...args: Parameters<typeof original>) => {
      const mine = started++ < n;
      const result = await original(...args);
      if (mine) {
        done += 1;
        if (done === n) release();
        await gate;
      }
      return result;
    }) as never);
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    for (const slug of [...BOTTLES, REFILL]) {
      const name = slug === REFILL ? `Refill Nước rửa chén ${BRAND} 10L` : `Nước rửa chén ${BRAND} ${slug.split('-').at(-1)}`;
      await prisma.product.upsert({
        where: { slug },
        update: { isActive: true, approvalStatus: 'APPROVED', brand: BRAND, name, isCombo: false },
        create: { slug, name, brand: BRAND, description: '', basePrice: 100_000 },
      });
    }
    restores.push(await pinConfig(prisma, REFILL_PAIRS_BLOCK_KEY, []));
    restores.push(await pinConfig(prisma, REFILL_PAIRS_OVERRIDE_KEY, []));
  });

  beforeEach(async () => {
    await prisma.systemConfig.update({ where: { key: REFILL_PAIRS_OVERRIDE_KEY }, data: { value: [] } });
    await prisma.systemConfigHistory.deleteMany({ where: { key: REFILL_PAIRS_OVERRIDE_KEY, changedBy: { startsWith: 'w10-lock' } } });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    for (const restore of restores.reverse()) await restore();
    await prisma.systemConfigHistory.deleteMany({ where: { key: REFILL_PAIRS_OVERRIDE_KEY, changedBy: { startsWith: 'w10-lock' } } });
    await prisma.product.deleteMany({ where: { slug: { in: [...BOTTLES, REFILL] } } });
    await prisma?.$disconnect();
  });

  it('hai admin ghép hai chai cùng lúc (cùng đọc danh sách trước khi ai kịp ghi): cả hai cặp còn, lịch sử nối tiếp không mất bản nào', async () => {
    holdCatalogScans(2);
    const [a, b] = [apiProcess(), apiProcess()];
    await Promise.all([a.adminSave({ add: pair(BOTTLES[0]) }, 'w10-lock-a'), b.adminSave({ add: pair(BOTTLES[1]) }, 'w10-lock-b')]);

    expect((await stored()).map((o) => o.bottleSlug).sort()).toEqual([BOTTLES[0], BOTTLES[1]].sort());
    const h = await history();
    expect(h).toHaveLength(2);
    // Lần ghi sau gộp trên đúng bản lần trước vừa ghi: hai dòng nối thành một chuỗi từ [] tới bản đang lưu.
    expect(chain(h, [])).toEqual([[], expect.anything(), await stored()]);
  });

  it('bốn lần lưu cùng lúc trên hai tiến trình (ghép ba chai, bỏ một cặp đang có): kết quả như chạy lần lượt', async () => {
    await prisma.systemConfig.update({ where: { key: REFILL_PAIRS_OVERRIDE_KEY }, data: { value: [pair(BOTTLES[3])] as unknown as Prisma.InputJsonValue } });
    holdCatalogScans(4);
    const [a, b] = [apiProcess(), apiProcess()];
    await Promise.all([
      a.adminSave({ add: pair(BOTTLES[0]) }, 'w10-lock-a'),
      b.adminSave({ add: pair(BOTTLES[1]) }, 'w10-lock-b'),
      a.adminSave({ add: pair(BOTTLES[2]) }, 'w10-lock-a'),
      b.adminSave({ remove: BOTTLES[3] }, 'w10-lock-b'),
    ]);

    expect((await stored()).map((o) => o.bottleSlug).sort()).toEqual([BOTTLES[0], BOTTLES[1], BOTTLES[2]].sort());
    const h = await history();
    expect(h).toHaveLength(4);
    const values = chain(h, [pair(BOTTLES[3])]);
    expect(values).toHaveLength(5);
    expect(values.at(-1)).toEqual(await stored());
  });

  it('SystemConfigService.update trên khoá chưa có dòng: hai lần gộp cùng lúc đều còn; lần ném lỗi không để lại dòng nào', async () => {
    const KEY = 'w10lock.update_probe';
    await prisma.systemConfig.deleteMany({ where: { key: KEY } });
    try {
      await expect(new SystemConfigService(prisma).update<string[]>(KEY, [], () => { throw new Error('không hợp lệ'); }, 'w10-lock-a')).rejects.toThrow('không hợp lệ');
      expect(await prisma.systemConfig.findUnique({ where: { key: KEY } })).toBeNull();

      const append = (item: string) => (current: unknown) => [...(current as string[]), item];
      await Promise.all([new SystemConfigService(prisma).update(KEY, [] as string[], append('a'), 'w10-lock-a'), new SystemConfigService(prisma).update(KEY, [] as string[], append('b'), 'w10-lock-b')]);
      const row = await prisma.systemConfig.findUniqueOrThrow({ where: { key: KEY } });
      expect([...(row.value as string[])].sort()).toEqual(['a', 'b']);
      expect(row.category).toBe('w10lock');
      // Lần tạo dòng không ghi lịch sử (như set() trên khoá mới); lần sau ghi một dòng từ bản lần đầu vừa ghi.
      const h = await prisma.systemConfigHistory.findMany({ where: { key: KEY }, select: { oldValue: true, newValue: true } });
      expect(h).toHaveLength(1);
      expect((h[0].oldValue as string[]).length).toBe(1);
      expect([...(h[0].newValue as string[])].sort()).toEqual(['a', 'b']);
    } finally {
      await prisma.systemConfigHistory.deleteMany({ where: { key: KEY } });
      await prisma.systemConfig.deleteMany({ where: { key: KEY } });
    }
  });

  it('một lần lưu sai (400) chạy cùng một lần lưu đúng: lần đúng vẫn ghi, lần sai không ghi gì', async () => {
    holdCatalogScans(2);
    const [a, b] = [apiProcess(), apiProcess()];
    const results = await Promise.allSettled([
      a.adminSave({ add: { bottleSlug: BOTTLES[0], refillSlug: 'refill-khong-co-w10lock' } }, 'w10-lock-a'),
      b.adminSave({ add: pair(BOTTLES[1]) }, 'w10-lock-b'),
    ]);

    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');
    expect(await stored()).toEqual([pair(BOTTLES[1])]);
    expect(await history()).toHaveLength(1);
  });
});
