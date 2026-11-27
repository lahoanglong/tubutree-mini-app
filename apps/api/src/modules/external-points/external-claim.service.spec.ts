import { HttpException } from '@nestjs/common';
import { PHONE_CONFIRM_RESULTS, PHONE_CONFIRMED_NOTE } from './external-claim.rules';
import { ExternalClaimService, LOCK_COUNTED_RESULTS } from './external-claim.service';

const NOW = new Date();
const flagOn = { 'loyalty.marketplace_claim_enabled': true };

function build(
  opts: { config?: Record<string, unknown>; order?: Record<string, unknown> | null; user?: Record<string, unknown> | null; appOrder?: boolean; deliveredAppOrders?: number } = {},
) {
  const calls: string[] = [];
  const attemptCreate = jest.fn(async () => ({}));
  const tx = {
    $executeRaw: jest.fn(async () => {
      calls.push('lock');
      return 1;
    }),
    $queryRaw: jest.fn(async () => {
      calls.push('rowlock');
      return [];
    }),
    user: {
      findUnique: jest.fn(async () =>
        opts.user === undefined
          ? { id: 'u1', phone: '0912345678', phoneVerifiedAt: NOW, zaloId: 'z1', isBlocked: false, role: 'CUSTOMER' }
          : opts.user,
      ),
    },
    externalClaimAttempt: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      create: attemptCreate,
      createMany: jest.fn(async () => ({ count: 1 })),
      findFirst: jest.fn(async () => null as unknown),
      findUnique: jest.fn(async () => null as unknown),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    externalClaimEvent: { create: jest.fn(async () => ({})) },
    analyticsEvent: { create: jest.fn(async () => ({})) },
    order: { findFirst: jest.fn(async () => (opts.appOrder ? { id: 'o1' } : null)), count: jest.fn(async () => opts.deliveredAppOrders ?? 0) },
    externalOrder: {
      findFirst: jest.fn(async () => (opts.order ? { id: 'x1' } : null)),
      findUniqueOrThrow: jest.fn(async () => opts.order),
    },
    externalPointsClaim: {
      findUnique: jest.fn(async () => null as unknown),
      findUniqueOrThrow: jest.fn(async () => ({ points: 2_000, releaseAt: null })),
      findMany: jest.fn(async () => [] as unknown[]),
      count: jest.fn(async () => 0),
      aggregate: jest.fn(async () => ({ _sum: { points: 0 } })),
      createManyAndReturn: jest.fn(async () => [{ id: 'c1' }]),
    },
  };
  const prisma = { ...tx, $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  const config = { get: jest.fn(async (k: string, d: unknown) => (opts.config && k in opts.config ? opts.config[k] : d)) };
  const lookup = { lookupAndIngest: jest.fn(async () => false) };
  const notifications = { notify: jest.fn(async () => undefined) };
  const svc = new ExternalClaimService(prisma as never, config as never, lookup as never, notifications as never);
  return { svc, tx, calls, lookup, notifications, attemptCreate };
}

const order = (over: Record<string, unknown> = {}) => ({
  id: 'x1',
  pancakeOrderId: 'P1',
  source: 'MARKETPLACE',
  channel: 'shopee',
  status: 'OPEN',
  trackingCode: 'SPXVN0123456789',
  trackingCodes: ['SPXVN0123456789'],
  marketplaceOrderSn: null,
  goodsValue: 200_000,
  // Sàn che SĐT người mua (W42): mẫu khớp SĐT Zalo 0912345678 của khách trong build().
  phone: null,
  phoneMask: '091*****78',
  phoneLast3: '678',
  pancakeInsertedAt: new Date(NOW.getTime() - 864e5),
  firstSeenAt: NOW,
  deliveredAt: null,
  ...over,
});

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return ((e as HttpException).getResponse() as { code: string }).code;
  }
};

