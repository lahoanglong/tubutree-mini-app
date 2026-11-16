import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { WasteCreateRequest } from '@tubutree/shared-types';
import { WASTE_MESSAGES } from '../core/waste-messages';
import { WasteHomePickupCustomerService } from './waste-home-pickup-customer.service';

const mockApply = jest.fn();
jest.mock('../../loyalty/points-ledger', () => ({ applyPointsDelta: (...a: unknown[]) => mockApply(...a) }));
const mockApplyWallet = jest.fn();
jest.mock('../../wallet/wallet-ledger.service', () => ({ applyWalletDelta: (...a: unknown[]) => mockApplyWallet(...a) }));
const mockEvent = jest.fn();
jest.mock('../core/waste-events', () => ({ writeWasteEvent: (...a: unknown[]) => mockEvent(...a) }));
jest.mock('../core/waste-public-config', () => ({ computeWastePublicFlags: jest.fn().mockResolvedValue({ pickup: true }) }));
jest.mock('../waste-codes', () => ({ ...jest.requireActual('../waste-codes'), generateWasteCode: () => 'TR-AAAAA' }));
const mockEnqueue = jest.fn();
jest.mock('../../integrations/gomdon/gomdon-queue', () => ({ enqueueGomdonWastePush: (...a: unknown[]) => mockEnqueue(...a) }));

const HCM = 'Thành phố Hồ Chí Minh';
const ADDRESS = { id: 'a1', recipient: 'Lan', phone: '0901234567', province: HCM, ward: 'Phường Bến Nghé', street: '1 Lê Lợi', provinceCode: '79', wardCode: '26734' };
const LINES = [{ itemId: 'item-carton', declaredQty: 5 }];
const SNAP = {
  laneDropoff: true, laneMailin: true, lanePickup: true, mailinMinPoints: 3000, pickupMinPoints: 3000,
  customerMonthlyCapPoints: 50000, maxOpenRequests: 5, requestHoldDays: 7, rulesVersion: 'v1',
  homePickupBankTransferEnabled: false, feePaymentTtlHours: 24,
};
const HELD = {
  pointId: 'wh', capDayKey: '2026-11-15', capMonthKey: '2026-11', expiresAt: new Date('2026-11-22T16:59:59Z'), estimatedPoints: 3500, estimatedDrops: 0,
  lines: [{ itemId: 'item-carton', itemCode: 'CARTON', itemName: 'Thùng carton', unitLabel: 'kg', unitsPerPoint: 1, pointsPerGroup: 700, dropsPerUnit: 0, gramsPerUnit: 1000, declaredQty: 5, hazardous: false }],
};

function setup(
  over: {
    balance?: number;
    converted?: number;
    walletBalance?: number;
    locked?: number;
    fee?: number;
    estimated?: boolean;
    bankTransferEnabled?: boolean;
    feePaymentTtlHours?: number;
  } = {},
) {
  const calls: string[] = [];
  const tx = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    wasteRequest: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async () => { calls.push('create'); return { id: 'r1' }; }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        pointsBalance: over.balance ?? 0,
        pointsConvertedBalance: over.converted ?? 0,
        walletBalance: over.walletBalance ?? 0,
      }),
    },
  };
  const prisma = {
    address: { findFirst: jest.fn().mockResolvedValue(ADDRESS) },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        pointsBalance: over.balance ?? 0,
        pointsConvertedBalance: over.converted ?? 0,
        walletBalance: over.walletBalance ?? 0,
      }),
    },
    wasteRequest: { findFirst: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => { calls.push('tx'); return fn(tx); }),
  };
  const config = {
    snapshot: jest.fn().mockResolvedValue({
      ...SNAP,
      ...(over.bankTransferEnabled !== undefined ? { homePickupBankTransferEnabled: over.bankTransferEnabled } : {}),
      ...(over.feePaymentTtlHours !== undefined ? { feePaymentTtlHours: over.feePaymentTtlHours } : {}),
    }),
  };
  const hold = {
    evaluate: jest.fn().mockResolvedValue({ result: { estimatedPoints: 3500 }, blocks: [], messages: [], pickupPendingId: null }),
    validateAndHold: jest.fn().mockResolvedValue(HELD),
  };
  const gomdon = {
    checkAddress: jest.fn().mockResolvedValue({ ok: true }),
    isConfigured: jest.fn().mockResolvedValue(true),
    quoteShopFeeDetailed: jest.fn().mockImplementation(async () => { calls.push('quote'); return { fee: over.fee ?? 25000, estimated: over.estimated ?? false }; }),
    cancelOrder: jest.fn(),
  };
  const loyalty = {
    returnWindowDays: jest.fn().mockResolvedValue(7),
    lockedOrderPoints: jest.fn().mockResolvedValue({ locked: over.locked ?? 0, lockedReturn: 0, lockedUntil: null }),
  };
  const lifecycle = { closeOpen: jest.fn().mockResolvedValue({ closed: true, refunded: 0 }) };
  const queue = { name: 'q' };
  const svc = new WasteHomePickupCustomerService(prisma as never, config as never, hold as never, {} as never, gomdon as never, loyalty as never, lifecycle as never, queue as never);
  return { svc, prisma, tx, config, hold, gomdon, loyalty, lifecycle, queue, calls };
}

