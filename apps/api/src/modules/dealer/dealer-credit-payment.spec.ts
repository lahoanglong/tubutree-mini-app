import 'reflect-metadata';
import { BadRequestException, NotFoundException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { DealerService } from './dealer.service';
import { DealerCreditAdminController, RecordDealerCreditPaymentDto } from './dealer-admin.controller';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

/**
 * A5-09 (docs/audit-2026-09/05-ctv-dealer-staff.md): đại lý tự bấm "Báo đã CK" trước đây TRỪ NỢ
 * NGAY, không có xác nhận ngân hàng thật và không chặn số tiền vượt dư nợ — có thể tự xoá nợ vô hạn
 * lần. Giờ tách làm 2:
 *  - reportCreditPayment (đại lý): CHỈ báo cho admin, không đụng DealerCreditLedger ở đâu cả.
 *  - adminRecordCreditPayment (admin): nguồn DUY NHẤT được phép giảm công nợ, trần theo dư nợ TẠI
 *    LÚC DUYỆT (re-check trong transaction Serializable), atomic.
 */

function makeConfig(): SystemConfigService {
  return { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
}

describe('DealerService.reportCreditPayment (đại lý báo — KHÔNG được đụng ledger)', () => {
  function build(opts: {
    user?: { id: string; role: string; metadata?: unknown } | null;
    entries?: { delta: number }[];
    admins?: { id: string }[];
  } = {}) {
    const ledgerCreate = jest.fn();
    const notify = jest.fn().mockResolvedValue(undefined);
    const prisma: Record<string, unknown> = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(opts.user ?? { id: 'd1', role: 'DEALER', metadata: null }),
        findUnique: jest.fn().mockResolvedValue({ fullName: 'Cty A', phone: '0900000000' }),
        findMany: jest.fn().mockResolvedValue(opts.admins ?? [{ id: 'admin1' }]),
      },
      dealerTier: { findUnique: jest.fn().mockResolvedValue(null) },
      dealerCreditLedger: { findMany: jest.fn().mockResolvedValue(opts.entries ?? [{ delta: 200_000 }]), create: ledgerCreate },
    };
    const notifications = { notify };
    const svc = new DealerService(prisma as unknown as PrismaService, makeConfig(), notifications as never);
    return { svc, prisma, ledgerCreate, notify };
  }

  it('chặn user không phải DEALER — KHÔNG báo admin, KHÔNG đụng ledger', async () => {
    const { svc, ledgerCreate, notify } = build({ user: { id: 'u1', role: 'CUSTOMER', metadata: null } });
    await expect(svc.reportCreditPayment('u1', 50_000, 'note')).rejects.toThrow();
    expect(ledgerCreate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('đại lý hợp lệ, số tiền hợp lệ → CHỈ báo admin (notify), KHÔNG tạo bất kỳ dòng DealerCreditLedger nào', async () => {
    const { svc, ledgerCreate, notify } = build({ entries: [{ delta: 200_000 }] });
    const res = await svc.reportCreditPayment('d1', 50_000, 'CK lúc 9h');
    expect(ledgerCreate).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      'admin1',
      'DEALER_CREDIT_PAYMENT_REPORTED',
      expect.objectContaining({ dealer: 'Cty A', amount: '50.000' }),
    );
    expect(res).toMatchObject({ ok: true });
    expect(res.message).toContain('admin xác nhận');
  });

  it('số tiền báo vượt dư nợ hiện tại → BadRequest, KHÔNG báo admin (chặn sớm — trần thật re-check ở admin duyệt)', async () => {
    const { svc, notify, ledgerCreate } = build({ entries: [{ delta: 30_000 }] }); // dư nợ 30k
    await expect(svc.reportCreditPayment('d1', 50_000)).rejects.toBeInstanceOf(BadRequestException);
    expect(notify).not.toHaveBeenCalled();
    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it('số tiền <= 0 → BadRequest', async () => {
    const { svc } = build();
    await expect(svc.reportCreditPayment('d1', 0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.reportCreditPayment('d1', -1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('không có admin nào để báo → không throw (best-effort), vẫn trả ok', async () => {
    const { svc, notify } = build({ admins: [] });
    const res = await svc.reportCreditPayment('d1', 50_000);
    expect(notify).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });

  it('NotificationsService chưa wiring (dựng tay không truyền) → không throw', async () => {
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'd1', role: 'DEALER', metadata: null }) },
      dealerTier: { findUnique: jest.fn().mockResolvedValue(null) },
      dealerCreditLedger: { findMany: jest.fn().mockResolvedValue([{ delta: 200_000 }]) },
    } as unknown as PrismaService;
    const svc = new DealerService(prisma, makeConfig());
    await expect(svc.reportCreditPayment('d1', 50_000)).resolves.toMatchObject({ ok: true });
  });
});

describe('DealerService.adminRecordCreditPayment (admin xác nhận — nguồn DUY NHẤT được giảm công nợ)', () => {
  function build(opts: {
    dealer?: { id: string; role: string; fullName?: string | null; phone?: string | null } | null;
    debt?: number;
    existingClaim?: { delta: number } | null;
  } = {}) {
    const dealer =
      opts.dealer === undefined ? { id: 'd1', role: 'DEALER', fullName: 'Cty A', phone: '0900000000' } : opts.dealer;
    const debt = opts.debt ?? 500_000;
    const ledgerCreate = jest.fn().mockResolvedValue({});
    const aggregate = jest.fn().mockResolvedValue({ _sum: { delta: debt } });
    const findFirst = jest.fn().mockResolvedValue(opts.existingClaim === undefined ? null : opts.existingClaim);
    const notify = jest.fn().mockResolvedValue(undefined);
    const prisma: Record<string, unknown> = {
      user: { findUnique: jest.fn().mockResolvedValue(dealer) },
      dealerCreditLedger: {
        findFirst,
        aggregate,
        create: ledgerCreate,
        findMany: jest.fn().mockResolvedValue([{ delta: debt }]),
      },
    };
    prisma.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
    const notifications = { notify };
    const svc = new DealerService(prisma as unknown as PrismaService, makeConfig(), notifications as never);
    return { svc, prisma, ledgerCreate, aggregate, findFirst, notify };
  }

  it('số tiền <= dư nợ → tạo dòng PAYMENT delta ÂM đúng bằng amount, ghi rõ admin + bankRef + note, báo đại lý', async () => {
    const { svc, ledgerCreate, notify } = build({ debt: 500_000 });
    await svc.adminRecordCreditPayment('admin1', 'd1', 300_000, { bankRef: 'FT123', note: 'VCB' });
    expect(ledgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'd1', delta: -300_000, refType: 'PAYMENT' }),
      }),
    );
    const note = (ledgerCreate.mock.calls[0]![0] as { data: { note: string } }).data.note;
    expect(note).toContain('admin1');
    expect(note).toContain('FT123');
    expect(note).toContain('VCB');
    expect(notify).toHaveBeenCalledWith('d1', 'DEALER_CREDIT_PAYMENT_CONFIRMED', { amount: '300.000' });
  });

  it('số tiền VƯỢT dư nợ HIỆN TẠI (re-check trong tx) → BadRequest, KHÔNG tạo dòng ledger nào', async () => {
    const { svc, ledgerCreate } = build({ debt: 100_000 });
    await expect(svc.adminRecordCreditPayment('admin1', 'd1', 200_000)).rejects.toBeInstanceOf(BadRequestException);
    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it('dư nợ đã đổi GIỮA lúc đại lý báo và lúc admin duyệt (vd đơn CREDIT mới) → re-check trong tx bắt đúng, chặn duyệt', async () => {
    // aggregate mô phỏng dư nợ NGAY TRONG tx tại lúc duyệt — thấp hơn số admin nhìn thấy lúc mở màn hình.
    const { svc, aggregate, ledgerCreate } = build({ debt: 250_000 });
    await expect(svc.adminRecordCreditPayment('admin1', 'd1', 300_000)).rejects.toThrow(/vượt dư nợ/);
    expect(aggregate).toHaveBeenCalledWith({ where: { userId: 'd1' }, _sum: { delta: true } });
    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it('đại lý không tồn tại → NotFound, không mở transaction', async () => {
    const { svc, prisma } = build({ dealer: null });
    await expect(svc.adminRecordCreditPayment('admin1', 'nope', 50_000)).rejects.toBeInstanceOf(NotFoundException);
    expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).not.toHaveBeenCalled();
  });

  it('user tồn tại nhưng KHÔNG phải DEALER → NotFound', async () => {
    const { svc } = build({ dealer: { id: 'u1', role: 'CUSTOMER' } });
    await expect(svc.adminRecordCreditPayment('admin1', 'u1', 50_000)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('số tiền <= 0 → BadRequest', async () => {
    const { svc } = build();
    await expect(svc.adminRecordCreditPayment('admin1', 'd1', 0)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Idempotency-Key trùng, CÙNG số tiền (bấm đúp/retry) → trả lại sổ công nợ hiện tại, KHÔNG tạo dòng mới', async () => {
    const { svc, ledgerCreate } = build({ existingClaim: { delta: -50_000 } });
    const res = await svc.adminRecordCreditPayment('admin1', 'd1', 50_000, { idempotencyKey: 'key-1' });
    expect(ledgerCreate).not.toHaveBeenCalled();
    expect(res).toMatchObject({ balance: expect.any(Number) });
  });

  it('Idempotency-Key trùng nhưng số tiền KHÁC → BadRequest (không âm thầm dùng nhầm số cũ)', async () => {
    const { svc, ledgerCreate } = build({ existingClaim: { delta: -50_000 } });
    await expect(
      svc.adminRecordCreditPayment('admin1', 'd1', 70_000, { idempotencyKey: 'key-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it('race 2 admin duyệt CÙNG lúc cho CÙNG đại lý (P2034 serialization failure) → BadRequest thân thiện, không sập 500', async () => {
    const { svc, prisma } = build({ debt: 500_000 });
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn().mockRejectedValue(
      Object.assign(new Error('could not serialize access'), { code: 'P2034' }),
    );
    await expect(svc.adminRecordCreditPayment('admin1', 'd1', 100_000)).rejects.toThrow(/đang bận/);
  });

  it('race P2002 khi CÓ Idempotency-Key (2 request cùng key qua pre-check, request thua ăn unique) → trả lại sổ công nợ hiện tại', async () => {
    const { svc, prisma } = build({ debt: 500_000, existingClaim: null });
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    await expect(svc.adminRecordCreditPayment('admin1', 'd1', 100_000, { idempotencyKey: 'key-2' })).resolves.toMatchObject(
      { balance: expect.any(Number) },
    );
  });
});

describe('DealerCreditAdminController (POST /api/admin/dealers/:userId/credit-payment)', () => {
  it('chỉ ADMIN, đúng đường dẫn/method', () => {
    expect(Reflect.getMetadata(ROLES_KEY, DealerCreditAdminController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(PATH_METADATA, DealerCreditAdminController)).toBe('admin/dealers');
    const fn = (DealerCreditAdminController.prototype as unknown as Record<string, object>).recordPayment!;
    expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe(':userId/credit-payment');
  });

  it('chuyển adminId (JWT sub) + userId + dto + idempotency-key xuống service', async () => {
    const svc = { adminRecordCreditPayment: jest.fn().mockResolvedValue({ balance: 0, entries: [] }) };
    await new DealerCreditAdminController(svc as never).recordPayment(
      'admin1',
      'd1',
      { amount: 100_000, bankRef: 'FT1', note: 'x' },
      'idem-1',
    );
    expect(svc.adminRecordCreditPayment).toHaveBeenCalledWith('admin1', 'd1', 100_000, {
      note: 'x',
      bankRef: 'FT1',
      idempotencyKey: 'idem-1',
    });
  });

  it('GET :userId/credit-ledger → uỷ quyền DealerService.creditLedger(userId)', async () => {
    const svc = { creditLedger: jest.fn().mockResolvedValue({ balance: 0, entries: [] }) };
    await new DealerCreditAdminController(svc as never).ledger('d1');
    expect(svc.creditLedger).toHaveBeenCalledWith('d1');
  });

  it('RecordDealerCreditPaymentDto: amount bắt buộc >=1 (số nguyên); bankRef/note tuỳ chọn, giới hạn độ dài', async () => {
    expect(await validate(plainToInstance(RecordDealerCreditPaymentDto, { amount: 1 }))).toHaveLength(0);
    expect(await validate(plainToInstance(RecordDealerCreditPaymentDto, { amount: 100_000, bankRef: 'FT1', note: 'ok' }))).toHaveLength(0);
    const bad = await validate(plainToInstance(RecordDealerCreditPaymentDto, { amount: 0 }));
    expect(bad.map((e) => e.property)).toContain('amount');
    const badLen = await validate(
      plainToInstance(RecordDealerCreditPaymentDto, { amount: 1, bankRef: 'x'.repeat(101), note: 'y'.repeat(501) }),
    );
    expect(badLen.map((e) => e.property).sort()).toEqual(['bankRef', 'note']);
  });
});