describe('ExternalClaimService.submit: sự kiện phễu ext_claim_submitted', () => {
  const evt = (tx: { analyticsEvent: { create: jest.Mock } }) => tx.analyticsEvent.create.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
  it('CLAIMED: ghi một sự kiện máy chủ kèm kênh, điểm, via', async () => {
    const { svc, tx } = build({ config: flagOn, order: order() });
    await svc.submit('u1', 'SPXVN0123456789', 'scan');
    expect(evt(tx)).toEqual([
      expect.objectContaining({ eventName: 'ext_claim_submitted', userId: 'u1', platform: 'system', props: { via: 'scan', result: 'CLAIMED', channel: 'shopee', points: 10_000 } }),
    ]);
  });
  it('SEARCHING và REVIEW', async () => {
    const a = build({ config: flagOn, order: null });
    await a.svc.submit('u1', 'SPXVN0123456789');
    expect(evt(a.tx)[0]).toMatchObject({ props: { result: 'SEARCHING' } });
    const b = build({ config: flagOn, order: order({ goodsValue: null }) });
    await b.svc.submit('u1', 'SPXVN0123456789', 'typed');
    expect(evt(b.tx)[0]).toMatchObject({ props: { via: 'typed', result: 'REVIEW' } });
  });
  it('từ chối nghiệp vụ vẫn ghi REJECT_<mã> (transaction vẫn commit)', async () => {
    const { svc, tx } = build({ config: flagOn, order: null, appOrder: true });
    await codeOf(svc.submit('u1', 'SPXVN0123456789'));
    expect(evt(tx)[0]).toMatchObject({ props: { result: 'REJECT_APP_ORDER' } });
  });
  it('mã sai dạng hoặc cờ tắt: không ghi gì', async () => {
    const { svc, tx } = build({ config: flagOn });
    await codeOf(svc.submit('u1', 'abc'));
    expect(tx.analyticsEvent.create).not.toHaveBeenCalled();
  });
  it('ghi lỗi thì cả transaction lỗi (không có ngoại lệ nuốt)', async () => {
    const { svc, tx } = build({ config: flagOn, order: order() });
    tx.analyticsEvent.create.mockRejectedValueOnce(new Error('boom'));
    await expect(svc.submit('u1', 'SPXVN0123456789')).rejects.toThrow('boom');
  });
});

