import {
  ADMIN_LATE_PAYMENT_REF,
  endCustomerPayee,
  receivedRefundNote,
  recordCumulativeLatePayment,
  recordCumulativeOverpayment,
  recordLatePaymentRefund,
  recordOverpaymentRefund,
  refundReportedUnderpayment,
} from './refund-queue';

const snapshot = { recipient: 'Khach That', phone: '0912345678', street: '1 Duong IT' };

const regularOrder = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  code: 'TB100',
  userId: 'buyer1',
  status: 'CANCELLED',
  paymentStatus: 'UNPAID',
  paymentMethod: 'BANK_TRANSFER',
  total: 300_000,
  placedForCustomer: false,
  endCustomerKey: null,
  shippingAddress: snapshot,
  pancakePaidReported: null,
  ...over,
});

/** Đơn đúng hình dạng CTV lên hộ: userId = CTV, khách cuối chỉ là endCustomerKey + snapshot địa chỉ. */
const assistedOrder = (over: Record<string, unknown> = {}) =>
  regularOrder({ userId: 'ctv1', referrerUserId: 'ctv1', placedForCustomer: true, endCustomerKey: '0912345678', ...over });

function setup(opts: { recordedAmount?: number | null } = {}) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    orderCustomerRefund: {
      findFirst: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: opts.recordedAmount ?? null } }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'adm1' }]) },
    order: { findUnique: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const notify = jest.fn().mockResolvedValue(undefined);
  const ctx = { prisma, notifications: { notify }, logger: { warn: jest.fn(), log: jest.fn() } };
  const createdRow = () => tx.orderCustomerRefund.createMany.mock.calls[0]![0].data[0] as Record<string, unknown>;
  const notifiedTo = (userId: string) => notify.mock.calls.filter(([id]) => id === userId).map(([, code]) => code as string);
  const adminMessage = () => (notify.mock.calls.find(([id, code]) => id === 'adm1' && code === 'OPS_REFUND_ALERT')![2] as { message: string }).message;
  return { ctx: ctx as never, tx, prisma, notify, createdRow, notifiedTo, adminMessage };
}

describe('endCustomerPayee', () => {
  it('ưu tiên endCustomerKey, lấy tên người nhận từ snapshot', () => {
    expect(endCustomerPayee({ endCustomerKey: '0987654321', shippingAddress: snapshot })).toEqual({ phone: '0987654321', recipientName: 'Khach That' });
  });

  it('đơn hộ cũ chưa có endCustomerKey: đọc SĐT trong snapshot và đổi +84 về dạng nội địa', () => {
    expect(endCustomerPayee({ endCustomerKey: null, shippingAddress: { recipient: 'A', phone: '+84 912 345 678' } })).toEqual({
      phone: '0912345678',
      recipientName: 'A',
    });
  });

  it('thiếu snapshot hoặc trường không phải chuỗi → null, không ném', () => {
    expect(endCustomerPayee({ endCustomerKey: null, shippingAddress: null as never })).toEqual({ phone: null, recipientName: null });
    expect(endCustomerPayee({ endCustomerKey: null, shippingAddress: { phone: 912345678, recipient: 7 } })).toEqual({ phone: null, recipientName: null });
  });
});

