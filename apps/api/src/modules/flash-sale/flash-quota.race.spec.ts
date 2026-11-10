import { flashClient, flashDb, ticks, withinMs, HOUR, T0 } from '../../../test/fakes/w97a-flash-harness';
import { FlashQuotaLineError, FlashSaleService, type FlashQuotaLine, type FlashQuotaOutcome } from './flash-sale.service';

/**
 * Giữ chỗ tồn kho Giờ vàng dưới tranh chấp (Postgres READ COMMITTED, xem test/fakes/race-db.fake.ts). FlashSaleService.consumeQuotas/restore THẬT chạy trong
 * transaction của cơ sở dữ liệu giả có khoá dòng + xét lại WHERE sau khoá: hai khách không bao giờ bán quá suất của đợt, một khách không bao giờ vượt giới hạn
 * mỗi khách, hoàn suất (huỷ đơn) không làm bộ đếm âm hay lệch sổ lượt mua của khách.
 */
const flash = new FlashSaleService({} as never, {} as never, {} as never, {} as never);

class Rejected extends Error {
  constructor(readonly outcomes: FlashQuotaOutcome[]) {
    super(`không giữ được suất: ${outcomes.join(',')}`);
  }
}

function setup(opts: Parameters<typeof flashDb>[0] = {}) {
  const db = flashDb(opts);
  const client = flashClient(db);
  /** Một lần đặt đơn thu nhỏ: trừ suất trong một transaction, ném khi có dòng hỏng như CheckoutService (cả đơn rollback). */
  const buy = async (userId: string, lines: readonly FlashQuotaLine[], o: { skew?: number; now?: Date } = {}): Promise<FlashQuotaOutcome[]> => {
    await ticks(o.skew ?? 0);
    return client.$transaction(async (tx: any) => {
      const outcomes = await flash.consumeQuotas(tx, userId, lines, o.now ?? T0);
      if (outcomes.some((x) => x !== 'OK')) throw new Rejected(outcomes);
      return outcomes;
    });
  };
  /** Huỷ một đơn đã giữ suất: hoàn suất trong transaction riêng. */
  const cancel = async (userId: string, itemId: string, qty: number, skew = 0): Promise<void> => {
    await ticks(skew);
    await client.$transaction((tx: any) => flash.restore(tx, itemId, userId, qty));
  };
  const item = (id = 'fi1') => db.row('flashSaleItem', id)!;
  const bought = (userId: string, itemId = 'fi1') => (db.rows('flashSalePurchase').find((p) => p.userId === userId && p.flashSaleItemId === itemId)?.quantity as number | undefined) ?? 0;
  const purchased = (itemId = 'fi1') => db.rows('flashSalePurchase').filter((p) => p.flashSaleItemId === itemId).reduce((s, p) => s + (p.quantity as number), 0);
  return { db, client, buy, cancel, item, bought, purchased };
}

const outcomeOf = (s: PromiseSettledResult<unknown>): string =>
  s.status === 'fulfilled' ? 'OK' : s.reason instanceof Rejected ? s.reason.outcomes.join(',') : s.reason instanceof FlashQuotaLineError ? `LỖI_HẠ_TẦNG:${s.reason.message}` : `LỖI:${String(s.reason)}`;

/** Lệch giờ giữa hai bên từ -N đến N nhịp: bên nào đến trước thì bên kia chen vào đủ mọi bước của transaction. */
const skews = Array.from({ length: 41 }, (_, i) => i - 20);
const lag = (skew: number) => [skew > 0 ? skew : 0, skew < 0 ? -skew : 0] as const;