describe('ExternalClaimService.submit', () => {
  it('cờ tắt: 404 DISABLED ngay, không chạm DB', async () => {
    const { svc, tx } = build();
    expect(await codeOf(svc.submit('u1', 'SPXVN0123456789'))).toBe('DISABLED');
    expect(tx.externalOrder.findFirst).not.toHaveBeenCalled();
  });
  it('mã sai dạng: 400 INVALID_CODE trước khi khoá', async () => {
    const { svc, calls } = build({ config: flagOn });
    expect(await codeOf(svc.submit('u1', 'abc'))).toBe('INVALID_CODE');
    expect(calls).toEqual([]);
  });
  it('khoá advisory theo khách lấy TRƯỚC mọi truy vấn luật; khoá dòng đơn trước khi đọc claim', async () => {
    const { svc, calls, tx } = build({ config: flagOn, order: order() });
    const res = await svc.submit('u1', ' spx-vn0123456789 ');
    expect(calls).toEqual(['lock', 'rowlock']);
    expect(tx.user.findUnique.mock.invocationCallOrder[0]!).toBeGreaterThan(tx.$executeRaw.mock.invocationCallOrder[0]!);
    expect(res).toMatchObject({ status: 'CLAIMED', points: 10_000, channel: 'shopee', maskedCode: 'SPX*********789', expectedCreditAt: null });
    expect(tx.externalPointsClaim.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true, data: [expect.objectContaining({ userId: 'u1', state: 'PENDING', points: 10_000, countsForTier: false, claimedCode: 'SPXVN0123456789', multiplier: 1 })] }),
    );
  });
  it('không thấy đơn: tra Pancake ngoài transaction, rồi ghi attempt UNMATCHED và trả SEARCHING', async () => {
    const { svc, lookup, tx } = build({ config: flagOn, order: null });
    const res = await svc.submit('u1', 'SPXVN0123456789');
    expect(lookup.lookupAndIngest).toHaveBeenCalledWith('SPXVN0123456789', expect.any(Date));
    expect(res.status).toBe('SEARCHING');
    expect(tx.externalClaimAttempt.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true, data: [expect.objectContaining({ result: 'UNMATCHED', userId: 'u1' })] }));
  });
  it('mã trùng đơn trong Mini App: 409 APP_ORDER, và attempt được ghi (không tra Pancake vì đã có mã app)', async () => {
    const { svc, attemptCreate } = build({ config: flagOn, order: null, appOrder: true });
    expect(await codeOf(svc.submit('u1', 'SPXVN0123456789'))).toBe('APP_ORDER');
    expect(attemptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ result: 'REJECTED_APP_ORDER' }) });
  });
  it('khách không có SĐT: 403 NOT_ELIGIBLE_USER và không ghi attempt', async () => {
    const { svc, attemptCreate } = build({ config: flagOn, order: order(), user: { id: 'u1', phone: null, zaloId: 'guest_x', isBlocked: false } });
    expect(await codeOf(svc.submit('u1', 'SPXVN0123456789'))).toBe('NOT_ELIGIBLE_USER');
    expect(attemptCreate).not.toHaveBeenCalled();
  });
  it('đơn thiếu tiền hàng: vào REVIEW, không báo PENDING cho khách', async () => {
    const { svc, notifications } = build({ config: flagOn, order: order({ goodsValue: null }) });
    const res = await svc.submit('u1', 'SPXVN0123456789');
    expect(res).toMatchObject({ status: 'REVIEW', points: null });
    expect(notifications.notify).not.toHaveBeenCalled();
  });
  it('W46: SĐT trên đơn lệch SĐT khách: 403 PHONE_CONFIRM_REQUIRED (thay PHONE_MISMATCH), ghi attempt REQUIRED, không tạo claim', async () => {
    const { svc, tx, attemptCreate } = build({ config: flagOn, order: order({ phoneMask: '098*****26' }) });
    let status = 0;
    try {
      await svc.submit('u1', 'SPXVN0123456789');
    } catch (e) {
      status = e instanceof HttpException ? e.getStatus() : -1;
    }
    expect(status).toBe(403);
    expect(attemptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ result: 'REJECTED_PHONE_CONFIRM_REQUIRED', userId: 'u1', externalOrderId: 'x1' }) });
    expect(tx.externalPointsClaim.createManyAndReturn).not.toHaveBeenCalled();
  });
  it('W42/W46: lần lệch SĐT (cũ và mới) và lần nhập sai 4 số tính vào khoá 24h cùng lần không tìm thấy', async () => {
    const { svc, tx } = build({ config: flagOn, order: order() });
    await svc.submit('u1', 'SPXVN0123456789');
    expect(tx.externalClaimAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          result: {
            in: ['UNMATCHED', 'NOT_FOUND', 'REJECTED_PHONE_MISMATCH', 'REJECTED_NOT_ELIGIBLE_USER', 'REJECTED_PHONE_CONFIRM_REQUIRED', 'REJECTED_PHONE_CONFIRM_WRONG'],
          },
        }),
      }),
    );
  });
  it('W42: đơn chỉ có số đầy đủ khớp: PENDING; đơn không có SĐT nào: REVIEW', async () => {
    const full = build({ config: flagOn, order: order({ phone: '0912345678', phoneMask: null }) });
    expect(await full.svc.submit('u1', 'SPXVN0123456789')).toMatchObject({ status: 'CLAIMED' });
    const none = build({ config: flagOn, order: order({ phone: null, phoneMask: null }) });
    expect(await none.svc.submit('u1', 'SPXVN0123456789')).toMatchObject({ status: 'REVIEW' });
    expect(none.notifications.notify).not.toHaveBeenCalled();
  });
  it('thành công: gửi EXTERNAL_POINTS_PENDING với dedupeKey theo claim', async () => {
    const { svc, notifications } = build({ config: flagOn, order: order() });
    await svc.submit('u1', 'SPXVN0123456789');
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'EXTERNAL_POINTS_PENDING', { points: '10.000', code: 'SPX*********789' }, { dedupeKey: 'ext-pending:c1' });
  });
  it('mã đã có claim (createMany trả rỗng): 409 ALREADY_CLAIMED và ghi attempt', async () => {
    const { svc, tx, attemptCreate } = build({ config: flagOn, order: order() });
    tx.externalPointsClaim.createManyAndReturn.mockResolvedValue([]);
    expect(await codeOf(svc.submit('u1', 'SPXVN0123456789'))).toBe('ALREADY_CLAIMED');
    expect(attemptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ result: 'REJECTED_ALREADY_CLAIMED' }) });
  });
  it('nhân viên tự gửi mã: vào REVIEW, không báo PENDING', async () => {
    const { svc, notifications } = build({ config: flagOn, order: order(), user: { id: 'u1', phone: '0912345678', phoneVerifiedAt: NOW, zaloId: 'z1', isBlocked: false, role: 'STAFF' } });
    expect(await svc.submit('u1', 'SPXVN0123456789')).toMatchObject({ status: 'REVIEW' });
    expect(notifications.notify).not.toHaveBeenCalled();
  });
  it('ghi nhật ký CLAIM_CREATED cùng transaction với claim', async () => {
    const { svc, tx } = build({ config: flagOn, order: order() });
    await svc.submit('u1', 'SPXVN0123456789');
    expect(tx.externalClaimEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ claimId: 'c1', action: 'CLAIM_CREATED', actorId: 'u1', toState: 'PENDING', userIdAfter: 'u1' }) });
  });
  it('C5: đơn khác cùng mã đã có claim còn hiệu lực: 409 ALREADY_CLAIMED, không tạo claim', async () => {
    const { svc, tx } = build({ config: flagOn, order: order() });
    tx.externalPointsClaim.findMany.mockResolvedValue([{ externalOrder: { marketplaceOrderSn: null } }]);
    expect(await codeOf(svc.submit('u1', 'SPXVN0123456789'))).toBe('ALREADY_CLAIMED');
    expect(tx.externalPointsClaim.createManyAndReturn).not.toHaveBeenCalled();
    expect(tx.externalPointsClaim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ state: { not: 'VOIDED' }, externalOrderId: { not: 'x1' } }) }),
    );
  });
  it('C5: đơn khác có order_sn khác (chung vận đơn) không chặn; cùng order_sn thì chặn', async () => {
    const a = build({ config: flagOn, order: order({ marketplaceOrderSn: 'SN1' }) });
    a.tx.externalPointsClaim.findMany.mockResolvedValue([{ externalOrder: { marketplaceOrderSn: 'SN2' } }]);
    expect((await a.svc.submit('u1', 'SPXVN0123456789')).status).toBe('CLAIMED');
    const b = build({ config: flagOn, order: order({ marketplaceOrderSn: 'SN1' }) });
    b.tx.externalPointsClaim.findMany.mockResolvedValue([{ externalOrder: { marketplaceOrderSn: 'SN1' } }]);
    expect(await codeOf(b.svc.submit('u1', 'SPXVN0123456789'))).toBe('ALREADY_CLAIMED');
  });
  it('C2: gửi lại mã của chính mình trả trạng thái hiện có, không ghi attempt, không tạo claim', async () => {
    const { svc, tx, attemptCreate } = build({ config: flagOn, order: order() });
    tx.externalPointsClaim.findUnique.mockResolvedValue({ id: 'c7', state: 'PENDING', claimedCode: 'SPXVN0123456789', decidedById: null, userId: 'u1' });
    const res = await svc.submit('u1', 'SPXVN0123456789');
    expect(res).toMatchObject({ status: 'CLAIMED', claimId: 'c7', points: 2_000 });
    expect(attemptCreate).not.toHaveBeenCalled();
    expect(tx.externalPointsClaim.createManyAndReturn).not.toHaveBeenCalled();
  });
  it('C2: claim của người khác vẫn là ALREADY_CLAIMED', async () => {
    const { svc, tx } = build({ config: flagOn, order: order() });
    tx.externalPointsClaim.findUnique.mockResolvedValue({ id: 'c7', state: 'PENDING', claimedCode: 'X', decidedById: null, userId: 'u2' });
    expect(await codeOf(svc.submit('u1', 'SPXVN0123456789'))).toBe('ALREADY_CLAIMED');
  });
  it('C2: mã đang chờ ghép là của chính khách: SEARCHING, không ghi NOT_FOUND (không tính khoá 24h)', async () => {
    const { svc, tx, attemptCreate } = build({ config: flagOn, order: null });
    tx.externalClaimAttempt.createMany.mockResolvedValue({ count: 0 });
    tx.externalClaimAttempt.findFirst.mockResolvedValue({ userId: 'u1' });
    expect((await svc.submit('u1', 'SPXVN0123456789')).status).toBe('SEARCHING');
    expect(attemptCreate).not.toHaveBeenCalled();
  });
  it('C2: mã đang chờ của người khác: vẫn ghi NOT_FOUND', async () => {
    const { svc, tx, attemptCreate } = build({ config: flagOn, order: null });
    tx.externalClaimAttempt.createMany.mockResolvedValue({ count: 0 });
    tx.externalClaimAttempt.findFirst.mockResolvedValue({ userId: 'u2' });
    await svc.submit('u1', 'SPXVN0123456789');
    expect(attemptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ result: 'NOT_FOUND' }) });
  });
});

