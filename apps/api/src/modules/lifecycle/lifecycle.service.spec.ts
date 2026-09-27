import { LifecycleService } from './lifecycle.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';

const config = {
  get: async <T>(_k: string, fb?: T): Promise<T> => fb as T,
} as unknown as SystemConfigService;

function setup(rows: unknown[], existing: unknown = null, claimedCount = 1) {
  const queryRaw = jest.fn().mockResolvedValue(rows);
  const findUnique = jest.fn().mockResolvedValue(existing);
  const create = jest.fn().mockResolvedValue({});
  const updateMany = jest.fn().mockResolvedValue({ count: claimedCount });
  const prisma = {
    $queryRaw: queryRaw,
    reorderReminder: { findUnique, create, updateMany },
  } as unknown as PrismaService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const notifications = { notify } as unknown as NotificationsService;
  return { svc: new LifecycleService(prisma, config, notifications), create, updateMany, notify, findUnique, queryRaw };
}

const row = (over: Record<string, unknown> = {}) => ({
  userId: 'u1',
  variationId: 'v1',
  productName: 'Dầu gội Visante 500ml',
  productSlug: 'dau-goi-visante-500ml',
  lastOrderAt: new Date('2026-04-01'),
  ...over,
});

describe('LifecycleService.sendReorderReminders (§6.14.7)', () => {
  it('sản phẩm tới hạn, chưa từng nhắc → notify kèm slug + variationId (CTA "Mua lại ngay" cần để dựng link /product/:slug — A1-01=A2-06=A3-02)', async () => {
    const { svc, create, notify } = setup([row()], null);
    await svc.sendReorderReminders();
    expect(notify).toHaveBeenCalledWith('u1', 'REORDER_REMINDER', {
      product: 'Dầu gội Visante 500ml',
      product_slug: 'dau-goi-visante-500ml',
      variation_id: 'v1',
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.remindedAt).toBeInstanceOf(Date);
  });

  it('đơn cũ không có productSlug (nullable, trước khi OrderItem có cột này) → payload BỎ QUA field product_slug thay vì gửi chuỗi rỗng', async () => {
    const { svc, notify } = setup([row({ productSlug: null })], null);
    await svc.sendReorderReminders();
    expect(notify).toHaveBeenCalledWith('u1', 'REORDER_REMINDER', { product: 'Dầu gội Visante 500ml', variation_id: 'v1' });
    const data = notify.mock.calls[0][2] as Record<string, string>;
    expect(data).not.toHaveProperty('product_slug');
  });

  it('mặc định (SystemConfig chưa cấu hình reorder.*) → ngưỡng nhắc nằm TRONG cửa sổ 30 ngày, không trễ hơn (A1-01=A2-06=A3-02: mặc định cũ 60×0,85≈51 ngày đã trễ hơn cửa sổ)', async () => {
    const { svc, queryRaw } = setup([]);
    await svc.sendReorderReminders();
    // threshold là tham số đầu tiên nội suy vào $queryRaw (sau mảng strings) — xem HAVING MAX(...) <= ${threshold}.
    const threshold = queryRaw.mock.calls[0]![1] as Date;
    const daysAgo = (Date.now() - threshold.getTime()) / 864e5;
    expect(daysAgo).toBeLessThanOrEqual(30); // KHÔNG được trễ hơn cửa sổ 30 ngày
    expect(daysAgo).toBeGreaterThanOrEqual(20); // vẫn đủ gần cửa sổ 30 ngày (không quá sớm/vô nghĩa)
  });

  it('đã nhắc sau đơn cuối (remindedAt >= lastOrderAt) → KHÔNG nhắc lại (chống spam)', async () => {
    const { svc, notify, create, updateMany } = setup([row({ lastOrderAt: new Date('2026-04-01') })], {
      remindedAt: new Date('2026-04-20'), // đã nhắc sau đơn cuối
    });
    await svc.sendReorderReminders();
    expect(notify).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('có đơn MỚI hơn lần nhắc trước (remindedAt < lastOrderAt) → nhắc lại (claim qua updateMany)', async () => {
    const { svc, notify, updateMany } = setup([row({ lastOrderAt: new Date('2026-06-01') })], {
      remindedAt: new Date('2026-04-20'), // nhắc cũ, đã có đơn mới 06-01
    });
    await svc.sendReorderReminders();
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('không có sản phẩm tới hạn → không làm gì', async () => {
    const { svc, notify, create } = setup([]);
    await svc.sendReorderReminders();
    expect(notify).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('2 cron instance chạy chồng, đã có bản ghi: claim updateMany count=0 → bỏ qua, không notify (chống double-send)', async () => {
    const { svc, notify, updateMany } = setup(
      [row({ lastOrderAt: new Date('2026-06-01') })],
      { remindedAt: new Date('2026-04-20') },
      0,
    );
    await svc.sendReorderReminders();
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('2 cron instance chạy chồng, lần đầu nhắc: create race → P2002 → bỏ qua, không notify (chống double-send)', async () => {
    const { svc, notify, create } = setup([row()], null);
    create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    await svc.sendReorderReminders();
    expect(notify).not.toHaveBeenCalled();
  });

  it('claim rồi gửi lỗi thật (lần đầu nhắc, đường create) → xoá remindedAt để lượt sau thử lại', async () => {
    // Trước sửa: .catch(() => undefined) nuốt lỗi mà KHÔNG trả remindedAt lại — sản phẩm này
    // vĩnh viễn không được nhắc mua lại nữa (guard đầu hàm coi remindedAt đã set là "đã nhắc").
    const { svc, updateMany, notify } = setup([row()], null);
    notify.mockRejectedValue(new Error('DB timeout khi ghi notificationLog'));
    await svc.sendReorderReminders();
    expect(updateMany).toHaveBeenCalledTimes(1); // revert (create không đi qua updateMany)
    expect(updateMany.mock.calls[0]![0].data.remindedAt).toBeNull();
  });

  it('claim rồi gửi lỗi thật (đã có bản ghi, đường update) → xoá remindedAt để lượt sau thử lại', async () => {
    const { svc, updateMany, notify } = setup(
      [row({ lastOrderAt: new Date('2026-06-01') })],
      { remindedAt: new Date('2026-04-20') },
    );
    notify.mockRejectedValue(new Error('DB timeout khi ghi notificationLog'));
    await svc.sendReorderReminders();
    expect(updateMany).toHaveBeenCalledTimes(2); // claim rồi revert
    expect(updateMany.mock.calls[1]![0].data.remindedAt).toBeNull();
  });
});

describe('LifecycleService.sendReorderReminders — FIX 2 (A2-07=A3-03=A6-31): cron không còn tự dừng vĩnh viễn khi backlog > 500', () => {
  const bigBatch = (n: number, offset = 0) =>
    Array.from({ length: n }, (_, i) =>
      row({ userId: `u${offset + i}`, variationId: `v${offset + i}`, productSlug: `slug-${offset + i}` }),
    );

  it('câu SQL ORDER BY theo mức quá hạn + loại cặp ĐÃ NHẮC (reorder_reminders.remindedAt) ngay trong truy vấn — trước đây không ORDER BY và chỉ lọc ở JS sau khi fetch, nên LIMIT có thể toàn cặp cũ', async () => {
    const { svc, queryRaw } = setup([]);
    await svc.sendReorderReminders();
    const sqlText = (queryRaw.mock.calls[0]![0] as unknown as string[]).join('?');
    expect(sqlText).toMatch(/ORDER BY/);
    expect(sqlText).toMatch(/reorder_reminders/);
    expect(sqlText).toMatch(/remindedAt/);
  });

  it('backlog 600 cặp quá hạn (> BATCH_SIZE=500) → 1 lượt chỉ THỰC SỰ xử lý 500 (không kéo dài job vô hạn)', async () => {
    const { svc, notify } = setup(bigBatch(600), null);
    await svc.sendReorderReminders();
    expect(notify).toHaveBeenCalledTimes(500);
  });

  it('lượt cron kế tiếp (SQL thật đã loại 500 cặp vừa ghi remindedAt) → tiếp tục xử lý phần CÒN LẠI ngoài 500 dòng đầu, khách mới không bị bỏ quên vĩnh viễn (đây chính là bug A2-07=A3-03=A6-31)', async () => {
    const batch1 = bigBatch(500, 0); // lượt 1: 500 cặp quá hạn nhất hiện có
    const batch2 = bigBatch(100, 500); // lượt 2 (cron ngày mai): remindedAt vừa ghi ở lượt 1 đã loại 500 cặp đó khỏi HAVING → SQL trả tiếp 100 cặp còn lại
    const { svc, notify, queryRaw } = setup([]);
    queryRaw.mockReset();
    queryRaw.mockResolvedValueOnce(batch1).mockResolvedValueOnce(batch2);

    await svc.sendReorderReminders(); // lượt 1
    expect(notify).toHaveBeenCalledTimes(500);
    const remindedInRun1 = new Set(notify.mock.calls.map((c) => c[0] as string));

    await svc.sendReorderReminders(); // lượt 2 — TRƯỚC KHI SỬA: sẽ nhận lại cùng LIMIT 500 tuỳ ý, không bao giờ tới 100 cặp mới này
    expect(notify).toHaveBeenCalledTimes(600); // 500 (lượt 1) + 100 (lượt 2) — tiến triển thật, không dừng ở 500
    const newlyReminded = notify.mock.calls.slice(500).map((c) => c[0] as string);
    expect(newlyReminded).toHaveLength(100);
    // Không cặp nào ở lượt 2 trùng với cặp đã xử lý ở lượt 1 (chống nhắc lại cặp đã nhắc).
    for (const userId of newlyReminded) expect(remindedInRun1.has(userId)).toBe(false);
  });
});

describe('LifecycleService.notifyWishlistPriceDrop (§6.14.10)', () => {
  function setupWishlist(users: string[]) {
    const findMany = jest.fn().mockResolvedValue(users.map((userId) => ({ userId })));
    const prisma = { wishlist: { findMany } } as unknown as PrismaService;
    const notify = jest.fn().mockResolvedValue(undefined);
    const notifications = { notify } as unknown as NotificationsService;
    return { svc: new LifecycleService(prisma, config, notifications), notify };
  }

  it('báo cho tất cả user đã wishlist sản phẩm', async () => {
    const { svc, notify } = setupWishlist(['u1', 'u2']);
    await svc.notifyWishlistPriceDrop('p1', 'Tinh dầu tràm');
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith('u1', 'PRICE_DROP_ALERT', { product: 'Tinh dầu tràm' });
    expect(notify).toHaveBeenCalledWith('u2', 'PRICE_DROP_ALERT', { product: 'Tinh dầu tràm' });
  });

  it('không ai wishlist → không báo', async () => {
    const { svc, notify } = setupWishlist([]);
    await svc.notifyWishlistPriceDrop('p1', 'X');
    expect(notify).not.toHaveBeenCalled();
  });
});