describe('FlashSaleService.consumeQuotas — race', () => {
  it('hai khách mua suất cuối của đợt (lệch -20..20 nhịp): đúng một bên được giữ chỗ, bên kia SOLD_OUT và không để lại dòng lượt mua; không bán quá quota', async () => {
    let lockWaits = 0;
    for (const skew of skews) {
      const { db, buy, item, bought } = setup({ items: [{ quota: 1, perUserLimit: 5 }] });
      const [a, b] = lag(skew);
      const settled = await Promise.allSettled([buy('u1', [{ flashSaleItemId: 'fi1', quantity: 1 }], { skew: a }), buy('u2', [{ flashSaleItemId: 'fi1', quantity: 1 }], { skew: b })]);
      expect(settled.map(outcomeOf).sort()).toEqual(['OK', 'SOLD_OUT']);
      const winner = settled[0]!.status === 'fulfilled' ? 'u1' : 'u2';
      const loser = winner === 'u1' ? 'u2' : 'u1';
      expect(item().soldCount).toBe(1);
      expect(bought(winner)).toBe(1);
      expect(bought(loser)).toBe(0);
      expect(db.rows('flashSalePurchase')).toHaveLength(1);
      lockWaits += db.stats.lockWaits;
    }
    expect(lockWaits).toBeGreaterThan(0);
  });

  it('món của đợt đã kết thúc không bán được dù có đợt khác đang chạy: SOLD_OUT, bộ đếm không đổi (điều kiện nối món với đúng đợt của nó)', async () => {
    const { db, buy, item } = setup({
      sale: { id: 's-ended', startAt: new Date(T0.getTime() - 2 * HOUR), endAt: new Date(T0.getTime() - HOUR) },
      items: [{ quota: 5, perUserLimit: 5 }],
    });
    db.seed('flashSale', [{ id: 's-live', startAt: new Date(T0.getTime() - HOUR), endAt: new Date(T0.getTime() + HOUR), isActive: true }]);
    const settled = await Promise.allSettled([buy('u1', [{ flashSaleItemId: 'fi1', quantity: 1 }])]);
    expect(settled.map(outcomeOf)).toEqual(['SOLD_OUT']);
    expect(item().soldCount).toBe(0);
    expect(db.rows('flashSalePurchase')).toHaveLength(0);
  });

  it('ba khách tranh quota 3 với số lượng 2, 1, 1 (mọi cặp lệch giờ): tổng đã bán = tổng số lượng của các bên thắng, không quá 3, không bán nửa dòng', async () => {
    const qtys = [2, 1, 1];
    for (const skew of skews) {
      const { buy, item, bought, purchased } = setup({ items: [{ quota: 3, perUserLimit: 5 }] });
      const [a, b] = lag(skew);
      const settled = await Promise.allSettled([
        buy('u1', [{ flashSaleItemId: 'fi1', quantity: qtys[0]! }], { skew: a }),
        buy('u2', [{ flashSaleItemId: 'fi1', quantity: qtys[1]! }], { skew: b }),
        buy('u3', [{ flashSaleItemId: 'fi1', quantity: qtys[2]! }], { skew: Math.abs(skew) % 7 }),
      ]);
      const won = settled.flatMap((s, i) => (s.status === 'fulfilled' ? [i] : []));
      const soldByWinners = won.reduce((sum, i) => sum + qtys[i]!, 0);
      expect(soldByWinners).toBeLessThanOrEqual(3);
      expect(item().soldCount).toBe(soldByWinners);
      expect(purchased()).toBe(soldByWinners);
      settled.forEach((s, i) => {
        if (s.status === 'rejected') expect(outcomeOf(s)).toBe('SOLD_OUT');
        expect(bought(`u${i + 1}`)).toBe(s.status === 'fulfilled' ? qtys[i] : 0);
      });
    }
  });

  it('một khách đã có dòng lượt mua mà đặt hai đơn song song (giới hạn 3, đã mua 1, mỗi đơn 2): đúng một đơn qua, đơn kia OVER_LIMIT; quota chỉ trừ phần của đơn qua', async () => {
    let lockWaits = 0;
    for (const skew of skews) {
      const { db, buy, item, bought } = setup({ items: [{ quota: 10, perUserLimit: 3, soldCount: 1 }], purchases: [{ itemId: 'fi1', userId: 'u1', quantity: 1 }] });
      const [a, b] = lag(skew);
      const settled = await Promise.allSettled([buy('u1', [{ flashSaleItemId: 'fi1', quantity: 2 }], { skew: a }), buy('u1', [{ flashSaleItemId: 'fi1', quantity: 2 }], { skew: b })]);
      expect(settled.map(outcomeOf).sort()).toEqual(['OK', 'OVER_LIMIT']);
      expect(bought('u1')).toBe(3);
      expect(item().soldCount).toBe(3);
      lockWaits += db.stats.lockWaits;
    }
    expect(lockWaits).toBeGreaterThan(0);
  });

  it('một khách CHƯA có dòng lượt mua mà hai đơn song song (giới hạn 2, mỗi đơn 2): đúng một đơn qua, đơn kia OVER_LIMIT, không lỗi hạ tầng, quota chỉ trừ phần đơn qua', async () => {
    let lockWaits = 0;
    for (const skew of skews) {
      const { db, buy, item, bought, purchased } = setup({ items: [{ quota: 10, perUserLimit: 2 }] });
      const [a, b] = lag(skew);
      const settled = await Promise.allSettled([buy('u1', [{ flashSaleItemId: 'fi1', quantity: 2 }], { skew: a }), buy('u1', [{ flashSaleItemId: 'fi1', quantity: 2 }], { skew: b })]);
      expect(settled.map(outcomeOf).sort()).toEqual(['OK', 'OVER_LIMIT']);
      expect(bought('u1')).toBe(2);
      expect(purchased()).toBe(2);
      expect(item().soldCount).toBe(2);
      lockWaits += db.stats.lockWaits;
    }
    expect(lockWaits).toBeGreaterThan(0);
  });

  it('khách CHƯA có dòng lượt mua mà một đơn đã vượt giới hạn ngay lần đầu (giới hạn 2, mua 3): OVER_LIMIT, không tạo dòng lượt mua, quota hoàn nguyên', async () => {
    const { buy, item, purchased, db } = setup({ items: [{ quota: 10, perUserLimit: 2 }] });
    const [s] = await Promise.allSettled([buy('u1', [{ flashSaleItemId: 'fi1', quantity: 3 }])]);
    expect(outcomeOf(s!)).toBe('OVER_LIMIT');
    expect(item().soldCount).toBe(0);
    expect(purchased()).toBe(0);
    expect(db.rows('flashSalePurchase')).toHaveLength(0);
  });

  it('người gọi lỡ commit dù có dòng OVER_LIMIT: dòng bị từ chối đã tự hoàn quota nên không rò suất, dòng qua vẫn giữ đúng', async () => {
    const { client, item, bought } = setup({ items: [{ quota: 10, perUserLimit: 2 }, { quota: 10, perUserLimit: 2 }] });
    const outcomes = await client.$transaction((tx: any) =>
      flash.consumeQuotas(tx, 'u1', [
        { flashSaleItemId: 'fi1', quantity: 3 },
        { flashSaleItemId: 'fi2', quantity: 1 },
      ], T0),
    );
    expect(outcomes).toEqual(['OVER_LIMIT', 'OK']);
    expect(item('fi1').soldCount).toBe(0);
    expect(bought('u1', 'fi1')).toBe(0);
    expect(item('fi2').soldCount).toBe(1);
    expect(bought('u1', 'fi2')).toBe(1);
  });

  it('một khách CHƯA có dòng lượt mua mà hai đơn song song cùng nằm trong giới hạn (giới hạn 5, mỗi đơn 2): cả hai đều qua, lượt mua cộng dồn 4', async () => {
    for (const skew of skews) {
      const { buy, item, bought, purchased, db } = setup({ items: [{ quota: 10, perUserLimit: 5 }] });
      const [a, b] = lag(skew);
      const settled = await Promise.allSettled([buy('u1', [{ flashSaleItemId: 'fi1', quantity: 2 }], { skew: a }), buy('u1', [{ flashSaleItemId: 'fi1', quantity: 2 }], { skew: b })]);
      expect(settled.map(outcomeOf)).toEqual(['OK', 'OK']);
      expect(bought('u1')).toBe(4);
      expect(purchased()).toBe(4);
      expect(item().soldCount).toBe(4);
      expect(db.rows('flashSalePurchase')).toHaveLength(1);
    }
  });

  it('đơn nhiều dòng thất bại ở dòng sau thì rollback cả đơn: suất của dòng trước trả lại, không dòng lượt mua nào lọt', async () => {
    const { buy, item, db } = setup({ items: [{ quota: 5 }, { quota: 0 }] });
    const settled = await Promise.allSettled([
      buy('u1', [
        { flashSaleItemId: 'fi1', quantity: 2 },
        { flashSaleItemId: 'fi2', quantity: 1 },
      ]),
    ]);
    expect(outcomeOf(settled[0]!)).toBe('OK,SOLD_OUT');
    expect(item('fi1').soldCount).toBe(0);
    expect(item('fi2').soldCount).toBe(0);
    expect(db.rows('flashSalePurchase')).toHaveLength(0);
  });

  it('hai đơn nhiều dòng khoá suất theo thứ tự ngược nhau ([B,A] và [A,B]): không vòng chờ khoá, cả hai đều qua khi quota đủ', async () => {
    for (const skew of skews) {
      const { buy, item } = setup({ items: [{ quota: 5 }, { quota: 5 }] });
      const [a, b] = lag(skew);
      const settled = await withinMs(
        Promise.allSettled([
          buy('u1', [{ flashSaleItemId: 'fi2', quantity: 1 }, { flashSaleItemId: 'fi1', quantity: 1 }], { skew: a }),
          buy('u2', [{ flashSaleItemId: 'fi1', quantity: 1 }, { flashSaleItemId: 'fi2', quantity: 1 }], { skew: b }),
        ]),
        4000,
        'đặt đơn nhiều dòng',
      );
      expect(settled.map(outcomeOf)).toEqual(['OK', 'OK']);
      expect(item('fi1').soldCount).toBe(2);
      expect(item('fi2').soldCount).toBe(2);
    }
  });
});