const create = (over: Partial<WasteCreateRequest> = {}): WasteCreateRequest => ({
  method: 'HOME_PICKUP', lines: LINES, consent: true, pickupAddressId: 'a1', declaredWeightGrams: 2000, usePointsForShipFee: true, ...over,
});

beforeEach(() => {
  mockApply.mockReset().mockResolvedValue({ applied: true, entryId: 'e' });
  mockApplyWallet.mockReset().mockResolvedValue({ applied: true, balanceAfter: 20000, entryId: 'wt-1' });
  mockEvent.mockReset().mockResolvedValue({ id: 'ev' });
  mockEnqueue.mockReset().mockResolvedValue(undefined);
});

describe('WasteHomePickupCustomerService.quote', () => {
  const body = { addressId: 'a1', declaredWeightGrams: 2000, lines: LINES };

  it('phí Gomdon thật, thiếu điểm: trả blockedCode NEED_FEE_PAYMENT, cashDueVnd và feePaths (Ví, VietQR, Gửi kèm đơn)', async () => {
    const { svc, loyalty } = setup({ balance: 5000, locked: 1000, converted: 300, walletBalance: 40000 });
    const q = await svc.quote('u1', body);
    expect(loyalty.lockedOrderPoints).toHaveBeenCalledWith('u1', expect.any(Date));
    expect(q).toEqual({
      shipFeeVnd: 25000, estimated: false, estimatedPoints: 3500, minPoints: 3000,
      pointsAvailable: 4300, pointsApplicable: 4300, remainingFeeVnd: 20700,
      addressOk: true, addressMessage: null, blocked: WASTE_MESSAGES.HOME_PICKUP_NEED_POINTS(20700),
      blockedCode: 'NEED_FEE_PAYMENT',
      cashDueVnd: 20700,
      feePaths: {
        wallet: { balance: 40000, enough: true },
        bankTransfer: { enabled: false },
        attachNextOrder: { available: true, reason: null, existingRequestId: null },
      },
    });
  });

  it('đã có phiếu PICKUP chờ gắn đơn: attachNextOrder trả available:false kèm existingRequestId để khách chạm mở lại', async () => {
    const { svc, hold } = setup({ balance: 0, walletBalance: 10000, bankTransferEnabled: true });
    hold.evaluate
      .mockResolvedValueOnce({ result: { estimatedPoints: 3500 }, blocks: [], messages: [], pickupPendingId: null })
      .mockResolvedValueOnce({
        result: { estimatedPoints: 3500 },
        blocks: [{ code: 'PICKUP_PENDING', pickupRequestCode: 'TR-PEND1' }],
        messages: ['Bạn đang có yêu cầu TR-PEND1 chờ gắn đơn'],
        pickupPendingId: 'req-pend-1',
      });
    const q = await svc.quote('u1', body);
    expect(q.feePaths).toEqual({
      wallet: { balance: 10000, enough: false },
      bankTransfer: { enabled: true },
      attachNextOrder: { available: false, reason: 'Bạn đang có yêu cầu TR-PEND1 chờ gắn đơn', existingRequestId: 'req-pend-1' },
    });
  });

  it('Gomdon chưa cấu hình / lỗi: phí ước lượng 25.000đ và đánh dấu estimated', async () => {
    const { svc, gomdon } = setup({ balance: 100000, estimated: true });
    const q = await svc.quote('u1', body);
    expect(gomdon.quoteShopFeeDetailed).toHaveBeenCalledWith({ weight: 2000, productPrice: 0 });
    expect(q).toMatchObject({ shipFeeVnd: 25000, estimated: true, pointsApplicable: 25000, remainingFeeVnd: 0 });
  });

  it('Điểm Xanh nhiều hơn phí: chỉ áp tới hết phí, không âm', async () => {
    const { svc } = setup({ balance: 80000, fee: 18000 });
    expect(await svc.quote('u1', body)).toMatchObject({ pointsAvailable: 80000, pointsApplicable: 18000, remainingFeeVnd: 0 });
  });

  it('dưới ngưỡng điểm tối thiểu: trả blocked (câu đầu tiên) và minPoints để màn hình hiện', async () => {
    const { svc, hold } = setup();
    hold.evaluate.mockResolvedValue({ result: { estimatedPoints: 1200 }, blocks: [{ code: 'BELOW_MIN', missingPoints: 1800 }], messages: [WASTE_MESSAGES.BELOW_MIN('HOME_PICKUP', 3000, 1800)] });
    const q = await svc.quote('u1', body);
    expect(q.blocked).toContain('cần tối thiểu 3.000 điểm');
    expect(q).toMatchObject({ estimatedPoints: 1200, minPoints: 3000 });
  });

  it('Pin cũ khi địa chỉ ngoài TP.HCM: tỉnh của địa chỉ được đưa vào luật nên bị chặn bằng câu Pin', async () => {
    const { svc, hold, prisma } = setup();
    prisma.address.findFirst.mockResolvedValue({ ...ADDRESS, province: 'Tỉnh Đồng Nai' });
    hold.evaluate.mockResolvedValue({ result: { estimatedPoints: 4000 }, blocks: [{ code: 'ITEM_DROPOFF_ONLY' }], messages: [WASTE_MESSAGES.HAZARDOUS_HCM_ONLY] });
    const q = await svc.quote('u1', { ...body, lines: [{ itemId: 'wi-battery', declaredQty: 10 }] });
    expect(hold.evaluate.mock.calls[0]![1]).toMatchObject({ method: 'HOME_PICKUP', pickupProvince: 'Tỉnh Đồng Nai', path: 'CREATE' });
    expect(q.blocked).toBe('Pin cũ cần xử lý an toàn riêng nên hiện chỉ nhận tại điểm thu gom hoặc lấy tận nơi khu vực TP.HCM');
  });

  it('địa chỉ Gomdon không nhận diện: addressOk false kèm câu của Gomdon, vẫn báo phí', async () => {
    const { svc, gomdon } = setup();
    gomdon.checkAddress.mockResolvedValue({ ok: false, message: 'Không tìm thấy phường/xã' });
    expect(await svc.quote('u1', body)).toMatchObject({ addressOk: false, addressMessage: 'Không tìm thấy phường/xã', shipFeeVnd: 25000 });
    gomdon.checkAddress.mockResolvedValue({ ok: false });
    expect((await svc.quote('u1', body)).addressMessage).toBe(WASTE_MESSAGES.HOME_PICKUP_ADDRESS_UNRECOGNIZED);
    expect(gomdon.checkAddress).toHaveBeenCalledWith(HCM, 'Phường Bến Nghé');
  });

  it('địa chỉ không thuộc khách: 400; cân nặng ngoài 0,5 đến 10 kg: 400', async () => {
    const { svc, prisma } = setup();
    prisma.address.findFirst.mockResolvedValue(null);
    await expect(svc.quote('u1', body)).rejects.toThrow(BadRequestException);
    expect(prisma.address.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'a1', userId: 'u1' } }));
    for (const w of [499, 10001, 1500.5]) await expect(svc.quote('u1', { ...body, declaredWeightGrams: w })).rejects.toThrow(WASTE_MESSAGES.HOME_PICKUP_WEIGHT(500, 10000));
  });
});