describe('ExternalClaimService.rematchOne', () => {
  const rematch = (svc: ExternalClaimService) => (svc as unknown as { rematchOne: (id: string, cfg: unknown, now: Date) => Promise<string> }).rematchOne('a1', { ...cfgOn }, NOW);
  const cfgOn = { enabled: true, earnPct: 1, dailyAttempts: 10, dailyMax: 3, monthlyPointsCap: 200_000, maxAgeDays: 60, reviewAboveVnd: 2_000_000, pendingDays: 14, externalSince: null };
  it('C3: gặp ALREADY_CLAIMED với claim của chính khách: đóng lần thử, KHÔNG báo "chưa tìm thấy"', async () => {
    const { svc, tx, notifications } = build({ config: flagOn, order: order() });
    tx.externalClaimAttempt.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', code: 'SPXVN0123456789', result: 'UNMATCHED', externalOrderId: null, resolvedAt: null });
    tx.externalOrder.findFirst.mockResolvedValue({ id: 'x1' });
    tx.externalPointsClaim.findUnique.mockResolvedValue({ id: 'c7', state: 'VOIDED', claimedCode: 'X', decidedById: 'adm', userId: 'u1' });
    expect(await rematch(svc)).toBe('RESOLVED');
    expect(notifications.notify).not.toHaveBeenCalled();
  });
  it('claim của người khác: vẫn báo khách chưa tìm thấy', async () => {
    const { svc, tx, notifications } = build({ config: flagOn, order: order() });
    tx.externalClaimAttempt.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', code: 'SPXVN0123456789', result: 'UNMATCHED', externalOrderId: null, resolvedAt: null });
    tx.externalOrder.findFirst.mockResolvedValue({ id: 'x1' });
    tx.externalPointsClaim.findUnique.mockResolvedValue({ id: 'c7', state: 'PENDING', claimedCode: 'X', decidedById: null, userId: 'u2' });
    expect(await rematch(svc)).toBe('RESOLVED');
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'EXTERNAL_POINTS_CLAIM_NOT_FOUND', expect.anything(), expect.anything());
  });

  describe('khe đua: lượt chờ của người khác biến mất giữa createMany và findFirst', () => {
    it('findFirst ra null: thử createMany lại một lần, ghi được thì SEARCHING và không ghi NOT_FOUND', async () => {
      const { svc, tx } = build({ config: flagOn });
      tx.externalClaimAttempt.createMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
      const res = await svc.submit('u1', 'SPXVN0123456789');
      expect(res.status).toBe('SEARCHING');
      expect(tx.externalClaimAttempt.createMany).toHaveBeenCalledTimes(2);
      expect(tx.externalClaimAttempt.create).not.toHaveBeenCalled();
    });

    it('thử lại vẫn không ghi được và không thấy ai đang chờ: ghi NOT_FOUND và trả CLAIMED_BY_OTHER', async () => {
      const { svc, tx, attemptCreate } = build({ config: flagOn });
      tx.externalClaimAttempt.createMany.mockResolvedValue({ count: 0 });
      const res = await svc.submit('u1', 'SPXVN0123456789');
      expect(res.status).toBe('CLAIMED_BY_OTHER');
      expect(tx.externalClaimAttempt.createMany).toHaveBeenCalledTimes(2);
      expect(attemptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ result: 'NOT_FOUND' }) });
    });
  });

});