describe('FlashSaleService.consumeQuotas — khung giờ của đợt', () => {
  const line = [{ flashSaleItemId: 'fi1', quantity: 1 }] as const;
  const run = async (opts: Parameters<typeof flashDb>[0], now: Date) => {
    const { buy, item } = setup(opts);
    const [s] = await Promise.allSettled([buy('u1', line, { now })]);
    return { outcome: outcomeOf(s!), sold: item().soldCount };
  };

  it('đúng mốc kết thúc là đã hết giờ (endAt > now), đúng mốc bắt đầu là đã mở (startAt <= now)', async () => {
    const sale = { startAt: new Date(T0.getTime() - HOUR), endAt: new Date(T0.getTime() + HOUR) };
    expect(await run({ sale }, new Date(sale.endAt.getTime() - 1))).toEqual({ outcome: 'OK', sold: 1 });
    expect(await run({ sale }, sale.endAt)).toEqual({ outcome: 'SOLD_OUT', sold: 0 });
    expect(await run({ sale }, new Date(sale.endAt.getTime() + 1))).toEqual({ outcome: 'SOLD_OUT', sold: 0 });
    expect(await run({ sale }, sale.startAt)).toEqual({ outcome: 'OK', sold: 1 });
    expect(await run({ sale }, new Date(sale.startAt.getTime() - 1))).toEqual({ outcome: 'SOLD_OUT', sold: 0 });
  });

  it('đợt bị tắt (isActive = false) giữa lúc khách xem giá và lúc đặt: SOLD_OUT, không trừ suất', async () => {
    expect(await run({ sale: { isActive: false } }, T0)).toEqual({ outcome: 'SOLD_OUT', sold: 0 });
  });

  it('suất không còn tồn tại (bị xoá khỏi đợt giữa lúc xem giá và lúc đặt): SOLD_OUT, không lỗi hạ tầng', async () => {
    const { buy } = setup({ items: [{ id: 'fi1' }] });
    const [s] = await Promise.allSettled([buy('u1', [{ flashSaleItemId: 'ghost', quantity: 1 }])]);
    expect(outcomeOf(s!)).toBe('SOLD_OUT');
  });

  it('đợt kết thúc đúng lúc một đơn đang giữ chỗ: đơn vào trước mốc thì thắng và giữ nguyên suất, đơn vào sau mốc thì SOLD_OUT', async () => {
    const endAt = new Date(T0.getTime() + HOUR);
    const { buy, item, bought } = setup({ sale: { endAt }, items: [{ quota: 5 }] });
    const settled = await Promise.allSettled([
      buy('u1', line, { now: new Date(endAt.getTime() - 1) }),
      buy('u2', line, { now: endAt, skew: 3 }),
      buy('u3', line, { now: new Date(endAt.getTime() + 60_000), skew: 6 }),
    ]);
    expect(settled.map(outcomeOf)).toEqual(['OK', 'SOLD_OUT', 'SOLD_OUT']);
    expect(item().soldCount).toBe(1);
    expect(bought('u1')).toBe(1);
  });
});