describe('MONEY-1: tiền về muộn của đơn CTV lên hộ là khoản của khách cuối', () => {
  it('recordLatePaymentRefund: không chủ tài khoản, SĐT + tên người nhận, chuyển khoản tay chờ admin', async () => {
    const { ctx, createdRow } = setup();
    expect(await recordLatePaymentRefund(ctx, assistedOrder() as never, { amount: 300_000, source: 'PANCAKE', refKey: 'p1:300000' })).toBe(true);
    expect(createdRow()).toMatchObject({
      orderId: 'o1',
      orderCode: 'TB100',
      kind: 'LATE_PAYMENT',
      refKey: 'PANCAKE:p1:300000',
      userId: null,
      phone: '0912345678',
      recipientName: 'Khach That',
      amount: 300_000,
      method: 'MANUAL_TRANSFER',
      status: 'PENDING',
      reason: 'CANCELLED',
    });
  });

  it('khách cuối không có endCustomerKey (đơn hộ cũ) → SĐT lấy từ snapshot', async () => {
    const { ctx, createdRow } = setup();
    await recordLatePaymentRefund(ctx, assistedOrder({ endCustomerKey: null, shippingAddress: { ...snapshot, phone: '+84912345678' } }) as never, {
      amount: 1_000,
      source: 'PANCAKE',
      refKey: 'p1:1000',
    });
    expect(createdRow()).toMatchObject({ userId: null, phone: '0912345678' });
  });

  it('admin ghi tay cũng của khách cuối, giữ ghi chú admin', async () => {
    const { ctx, createdRow } = setup();
    await recordLatePaymentRefund(ctx, assistedOrder() as never, { amount: 50_000, source: 'ADMIN', refKey: ADMIN_LATE_PAYMENT_REF, note: 'Mã GD FT1' });
    expect(createdRow()).toMatchObject({ refKey: `ADMIN:${ADMIN_LATE_PAYMENT_REF}`, userId: null, phone: '0912345678', adminNote: 'Mã GD FT1' });
  });

  it('CTV không được báo REFUND_LATE_PAYMENT; admin được báo kèm SĐT che và lời "không phải của CTV"', async () => {
    const { ctx, notifiedTo, adminMessage } = setup();
    await recordLatePaymentRefund(ctx, assistedOrder() as never, { amount: 300_000, source: 'PANCAKE', refKey: 'p1:300000' });
    expect(notifiedTo('ctv1')).toEqual([]);
    expect(notifiedTo('adm1')).toEqual(['OPS_REFUND_ALERT']);
    expect(adminMessage()).toContain('khách cuối 091****678');
    expect(adminMessage()).toContain('không phải của CTV');
    expect(adminMessage()).not.toContain('chờ khách chọn nơi nhận');
  });

  it('webhook gửi lại cùng giao dịch (createMany bỏ qua) → không báo ai', async () => {
    const { ctx, tx, notify } = setup();
    tx.orderCustomerRefund.createMany.mockResolvedValue({ count: 0 });
    expect(await recordLatePaymentRefund(ctx, assistedOrder() as never, { amount: 300_000, source: 'PANCAKE', refKey: 'p1:300000' })).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('recordCumulativeLatePayment: phần tăng thêm của khách cuối, dù caller xin báo khách (notifyCustomer) CTV vẫn không được báo', async () => {
    const { ctx, createdRow, notifiedTo } = setup({ recordedAmount: 100_000 });
    expect(await recordCumulativeLatePayment(ctx, assistedOrder() as never, { reportedTotal: 300_000, source: 'PANCAKE' }, { notifyCustomer: true })).toBe(200_000);
    expect(createdRow()).toMatchObject({ kind: 'LATE_PAYMENT', refKey: 'PANCAKE:paid:300000', amount: 200_000, userId: null, phone: '0912345678', recipientName: 'Khach That' });
    expect(notifiedTo('ctv1')).toEqual([]);
    expect(notifiedTo('adm1')).toEqual(['OPS_REFUND_ALERT']);
  });

  it('đơn thường: khoản vẫn của người đặt, khách vẫn được báo, không thêm SĐT/tên', async () => {
    const { ctx, createdRow, notifiedTo, adminMessage } = setup();
    await recordLatePaymentRefund(ctx, regularOrder() as never, { amount: 300_000, source: 'PANCAKE', refKey: 'p1:300000' });
    const row = createdRow();
    expect(row).toMatchObject({ userId: 'buyer1', kind: 'LATE_PAYMENT', method: 'MANUAL_TRANSFER', status: 'PENDING' });
    expect(row).not.toHaveProperty('phone');
    expect(row).not.toHaveProperty('recipientName');
    expect(notifiedTo('buyer1')).toEqual(['REFUND_LATE_PAYMENT']);
    expect(adminMessage()).toContain('chờ khách chọn nơi nhận');
  });
});

describe('MONEY-1: tiền trả dư của đơn CTV lên hộ là khoản của khách cuối', () => {
  it('recordOverpaymentRefund (ZaloPay): PENDING không chủ tài khoản, CTV không được báo REFUND_OVERPAYMENT', async () => {
    const { ctx, createdRow, notifiedTo, adminMessage } = setup();
    expect(await recordOverpaymentRefund(ctx, assistedOrder({ status: 'CONFIRMED', paymentStatus: 'PAID' }) as never, { amount: 300_000, source: 'ZALOPAY', refKey: 'zp1' })).toBe(true);
    expect(createdRow()).toMatchObject({
      kind: 'OVERPAYMENT',
      refKey: 'ZALOPAY:zp1',
      userId: null,
      phone: '0912345678',
      recipientName: 'Khach That',
      status: 'PENDING',
      method: 'MANUAL_TRANSFER',
    });
    expect(notifiedTo('ctv1')).toEqual([]);
    expect(adminMessage()).toContain('khách cuối 091****678');
  });

  it('recordCumulativeOverpayment (Pancake): UNVERIFIED không chủ tài khoản, lời cho admin nói rõ không ai được báo', async () => {
    const { ctx, createdRow, notifiedTo, adminMessage } = setup();
    expect(await recordCumulativeOverpayment(ctx, assistedOrder({ status: 'CONFIRMED', paymentStatus: 'PAID', total: 200_000 }) as never, { reportedTotal: 350_000, source: 'PANCAKE' })).toBe(150_000);
    expect(createdRow()).toMatchObject({ kind: 'OVERPAYMENT', refKey: 'PANCAKE:paid:350000', amount: 150_000, status: 'UNVERIFIED', userId: null, phone: '0912345678', recipientName: 'Khach That' });
    expect(notifiedTo('ctv1')).toEqual([]);
    expect(adminMessage()).toContain('khách cuối 091****678');
    expect(adminMessage()).not.toContain('khách được báo để chọn');
  });

  it('đơn thường: khoản trả dư vẫn của người đặt và khách vẫn được báo', async () => {
    const { ctx, createdRow, notifiedTo } = setup();
    await recordOverpaymentRefund(ctx, regularOrder({ status: 'CONFIRMED', paymentStatus: 'PAID' }) as never, { amount: 300_000, source: 'ZALOPAY', refKey: 'zp1' });
    expect(createdRow()).toMatchObject({ kind: 'OVERPAYMENT', userId: 'buyer1', status: 'PENDING' });
    expect(createdRow()).not.toHaveProperty('phone');
    expect(notifiedTo('buyer1')).toEqual(['REFUND_OVERPAYMENT']);
  });
});

describe('MONEY-1: huỷ đơn CTV lên hộ khi khách cuối đã chuyển thiếu', () => {
  it('refundReportedUnderpayment: khoản hoàn số đã nhận là của khách cuối, chỉ đọc đơn một lần', async () => {
    const { ctx, prisma, createdRow, notifiedTo } = setup();
    prisma.order.findUnique.mockResolvedValue(assistedOrder({ pancakePaidReported: 120_000 }));
    expect(await refundReportedUnderpayment(ctx, 'o1')).toBe(120_000);
    expect(prisma.order.findUnique).toHaveBeenCalledTimes(1);
    expect(createdRow()).toMatchObject({ kind: 'LATE_PAYMENT', amount: 120_000, userId: null, phone: '0912345678', recipientName: 'Khach That' });
    expect(notifiedTo('ctv1')).toEqual([]);
  });

  it('receivedRefundNote: đơn CTV lên hộ không mời chọn Ví/ngân hàng', () => {
    expect(receivedRefundNote(120_000, true)).toBe(' Tubu đã nhận 120.000đ chuyển khoản của đơn này và sẽ hoàn lại cho người nhận hàng.');
    expect(receivedRefundNote(120_000, true)).not.toMatch(/Ví Tubu|chọn nhận/);
    expect(receivedRefundNote(120_000)).toContain('chọn nhận lại về Ví Tubu');
    expect(receivedRefundNote(0, true)).toBe('');
  });
});