describe('ExternalClaimService.submit: SĐT liên hệ tự gõ trên Web, chưa xác minh qua Zalo (W45)', () => {
  const webUser = { id: 'u1', phone: '0912345678', phoneVerifiedAt: null, zaloId: 'z1', isBlocked: false, role: 'CUSTOMER' };
  const created = (tx: { externalPointsClaim: { createManyAndReturn: jest.Mock } }) =>
    (tx.externalPointsClaim.createManyAndReturn.mock.calls[0]?.[0] as { data: Record<string, unknown>[] } | undefined)?.data[0];

  it('SĐT trên đơn khớp SĐT liên hệ: claim vào REVIEW chờ CSKH, không còn 403; lý do ghi khớp bao nhiêu chữ số của đơn che số', async () => {
    const { svc, tx } = build({ config: flagOn, order: order(), user: webUser });
    const res = await svc.submit('u1', 'SPXVN0123456789');
    expect(res).toMatchObject({ status: 'REVIEW', points: 10_000 });
    expect(created(tx)).toMatchObject({
      state: 'REVIEW',
      reviewReason: 'SĐT đăng ký trên Web chưa xác thực Zalo — chờ CSKH đối chiếu; SĐT tự nhập chỉ khớp 5/10 chữ số nhìn thấy trên đơn sàn',
      userId: 'u1',
    });
  });
  it('đơn không có SĐT nhưng khách đã có đơn app giao thành công: REVIEW', async () => {
    const { svc, tx } = build({ config: flagOn, order: order({ phoneMask: null, phoneLast3: null }), user: webUser, deliveredAppOrders: 1 });
    expect((await svc.submit('u1', 'SPXVN0123456789')).status).toBe('REVIEW');
    expect(tx.order.count).toHaveBeenCalledWith({ where: { userId: 'u1', status: 'DELIVERED' }, take: 1 });
    expect(String(created(tx)?.reviewReason)).toContain('chờ CSKH đối chiếu');
  });
  it('đơn không có SĐT, chưa có đơn app giao: 403 NOT_ELIGIBLE_USER và ghi lần thử (tính vào trần lần thử/ngày)', async () => {
    const { svc, tx, attemptCreate } = build({ config: flagOn, order: order({ phoneMask: null, phoneLast3: null }), user: webUser });
    expect(await codeOf(svc.submit('u1', 'SPXVN0123456789'))).toBe('NOT_ELIGIBLE_USER');
    expect(attemptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ result: 'REJECTED_NOT_ELIGIBLE_USER', externalOrderId: 'x1' }) });
    expect(tx.externalPointsClaim.createManyAndReturn).not.toHaveBeenCalled();
    // 403 lộ ra mã có đơn (khác SEARCHING): tính vào khoá 24h để không dò mã hàng loạt.
    expect(LOCK_COUNTED_RESULTS).toContain('REJECTED_NOT_ELIGIBLE_USER');
  });
  it('SĐT trên đơn lệch: hỏi 4 số cuối SĐT người nhận như khách đã xác minh (W46)', async () => {
    const { svc, attemptCreate } = build({ config: flagOn, order: order({ phoneMask: '098*****11', phoneLast3: '011' }), user: webUser, deliveredAppOrders: 3 });
    expect(await codeOf(svc.submit('u1', 'SPXVN0123456789'))).toBe('PHONE_CONFIRM_REQUIRED');
    expect(attemptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ result: 'REJECTED_PHONE_CONFIRM_REQUIRED' }) });
  });
  it('SĐT lệch + nhập đúng 4 số: claim vẫn REVIEW (SĐT chưa xác minh), lý do ghi đã xác nhận 4 số', async () => {
    const { svc, tx } = build({ config: flagOn, order: order({ phoneMask: '098*****11', phoneLast3: '011' }), user: webUser });
    expect(await svc.submit('u1', 'SPXVN0123456789', 'scan', '5511')).toMatchObject({ status: 'REVIEW' });
    expect(created(tx)).toMatchObject({ state: 'REVIEW', reviewReason: `SĐT đăng ký trên Web chưa xác thực Zalo — chờ CSKH đối chiếu; ${PHONE_CONFIRMED_NOTE}` });
  });
  it('chưa thấy đơn: SEARCHING (ghi UNMATCHED để cron ghép lại)', async () => {
    const { svc, tx } = build({ config: flagOn, order: null, user: webUser });
    expect((await svc.submit('u1', 'SPXVN0123456789')).status).toBe('SEARCHING');
    expect(tx.externalClaimAttempt.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ result: 'UNMATCHED' })] }));
  });
  it('SĐT đã xác minh: không đếm đơn app, claim PENDING như cũ', async () => {
    const { svc, tx } = build({ config: flagOn, order: order() });
    expect((await svc.submit('u1', 'SPXVN0123456789')).status).toBe('CLAIMED');
    expect(tx.order.count).not.toHaveBeenCalled();
  });
});