describe('FlashSaleService.restore — race', () => {
  it('huỷ đơn giữ suất cuối cùng lúc khách khác đặt (lệch -20..20 nhịp): bên mua mới thắng hay thua đều khớp, bộ đếm bằng tổng lượt mua, không âm', async () => {
    let bothSucceeded = 0;
    for (const skew of skews) {
      const { buy, cancel, item, bought, purchased } = setup({ items: [{ quota: 1, soldCount: 1 }], purchases: [{ itemId: 'fi1', userId: 'u1', quantity: 1 }] });
      const [a, b] = lag(skew);
      const settled = await Promise.allSettled([cancel('u1', 'fi1', 1, a), buy('u2', [{ flashSaleItemId: 'fi1', quantity: 1 }], { skew: b })]);
      expect(settled[0]!.status).toBe('fulfilled');
      const bWon = settled[1]!.status === 'fulfilled';
      if (!bWon) expect(outcomeOf(settled[1]!)).toBe('SOLD_OUT');
      expect(item().soldCount).toBe(bWon ? 1 : 0);
      expect(purchased()).toBe(item().soldCount);
      expect(bought('u1')).toBe(0);
      expect(bought('u2')).toBe(bWon ? 1 : 0);
      if (bWon) bothSucceeded += 1;
    }
    // Hai chiều đều xảy ra trong dải lệch giờ: có lần mua mới chen sau lần huỷ (thắng) và có lần chen trước (thua).
    expect(bothSucceeded).toBeGreaterThan(0);
    expect(bothSucceeded).toBeLessThan(skews.length);
  });

  it('hoàn nhiều hơn số đã bán: bộ đếm và lượt mua dừng ở 0, không âm, không đụng lượt mua của khách khác (restore không tự chống hoàn trùng một đơn, bên gọi chặn bằng CAS trạng thái đơn)', async () => {
    const { cancel, item, bought } = setup({
      items: [{ quota: 5, soldCount: 3 }],
      purchases: [
        { itemId: 'fi1', userId: 'u1', quantity: 2 },
        { itemId: 'fi1', userId: 'u2', quantity: 1 },
      ],
    });
    await cancel('u1', 'fi1', 2);
    await cancel('u1', 'fi1', 2);
    await cancel('u1', 'fi1', 9);
    expect(item().soldCount).toBe(1);
    expect(bought('u1')).toBe(0);
    expect(bought('u2')).toBe(1);
  });

  it('hai đơn của hai khách cùng suất huỷ cùng lúc: mỗi bên hoàn đúng phần của mình', async () => {
    for (const skew of skews) {
      const { cancel, item, bought } = setup({
        items: [{ quota: 5, soldCount: 5 }],
        purchases: [
          { itemId: 'fi1', userId: 'u1', quantity: 3 },
          { itemId: 'fi1', userId: 'u2', quantity: 2 },
        ],
      });
      const [a, b] = lag(skew);
      await Promise.all([cancel('u1', 'fi1', 3, a), cancel('u2', 'fi1', 2, b)]);
      expect(item().soldCount).toBe(0);
      expect(bought('u1')).toBe(0);
      expect(bought('u2')).toBe(0);
    }
  });
});