describe('WasteHomePickupCustomerService.create', () => {
  it('Điểm Xanh đủ: trừ về 0đ (shipFeeCodVnd 0), ghi sổ WASTE_PICKUP_FEE đúng refType/refId, báo Gomdon sau commit', async () => {
    const { svc, tx, hold, calls } = setup({ balance: 30000 });
    await expect(svc.create('u1', 'key-1', create())).resolves.toBe('r1');
    expect(tx.wasteRequest.create.mock.calls[0]![0].data).toMatchObject({
      method: 'HOME_PICKUP', status: 'OPEN', code: 'TR-AAAAA', declaredWeightGrams: 2000,
      shipFeeVnd: 25000, shipFeePointsUsed: 25000, shipFeeCodVnd: 0,
      pickupAddress: { addressId: 'a1', street: '1 Lê Lợi', ward: 'Phường Bến Nghé', province: HCM },
    });
    expect(mockApply).toHaveBeenCalledTimes(1);
    expect(mockApply).toHaveBeenCalledWith(tx, { userId: 'u1', delta: -25000, lot: 'STANDARD', reason: 'WASTE_PICKUP_FEE:TR-AAAAA', refType: 'WASTE_REQUEST', refId: 'r1' });
    expect(hold.validateAndHold.mock.calls[0]![1]).toMatchObject({ method: 'HOME_PICKUP', pickupProvince: HCM, path: 'CREATE', pointId: null });
    expect(mockEnqueue).toHaveBeenCalledWith({ name: 'q' }, 'r1', 'TR-AAAAA');
    expect(calls.indexOf('quote')).toBeLessThan(calls.indexOf('tx'));
  });

  it('Điểm Xanh chưa đủ trả hết phí và chưa chọn phương thức trả: 400 mang code WASTE_FEE_NEED_PAYMENT + cashDueVnd, không tạo phiếu, không trừ điểm, không xếp job Gomdon', async () => {
    const { svc, tx } = setup({ balance: 10000 });
    await expect(svc.create('u1', 'key-1', create())).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'WASTE_FEE_NEED_PAYMENT',
        message: WASTE_MESSAGES.HOME_PICKUP_NEED_POINTS(15000),
        cashDueVnd: 15000,
      }),
    });
    expect(tx.wasteRequest.create).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockApplyWallet).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('trả phần thiếu bằng Ví Tubu (WALLET): trừ điểm + trừ Ví trong cùng tx, shipFeeCodVnd = 0, shipFeeCashPaidAt có ngay, đẩy Gomdon sau commit', async () => {
    const { svc, tx } = setup({ balance: 8000, walletBalance: 40000, fee: 25000 });
    await expect(svc.create('u1', 'key-w', create({ shipFeePayment: 'WALLET', expectedCashVnd: 17000 }))).resolves.toBe('r1');
    expect(tx.wasteRequest.create.mock.calls[0]![0].data).toMatchObject({
      shipFeeVnd: 25000,
      shipFeePointsUsed: 8000,
      shipFeeCodVnd: 0,
      shipFeeCashVnd: 17000,
      shipFeeCashMethod: 'WALLET',
      shipFeeCashPaidAt: expect.any(Date),
    });
    expect(mockApply).toHaveBeenCalledWith(tx, expect.objectContaining({ delta: -8000, lot: 'STANDARD' }));
    expect(mockApplyWallet).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: 'u1',
        delta: -17000,
        type: 'WASTE_FEE_PAY',
        refType: 'WASTE_REQUEST',
        refId: 'r1',
      }),
    );
    expect(mockEnqueue).toHaveBeenCalledWith({ name: 'q' }, 'r1', 'TR-AAAAA');
  });

  it('Ví không đủ tiền: applyWalletDelta ném 400 trong tx nên rollback cả phiếu và điểm, không đẩy Gomdon', async () => {
    const { svc } = setup({ balance: 8000, walletBalance: 5000, fee: 25000 });
    mockApplyWallet.mockRejectedValueOnce(new BadRequestException('Số dư Ví không đủ'));
    await expect(svc.create('u1', 'key-w', create({ shipFeePayment: 'WALLET' }))).rejects.toThrow(BadRequestException);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('expectedCashVnd thấp hơn số server tính (phí tăng / điểm vừa giảm): 409 WASTE_FEE_CHANGED kèm cashDueVnd mới, không tạo phiếu', async () => {
    const { svc, tx } = setup({ balance: 8000, walletBalance: 40000, fee: 25000 });
    await expect(svc.create('u1', 'key-w', create({ shipFeePayment: 'WALLET', expectedCashVnd: 15000 }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'WASTE_FEE_CHANGED', cashDueVnd: 17000 }),
    });
    expect(tx.wasteRequest.create).not.toHaveBeenCalled();
    expect(mockApplyWallet).not.toHaveBeenCalled();
  });

  it('expectedCashVnd cao hơn số server tính: thu đúng số server (I2), không bao giờ thu theo số client', async () => {
    const { svc } = setup({ balance: 8000, walletBalance: 40000, fee: 25000 });
    await expect(svc.create('u1', 'key-w', create({ shipFeePayment: 'WALLET', expectedCashVnd: 99999 }))).resolves.toBe('r1');
    expect(mockApplyWallet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ delta: -17000 }));
  });

  it('BANK_TRANSFER khi cờ tắt: 400 WASTE_FEE_BANK_DISABLED; khi cờ bật: tạo phiếu AWAITING (PaidAt null) và KHÔNG xếp job Gomdon', async () => {
    const off = setup({ balance: 8000, fee: 25000, bankTransferEnabled: false });
    await expect(off.svc.create('u1', 'key-b', create({ shipFeePayment: 'BANK_TRANSFER' }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'WASTE_FEE_BANK_DISABLED' }),
    });
    expect(off.tx.wasteRequest.create).not.toHaveBeenCalled();

    const on = setup({ balance: 8000, fee: 25000, bankTransferEnabled: true, feePaymentTtlHours: 24 });
    await expect(on.svc.create('u1', 'key-b2', create({ shipFeePayment: 'BANK_TRANSFER' }))).resolves.toBe('r1');
    expect(on.tx.wasteRequest.create.mock.calls[0]![0].data).toMatchObject({
      shipFeeVnd: 25000,
      shipFeePointsUsed: 8000,
      shipFeeCodVnd: 0,
      shipFeeCashVnd: 17000,
      shipFeeCashMethod: 'BANK_TRANSFER',
      shipFeeCashPaidAt: null,
    });
    expect(mockApplyWallet).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('phát lại cùng khoá idempotency cho phiếu AWAITING BANK_TRANSFER: vẫn không đẩy Gomdon; đổi shipFeePayment cùng khoá -> 409', async () => {
    const { svc, tx } = setup({ balance: 8000, fee: 25000, bankTransferEnabled: true });
    tx.wasteRequest.findUnique.mockResolvedValueOnce({
      id: 'old-bank', code: 'TR-OLDBK', method: 'HOME_PICKUP', status: 'OPEN', pointId: 'wh',
      gomdonOrderId: null, gomdonStatus: null, declaredWeightGrams: 2000,
      shipFeeCashVnd: 17000, shipFeeCashMethod: 'BANK_TRANSFER', shipFeeCashPaidAt: null,
      pickupAddress: { addressId: 'a1', requestedPayment: 'BANK_TRANSFER' }, lines: [{ itemId: 'item-carton', declaredQty: 5 }],
    });
    await expect(svc.create('u1', 'key-b', create({ shipFeePayment: 'BANK_TRANSFER' }))).resolves.toBe('old-bank');
    expect(mockEnqueue).not.toHaveBeenCalled();

    tx.wasteRequest.findUnique.mockResolvedValueOnce({
      id: 'old-bank', code: 'TR-OLDBK', method: 'HOME_PICKUP', status: 'OPEN', pointId: 'wh',
      gomdonOrderId: null, gomdonStatus: null, declaredWeightGrams: 2000,
      shipFeeCashVnd: 17000, shipFeeCashMethod: 'BANK_TRANSFER', shipFeeCashPaidAt: null,
      pickupAddress: { addressId: 'a1', requestedPayment: 'BANK_TRANSFER' }, lines: [{ itemId: 'item-carton', declaredQty: 5 }],
    });
    await expect(svc.create('u1', 'key-b', create({ shipFeePayment: 'WALLET' }))).rejects.toThrow(ConflictException);
  });

  it('không bật công tắc trừ điểm: phí nằm hết ở phần thu hộ nên 400, không đụng sổ điểm', async () => {
    const { svc, tx, loyalty } = setup({ balance: 99999 });
    await expect(svc.create('u1', 'key-1', create({ usePointsForShipFee: false }))).rejects.toThrow(BadRequestException);
    expect(tx.wasteRequest.create).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
    expect(loyalty.lockedOrderPoints).not.toHaveBeenCalled();
    expect(loyalty.returnWindowDays).not.toHaveBeenCalled();
  });

  it('điểm đơn mới giao còn khoá chờ đổi/trả không được tiêu: chỉ tính phần số dư vượt phần khoá nên thiếu thì 400', async () => {
    const { svc, tx, loyalty } = setup({ balance: 20000, locked: 15000 });
    await expect(svc.create('u1', 'key-1', create())).rejects.toThrow(WASTE_MESSAGES.HOME_PICKUP_NEED_POINTS(20000));
    expect(loyalty.lockedOrderPoints).toHaveBeenCalledWith('u1', expect.any(Date), tx, 7);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.wasteRequest.create).not.toHaveBeenCalled();
  });

  it('hết điểm thường thì lấy tiếp lô quy đổi: hai dòng sổ, mỗi dòng đúng lô', async () => {
    const { svc, tx } = setup({ balance: 10000, converted: 20000 });
    await svc.create('u1', 'key-1', create());
    expect(tx.wasteRequest.create.mock.calls[0]![0].data).toMatchObject({ shipFeePointsUsed: 25000, shipFeeCodVnd: 0 });
    expect(mockApply.mock.calls.map((c) => [c[1].lot, c[1].delta])).toEqual([['STANDARD', -10000], ['CONVERTED', -15000]]);
  });

  it('khách không có điểm dùng được: bật công tắc vẫn không trừ âm, thiếu cả phí nên 400', async () => {
    const { svc, tx } = setup({ balance: 500, locked: 800 });
    await expect(svc.create('u1', 'key-1', create())).rejects.toThrow(WASTE_MESSAGES.HOME_PICKUP_NEED_POINTS(25000));
    expect(tx.wasteRequest.create).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('phí chỉ là ước lượng (Gomdon không trả lời): 503, không tạo phiếu, không trừ điểm', async () => {
    const { svc, tx } = setup({ balance: 100000, estimated: true });
    await expect(svc.create('u1', 'key-1', create())).rejects.toThrow(WASTE_MESSAGES.HOME_PICKUP_FEE_UNAVAILABLE);
    expect(tx.wasteRequest.create).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('trừ điểm bị từ chối (số dư vừa đổi): ném lỗi để rollback cả phiếu, không xếp job Gomdon', async () => {
    const { svc } = setup({ balance: 30000 });
    mockApply.mockResolvedValue({ applied: false, entryId: null });
    await expect(svc.create('u1', 'key-1', create())).rejects.toThrow(ConflictException);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('cùng khoá idempotency đã có phiếu: trả phiếu cũ, không giữ chỗ lại, không trừ điểm lần hai, không tạo phiếu', async () => {
    const { svc, tx, hold } = setup({ balance: 30000 });
    tx.wasteRequest.findUnique.mockResolvedValueOnce({
      id: 'old', code: 'TR-OLD01', method: 'HOME_PICKUP', status: 'OPEN', pointId: 'wh', gomdonOrderId: 'G1', gomdonStatus: '1', declaredWeightGrams: 2000,
      pickupAddress: { addressId: 'a1' }, lines: [{ itemId: 'item-carton', declaredQty: 5 }],
    });
    await expect(svc.create('u1', 'key-1', create())).resolves.toBe('old');
    expect(hold.validateAndHold).not.toHaveBeenCalled();
    expect(tx.wasteRequest.create).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('phiếu cũ cùng khoá còn OPEN mà chưa có vận đơn (lần xếp job trước lỗi): xếp lại job, vẫn không trừ điểm', async () => {
    const { svc, tx } = setup({ balance: 30000 });
    tx.wasteRequest.findUnique.mockResolvedValueOnce({
      id: 'old', code: 'TR-OLD01', method: 'HOME_PICKUP', status: 'OPEN', pointId: 'wh', gomdonOrderId: null, gomdonStatus: null, declaredWeightGrams: 2000,
      pickupAddress: { addressId: 'a1' }, lines: [{ itemId: 'item-carton', declaredQty: 5 }],
    });
    await svc.create('u1', 'key-1', create());
    expect(mockEnqueue).toHaveBeenCalledWith({ name: 'q' }, 'old', 'TR-OLD01');
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('cùng khoá idempotency nhưng nội dung khác (địa chỉ, cân nặng, món): 409', async () => {
    for (const body of [create({ pickupAddressId: 'a2' }), create({ declaredWeightGrams: 3000 }), create({ lines: [{ itemId: 'item-carton', declaredQty: 9 }] })]) {
      const { svc, tx } = setup();
      tx.wasteRequest.findUnique.mockResolvedValueOnce({
        id: 'old', code: 'TR-OLD01', method: 'HOME_PICKUP', status: 'OPEN', pointId: 'wh', gomdonOrderId: null, gomdonStatus: null, declaredWeightGrams: 2000,
        pickupAddress: { addressId: 'a1' }, lines: [{ itemId: 'item-carton', declaredQty: 5 }],
      });
      await expect(svc.create('u1', 'key-1', body)).rejects.toThrow(ConflictException);
    }
  });

  it('hai request song song cùng khoá: bên thua đụng unique idempotencyKey thì đọc lại phiếu bên thắng', async () => {
    const { svc, prisma } = setup({ balance: 30000 });
    prisma.$transaction.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['userId', 'idempotencyKey'] } }));
    prisma.wasteRequest.findUnique.mockResolvedValueOnce({
      id: 'won', code: 'TR-WON01', method: 'HOME_PICKUP', status: 'OPEN', pointId: 'wh', gomdonOrderId: null, gomdonStatus: null, declaredWeightGrams: 2000,
      pickupAddress: { addressId: 'a1' }, lines: [{ itemId: 'item-carton', declaredQty: 5 }],
    });
    await expect(svc.create('u1', 'key-1', create())).resolves.toBe('won');
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('thiếu địa chỉ / cân nặng sai / địa chỉ Gomdon không nhận / Gomdon chưa cấu hình: chặn trước khi mở transaction', async () => {
    const a = setup();
    await expect(a.svc.create('u1', 'k', create({ pickupAddressId: undefined }))).rejects.toThrow(WASTE_MESSAGES.HOME_PICKUP_NEED_ADDRESS);
    await expect(a.svc.create('u1', 'k', create({ declaredWeightGrams: 100 }))).rejects.toThrow(BadRequestException);
    await expect(a.svc.create('u1', 'k', create({ declaredWeightGrams: undefined }))).rejects.toThrow(BadRequestException);
    const b = setup();
    b.gomdon.checkAddress.mockResolvedValue({ ok: false, message: 'x' });
    await expect(b.svc.create('u1', 'k', create())).rejects.toThrow(WASTE_MESSAGES.HOME_PICKUP_ADDRESS_UNRECOGNIZED);
    const c = setup();
    c.gomdon.isConfigured.mockResolvedValue(false);
    await expect(c.svc.create('u1', 'k', create())).rejects.toThrow(ServiceUnavailableException);
    for (const s of [a, b, c]) expect(s.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('thể lệ đã đổi phiên bản thì không tạo phiếu', async () => {
    const { svc } = setup();
    await expect(svc.create('u1', 'k', create({ consentVersion: 'v0' }))).rejects.toThrow(WASTE_MESSAGES.RULES_UPDATED);
  });

  it('xếp job Gomdon lỗi (Redis) không làm hỏng việc tạo phiếu: cron cứu hộ sẽ xếp lại', async () => {
    const { svc } = setup({ balance: 30000 });
    mockEnqueue.mockRejectedValue(new Error('redis down'));
    await expect(svc.create('u1', 'k', create())).resolves.toBe('r1');
  });
});

describe('WasteHomePickupCustomerService.cancel', () => {
  const R = (over: Record<string, unknown> = {}) => ({
    id: 'r1', code: 'TR-AAAAA', userId: 'u1', pointId: 'wh', method: 'HOME_PICKUP', status: 'OPEN', gomdonOrderId: null, gomdonPartnerCode: null,
    gomdonStatus: null, gomdonStatusAt: null, shipFeePointsUsed: 1500, shippingHistory: null, ...over,
  });

  it('chưa có vận đơn: đóng ngay và hoàn điểm, chỉ khi vẫn chưa có vận đơn (job tạo vận đơn thấy phiếu đã huỷ thì không tạo)', async () => {
    const { svc, prisma, lifecycle } = setup();
    prisma.wasteRequest.findFirst.mockResolvedValue(R());
    await svc.cancel('u1', 'r1');
    expect(lifecycle.closeOpen).toHaveBeenCalledWith('r1', expect.objectContaining({
      to: 'CANCELLED', closeReason: null, actorUserId: 'u1', actorRole: 'CUSTOMER', eventKind: 'REQUEST_CANCELLED',
      where: { gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: null },
    }));
  });

  it('vận đơn đang được tạo / chờ kiểm tra tay: không huỷ, báo rõ cho khách', async () => {
    for (const [gomdonStatus, message] of [['CREATING', WASTE_MESSAGES.HOME_PICKUP_CREATING], ['NEEDS_MANUAL_CHECK', WASTE_MESSAGES.HOME_PICKUP_MANUAL_CHECK]] as const) {
      const { svc, prisma, lifecycle } = setup();
      prisma.wasteRequest.findFirst.mockResolvedValue(R({ gomdonStatus }));
      await expect(svc.cancel('u1', 'r1')).rejects.toThrow(message);
      expect(lifecycle.closeOpen).not.toHaveBeenCalled();
    }
  });

  it('job vừa claim giữa lúc đọc và lúc đóng (closed:false, phiếu còn OPEN): báo đang tạo vận đơn', async () => {
    const { svc, prisma, lifecycle } = setup();
    prisma.wasteRequest.findFirst.mockResolvedValueOnce(R()).mockResolvedValueOnce({ status: 'OPEN' });
    lifecycle.closeOpen.mockResolvedValue({ closed: false, refunded: 0 });
    await expect(svc.cancel('u1', 'r1')).rejects.toThrow(WASTE_MESSAGES.HOME_PICKUP_CREATING);
  });

  it('đã có vận đơn và Gomdon huỷ được: đóng phiếu, hoàn điểm, ghi gomdonStatus 2 và lịch sử', async () => {
    const { svc, prisma, gomdon, lifecycle } = setup();
    prisma.wasteRequest.findFirst.mockResolvedValue(R({ gomdonOrderId: 'G1', gomdonPartnerCode: 'BE1', gomdonStatus: '1', shippingHistory: [{ status: '1' }] }));
    gomdon.cancelOrder.mockResolvedValue({ ok: true });
    await svc.cancel('u1', 'r1');
    expect(gomdon.cancelOrder).toHaveBeenCalledWith('G1');
    const args = lifecycle.closeOpen.mock.calls[0]![1];
    expect(args).toMatchObject({ to: 'CANCELLED', where: { gomdonOrderId: 'G1' }, data: { gomdonStatus: '2' } });
    expect(args.data.shippingHistory).toHaveLength(2);
  });

  it('Gomdon từ chối huỷ (bưu tá đã nhận hàng...): giữ nguyên phiếu, không hoàn điểm, báo khách rõ ràng', async () => {
    const { svc, prisma, gomdon, lifecycle } = setup();
    prisma.wasteRequest.findFirst.mockResolvedValue(R({ gomdonOrderId: 'G1', gomdonPartnerCode: 'BE1', gomdonStatus: '1' }));
    gomdon.cancelOrder.mockResolvedValue({ ok: false, message: 'Đơn đã lấy hàng' });
    await expect(svc.cancel('u1', 'r1')).rejects.toThrow(WASTE_MESSAGES.HOME_PICKUP_CANCEL_REFUSED);
    expect(lifecycle.closeOpen).not.toHaveBeenCalled();
  });

  it('không gọi được Gomdon: 503 bảo thử lại, phiếu và điểm giữ nguyên', async () => {
    const { svc, prisma, gomdon, lifecycle } = setup();
    prisma.wasteRequest.findFirst.mockResolvedValue(R({ gomdonOrderId: 'G1', gomdonPartnerCode: 'BE1', gomdonStatus: '1' }));
    gomdon.cancelOrder.mockRejectedValue(new Error('ETIMEDOUT'));
    await expect(svc.cancel('u1', 'r1')).rejects.toThrow(ServiceUnavailableException);
    expect(lifecycle.closeOpen).not.toHaveBeenCalled();
  });

  it('Gomdon đã huỷ (webhook 2 tới trước phiếu chưa đóng): không gọi huỷ lần nữa, vẫn đóng phiếu và hoàn điểm', async () => {
    const { svc, prisma, gomdon, lifecycle } = setup();
    prisma.wasteRequest.findFirst.mockResolvedValue(R({ gomdonOrderId: 'G1', gomdonPartnerCode: 'BE1', gomdonStatus: '2' }));
    await svc.cancel('u1', 'r1');
    expect(gomdon.cancelOrder).not.toHaveBeenCalled();
    expect(lifecycle.closeOpen.mock.calls[0]![1].data).toBeUndefined();
  });

  it('huỷ hai lần: lần hai thấy CANCELLED nên không đóng, không hoàn, không gọi Gomdon (hoàn đúng một lần)', async () => {
    const { svc, prisma, gomdon, lifecycle } = setup();
    prisma.wasteRequest.findFirst.mockResolvedValue(R({ status: 'CANCELLED', gomdonOrderId: 'G1', gomdonStatus: '2' }));
    await svc.cancel('u1', 'r1');
    expect(lifecycle.closeOpen).not.toHaveBeenCalled();
    expect(gomdon.cancelOrder).not.toHaveBeenCalled();
  });

  it('bưu tá đã lấy rác (IN_TRANSIT hoặc Gomdon 3 trở đi): không huỷ được nữa', async () => {
    for (const row of [R({ status: 'IN_TRANSIT', gomdonStatus: '3' }), R({ status: 'OPEN', gomdonStatus: '4', gomdonOrderId: 'G1' })]) {
      const { svc, prisma, gomdon, lifecycle } = setup();
      prisma.wasteRequest.findFirst.mockResolvedValue(row);
      await expect(svc.cancel('u1', 'r1')).rejects.toThrow(WASTE_MESSAGES.HOME_PICKUP_PICKED_UP);
      expect(gomdon.cancelOrder).not.toHaveBeenCalled();
      expect(lifecycle.closeOpen).not.toHaveBeenCalled();
    }
  });

  it('phiếu không phải của khách hoặc không phải HOME_PICKUP: 404', async () => {
    const { svc, prisma } = setup();
    prisma.wasteRequest.findFirst.mockResolvedValue(null);
    await expect(svc.cancel('u1', 'r1')).rejects.toThrow(NotFoundException);
    prisma.wasteRequest.findFirst.mockResolvedValue(R({ method: 'MAIL_IN' }));
    await expect(svc.cancel('u1', 'r1')).rejects.toThrow(NotFoundException);
  });

  it('isHomePickup chỉ đúng với phiếu HOME_PICKUP của chính khách', async () => {
    const { svc, prisma } = setup();
    prisma.wasteRequest.findFirst.mockResolvedValue({ method: 'HOME_PICKUP' });
    await expect(svc.isHomePickup('u1', 'r1')).resolves.toBe(true);
    expect(prisma.wasteRequest.findFirst).toHaveBeenCalledWith({ where: { id: 'r1', userId: 'u1' }, select: { method: true } });
    prisma.wasteRequest.findFirst.mockResolvedValue({ method: 'DROP_OFF' });
    await expect(svc.isHomePickup('u1', 'r1')).resolves.toBe(false);
    prisma.wasteRequest.findFirst.mockResolvedValue(null);
    await expect(svc.isHomePickup('u1', 'r1')).resolves.toBe(false);
  });
});