describe('ExternalClaimService.submit: xác nhận 4 số cuối SĐT người nhận khi SĐT lệch (W46)', () => {
  /** Mock đếm lần nhập sai của đơn: `findMany` của lần thử trả `wrongTimes` khi hỏi đúng kết quả REJECTED_PHONE_CONFIRM_WRONG. */
  function withWrong(b: ReturnType<typeof build>, wrongTimes: Date[]) {
    b.tx.externalClaimAttempt.findMany.mockImplementation((async (args: { where: { result?: unknown } }) =>
      args.where.result === PHONE_CONFIRM_RESULTS.wrong ? wrongTimes.map((createdAt) => ({ createdAt })) : []) as never);
    return b;
  }
  const bodyOf = async (p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> => {
    try {
      await p;
      return { status: 200, body: {} };
    } catch (e) {
      const h = e as HttpException;
      return { status: h.getStatus(), body: h.getResponse() as Record<string, unknown> };
    }
  };
  const created = (tx: { externalPointsClaim: { createManyAndReturn: jest.Mock } }) =>
    (tx.externalPointsClaim.createManyAndReturn.mock.calls[0]?.[0] as { data: Record<string, unknown>[] } | undefined)?.data[0];
  const events = (tx: { externalClaimEvent: { create: jest.Mock } }) => tx.externalClaimEvent.create.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
  const HOUR = 36e5;

  it('1. SĐT khớp: PENDING ngay, không hỏi 4 số, không đếm lần sai', async () => {
    const b = build({ config: flagOn, order: order() });
    expect(await b.svc.submit('u1', 'SPXVN0123456789', 'scan')).toMatchObject({ status: 'CLAIMED', points: 10_000 });
    expect(created(b.tx)).toMatchObject({ state: 'PENDING', reviewReason: null });
    expect(b.tx.externalClaimAttempt.findMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ result: PHONE_CONFIRM_RESULTS.wrong }) }));
  });

  it('2. SĐT lệch, chưa nhập: 403 PHONE_CONFIRM_REQUIRED kèm sàn + số chữ số; thân lỗi không có chữ số nào của SĐT đơn', async () => {
    const b = build({ config: flagOn, order: order({ phoneMask: '0*26', phoneLast3: '326' }) });
    const r = await bodyOf(b.svc.submit('u1', 'SPXVN0123456789', 'scan'));
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ statusCode: 403, error: 'PHONE_CONFIRM_REQUIRED', code: 'PHONE_CONFIRM_REQUIRED', message: expect.any(String), channel: 'shopee', requiredDigits: 4 });
    expect(JSON.stringify(r.body)).not.toMatch(/26|326|\*/);
    expect(b.tx.externalPointsClaim.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('3. Shopee 0*26 + 8326: PENDING (không REVIEW), sổ claim và lần thử ghi đã xác nhận, lượt REQUIRED cũ thôi tính khoá', async () => {
    const b = build({ config: flagOn, order: order({ phoneMask: '0*26', phoneLast3: null }) });
    const res = await b.svc.submit('u1', 'SPXVN0123456789', 'scan', '8326');
    expect(res).toMatchObject({ status: 'CLAIMED', points: 10_000 });
    expect(created(b.tx)).toMatchObject({ state: 'PENDING', reviewReason: null });
    expect(events(b.tx)[0]).toMatchObject({ action: 'CLAIM_CREATED', toState: 'PENDING', note: PHONE_CONFIRMED_NOTE });
    expect(b.attemptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ result: 'MATCHED', note: PHONE_CONFIRMED_NOTE }) });
    expect(b.tx.externalClaimAttempt.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', externalOrderId: 'x1', result: PHONE_CONFIRM_RESULTS.required },
      data: expect.objectContaining({ result: PHONE_CONFIRM_RESULTS.confirmed }),
    });
    expect(b.notifications.notify).toHaveBeenCalledWith('u1', 'EXTERNAL_POINTS_PENDING', expect.anything(), expect.anything());
    expect(b.tx.analyticsEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ props: expect.objectContaining({ result: 'CLAIMED', phoneConfirmed: true }) }) }));
  });

  it('4. Lazada số đầy đủ 0987654321: 4321 → PENDING; 9921 → 403 PHONE_CONFIRM_WRONG còn 2 lượt', async () => {
    const lazada = () => order({ channel: 'lazada', phone: '0987654321', phoneMask: null, phoneLast3: '321' });
    const ok = build({ config: flagOn, order: lazada() });
    expect(await ok.svc.submit('u1', 'SPXVN0123456789', 'typed', '4321')).toMatchObject({ status: 'CLAIMED' });
    expect(created(ok.tx)).toMatchObject({ state: 'PENDING', reviewReason: null });

    const bad = build({ config: flagOn, order: lazada() });
    const r = await bodyOf(bad.svc.submit('u1', 'SPXVN0123456789', 'typed', '9921'));
    expect(r).toEqual({ status: 403, body: expect.objectContaining({ code: 'PHONE_CONFIRM_WRONG', channel: 'lazada', requiredDigits: 4, remainingAttempts: 2 }) });
    expect(JSON.stringify(r.body)).not.toMatch(/0987|4321|321/);
    expect(bad.attemptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ result: PHONE_CONFIRM_RESULTS.wrong, externalOrderId: 'x1' }) });
    expect(bad.tx.externalClaimAttempt.updateMany).not.toHaveBeenCalled();
    expect(bad.tx.externalPointsClaim.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('5. đã sai 2 lần: lần sai thứ 3 → 429 PHONE_CONFIRM_LOCKED (ghi là lần sai); có 3 lần sai thì lần thứ 4 nhập đúng vẫn LOCKED', async () => {
    const lazada = () => order({ channel: 'lazada', phone: '0987654321', phoneMask: null });
    const now = Date.now();
    const third = withWrong(build({ config: flagOn, order: lazada() }), [new Date(now - 2 * HOUR), new Date(now - HOUR)]);
    expect(await bodyOf(third.svc.submit('u1', 'SPXVN0123456789', 'typed', '1111'))).toEqual({
      status: 429,
      body: expect.objectContaining({ code: 'PHONE_CONFIRM_LOCKED', channel: 'lazada', remainingAttempts: 0 }),
    });
    expect(third.attemptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ result: PHONE_CONFIRM_RESULTS.wrong }) });

    const fourth = withWrong(build({ config: flagOn, order: lazada() }), [new Date(now - 3 * HOUR), new Date(now - 2 * HOUR), new Date(now - HOUR)]);
    expect((await bodyOf(fourth.svc.submit('u1', 'SPXVN0123456789', 'typed', '4321'))).body).toMatchObject({ code: 'PHONE_CONFIRM_LOCKED' });
    expect(fourth.attemptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ result: PHONE_CONFIRM_RESULTS.locked }) });
    expect(fourth.tx.externalClaimAttempt.updateMany).not.toHaveBeenCalled();
    expect(fourth.tx.externalPointsClaim.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('tài khoản đang khoá 24h: nhập đúng 4 số vẫn LOCKED, không lật lượt REQUIRED cũ (không thành máy dò 4 số)', async () => {
    const b = build({ config: flagOn, order: order({ channel: 'lazada', phone: '0987654321', phoneMask: null }) });
    const now = Date.now();
    b.tx.externalClaimAttempt.findMany.mockImplementation((async (args: { where: { result?: unknown } }) => {
      const r = args.where.result;
      return typeof r === 'object' && r !== null && 'in' in r ? [1, 2, 3, 4, 5].map((h) => ({ createdAt: new Date(now - h * HOUR) })) : [];
    }) as never);
    expect((await bodyOf(b.svc.submit('u1', 'SPXVN0123456789', 'typed', '4321'))).body).toMatchObject({ code: 'LOCKED' });
    expect(b.tx.externalClaimAttempt.updateMany).not.toHaveBeenCalled();
    expect(b.tx.externalPointsClaim.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('nhập đúng 4 số mà đơn bị từ chối vì lý do khác (đơn đã huỷ): không lật lượt REQUIRED cũ', async () => {
    const b = build({ config: flagOn, order: order({ channel: 'lazada', phone: '0987654321', phoneMask: null, status: 'CANCELLED' }) });
    expect((await bodyOf(b.svc.submit('u1', 'SPXVN0123456789', 'typed', '4321'))).body).toMatchObject({ code: 'CLOSED' });
    expect(b.tx.externalClaimAttempt.updateMany).not.toHaveBeenCalled();
  });

  it('lần sai đếm theo đúng khách và đúng đơn, trong 48 giờ gần nhất', async () => {
    const b = build({ config: flagOn, order: order({ phoneMask: '0*26' }) });
    await bodyOf(b.svc.submit('u1', 'SPXVN0123456789', 'scan', '1111'));
    expect(b.tx.externalClaimAttempt.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', externalOrderId: 'x1', result: PHONE_CONFIRM_RESULTS.wrong, createdAt: { gte: expect.any(Date) } },
      select: { createdAt: true },
    });
  });

  it('cron ghép lại (không có khách trước màn hình) vẫn từ chối PHONE_MISMATCH, không hỏi 4 số', async () => {
    const b = build({ config: flagOn, order: order({ phoneMask: '0*26' }) });
    b.tx.externalClaimAttempt.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', code: 'SPXVN0123456789', result: 'UNMATCHED', resolvedAt: null, externalOrderId: null });
    const cfg = { enabled: true, earnPct: 1, dailyAttempts: 10, dailyMax: 3, monthlyPointsCap: 200_000, maxAgeDays: 60, reviewAboveVnd: 2_000_000, pendingDays: 14, externalSince: null };
    expect(await (b.svc as unknown as { rematchOne: (id: string, c: unknown, now: Date) => Promise<string> }).rematchOne('a1', cfg, NOW)).toBe('RESOLVED');
    expect(b.tx.externalClaimAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ result: 'REJECTED_PHONE_MISMATCH' }) }));
  });
});