describe('FlashSaleService.removeItem — race với đặt đơn', () => {
  it('admin xoá món đúng lúc khách mua suất đầu tiên (lệch -20..20 nhịp): hoặc món bị xoá và khách SOLD_OUT, hoặc khách mua được và món ở lại; không bao giờ mất món đã có đơn', async () => {
    let removed = 0;
    let kept = 0;
    for (const skew of skews) {
      const { db, client, buy } = setup({ items: [{ quota: 5, perUserLimit: 5 }] });
      const service = new FlashSaleService(client as never, {} as never, {} as never, {} as never);
      const [a, b] = lag(skew);
      const [rm, bought] = await Promise.allSettled([
        (async () => {
          await ticks(a);
          return service.removeItem('fi1');
        })(),
        buy('u1', [{ flashSaleItemId: 'fi1', quantity: 1 }], { skew: b }),
      ]);
      const item = db.row('flashSaleItem', 'fi1');
      if (rm.status === 'fulfilled') {
        removed += 1;
        expect(item).toBeFalsy();
        expect(outcomeOf(bought!)).toBe('SOLD_OUT');
        expect(db.rows('flashSalePurchase')).toHaveLength(0);
      } else {
        kept += 1;
        expect(item).toMatchObject({ soldCount: bought!.status === 'fulfilled' ? 1 : 0 });
        expect(String(rm.reason.message)).toContain('đã phát sinh đơn');
        expect(bought!.status).toBe('fulfilled');
      }
    }
    expect(removed).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  });

  it('hai admin xoá cùng một món chưa bán (lệch -20..20 nhịp): đúng một bên xoá được, bên kia nhận "không tìm thấy" chứ không phải "đã phát sinh đơn"', async () => {
    for (const skew of skews) {
      const { db, client } = setup({ items: [{ quota: 5, soldCount: 0 }] });
      const service = new FlashSaleService(client as never, {} as never, {} as never, {} as never);
      const [a, b] = lag(skew);
      const remove = async (n: number) => (await ticks(n), service.removeItem('fi1'));
      const settled = await Promise.allSettled([remove(a), remove(b)]);
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
      const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')!;
      expect(String(failed.reason.message)).toBe('Không tìm thấy sản phẩm flash.');
      expect(db.row('flashSaleItem', 'fi1')).toBeFalsy();
    }
  });

  it('món đã bán (soldCount > 0) không xoá được; món không tồn tại báo không tìm thấy', async () => {
    const { client } = setup({ items: [{ quota: 5, soldCount: 1 }] });
    const service = new FlashSaleService(client as never, {} as never, {} as never, {} as never);
    await expect(service.removeItem('fi1')).rejects.toThrow('đã phát sinh đơn');
    await expect(service.removeItem('ghost')).rejects.toThrow('Không tìm thấy sản phẩm flash.');
  });
});
