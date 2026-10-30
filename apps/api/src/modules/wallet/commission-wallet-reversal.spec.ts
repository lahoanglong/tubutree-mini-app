import type { Prisma } from '@prisma/client';
import { debitCommissionFromWallet, walletShareOfCommission } from './commission-wallet-reversal';
import { applyWalletDelta } from './wallet-ledger.service';

jest.mock('./wallet-ledger.service', () => ({
  applyWalletDelta: jest.fn(async (_tx: unknown, input: { delta: number }) => ({ applied: true, balanceAfter: 1_000 + input.delta, entryId: 'w1' })),
}));
const ledger = jest.mocked(applyWalletDelta);

describe('walletShareOfCommission: phần hoa hồng thực sự đã vào Ví của lệnh chuyển gốc', () => {
  it('lệnh chuyển không thuế (hoặc lệnh cũ không có grossAmount): trừ đủ số gộp', () => {
    expect(walletShareOfCommission(10_000, { grossAmount: 10_000, taxWithheld: 0, taxRefunded: 0 })).toEqual({ debit: 10_000, tax: 0 });
    expect(walletShareOfCommission(10_000, { grossAmount: null, taxWithheld: 0, taxRefunded: 0 })).toEqual({ debit: 10_000, tax: 0 });
    expect(walletShareOfCommission(10_000, null)).toEqual({ debit: 10_000, tax: 0 });
  });

  it('lệnh chuyển bị giữ thuế: chỉ trừ phần thực nhận theo tỉ lệ thuế thực giữ trên tổng hoa hồng của lệnh', () => {
    // Chuyển 6.000.000đ, giữ 600.000đ, Ví nhận 5.400.000đ: hoa hồng 500.000đ chỉ có 450.000đ nằm trong Ví.
    expect(walletShareOfCommission(500_000, { grossAmount: 6_000_000, taxWithheld: 600_000, taxRefunded: 0 })).toEqual({ debit: 450_000, tax: 600_000 });
  });

  it('thuế thực giữ = taxWithheld − taxRefunded: phần đã hoàn về Ví không còn là thuế', () => {
    expect(walletShareOfCommission(500_000, { grossAmount: 6_000_000, taxWithheld: 600_000, taxRefunded: 600_000 })).toEqual({ debit: 500_000, tax: 0 });
    expect(walletShareOfCommission(500_000, { grossAmount: 6_000_000, taxWithheld: 600_000, taxRefunded: 300_000 })).toEqual({ debit: 475_000, tax: 300_000 });
  });

  it('lệnh chuyển bị truy thu ăn hết (Ví nhận 0đ): không trừ gì, nhưng vẫn báo có thuế', () => {
    expect(walletShareOfCommission(10_000, { grossAmount: 10_000, taxWithheld: 10_000, taxRefunded: 0 })).toEqual({ debit: 0, tax: 10_000 });
  });

  it('làm tròn: phần thuế lẻ làm tròn gần nhất, không bao giờ trừ quá số gộp hay xuống dưới 0', () => {
    const r = walletShareOfCommission(3_333, { grossAmount: 10_000, taxWithheld: 1_000, taxRefunded: 0 });
    expect(r.debit).toBe(3_000);
    expect(walletShareOfCommission(1, { grossAmount: 10, taxWithheld: 10, taxRefunded: 0 }).debit).toBe(0);
    expect(walletShareOfCommission(5, { grossAmount: 10, taxWithheld: 99, taxRefunded: 0 }).debit).toBe(0);
  });
});

describe('debitCommissionFromWallet', () => {
  const commission = { id: 'c1', affiliateUserId: 'ctv', walletPayoutId: 'p1' as string | null, paidAt: new Date('2026-10-05T03:00:00Z') };

  function makeTx(opts: { payout?: { grossAmount: number | null; taxWithheld: number; taxRefunded: number } | null; metadata?: unknown; balance?: number } = {}) {
    const payoutFindUnique = jest.fn().mockResolvedValue(opts.payout === undefined ? { grossAmount: 6_000_000, taxWithheld: 600_000, taxRefunded: 0 } : opts.payout);
    const payoutFindFirst = jest.fn().mockResolvedValue(opts.payout === undefined ? { grossAmount: 6_000_000, taxWithheld: 600_000, taxRefunded: 0 } : opts.payout);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ metadata: opts.metadata ?? null, walletBalance: opts.balance ?? 7_000 }]),
      payout: { findUnique: payoutFindUnique, findFirst: payoutFindFirst },
    } as unknown as Prisma.TransactionClient;
    return { tx, payoutFindUnique, payoutFindFirst };
  }
  const input = (over: Partial<Parameters<typeof debitCommissionFromWallet>[1]> = {}) => ({ commission, amount: 500_000, refId: 'c1', reason: 'Thu hồi', ...over });
  beforeEach(() => ledger.mockClear());

  it('trừ phần thực nhận (sau thuế của lệnh chuyển gốc), cho phép âm, trả cả số thuế để báo kế toán', async () => {
    const { tx, payoutFindUnique, payoutFindFirst } = makeTx();
    const res = await debitCommissionFromWallet(tx, input());
    expect(res).toEqual({ debited: true, applied: true, walletDebit: 450_000, taxWithheld: 600_000, balanceAfter: 1_000 - 450_000 });
    expect(ledger).toHaveBeenCalledWith(tx, expect.objectContaining({ userId: 'ctv', delta: -450_000, type: 'COMMISSION_REVERSAL', refType: 'COMMISSION', refId: 'c1', allowNegative: true }));
    expect(payoutFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1' } }));
    expect(payoutFindFirst).not.toHaveBeenCalled();
  });

  it('hoa hồng cũ chưa có walletPayoutId: lấy lệnh chuyển Ví gần nhất của CTV không muộn hơn lúc hoa hồng thành PAID', async () => {
    const { tx, payoutFindUnique, payoutFindFirst } = makeTx();
    const res = await debitCommissionFromWallet(tx, input({ commission: { ...commission, walletPayoutId: null } }));
    expect(res).toMatchObject({ debited: true, walletDebit: 450_000, taxWithheld: 600_000 });
    expect(payoutFindUnique).not.toHaveBeenCalled();
    expect(payoutFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'ctv', method: 'WALLET_BALANCE', status: { not: 'REJECTED' }, requestedAt: { lte: commission.paidAt } },
        orderBy: { requestedAt: 'desc' },
      }),
    );
  });

  it('lệnh chuyển cũ trước khi có khấu trừ thuế (grossAmount rỗng): cộng đủ vào Ví, trừ đủ số gộp', async () => {
    const { tx } = makeTx({ payout: { grossAmount: null, taxWithheld: 0, taxRefunded: 0 } });
    const res = await debitCommissionFromWallet(tx, input({ commission: { ...commission, walletPayoutId: null } }));
    expect(res).toMatchObject({ debited: true, walletDebit: 500_000, taxWithheld: 0 });
  });

  it('không xác định được lệnh chuyển gốc (không có walletPayoutId và không tìm ra lệnh, hoặc không có paidAt): không trừ, báo thủ công', async () => {
    const none = makeTx({ payout: null });
    expect(await debitCommissionFromWallet(none.tx, input({ commission: { ...commission, walletPayoutId: null } }))).toEqual({ debited: false, reason: 'PAYOUT_UNKNOWN' });
    expect(await debitCommissionFromWallet(none.tx, input())).toEqual({ debited: false, reason: 'PAYOUT_UNKNOWN' });
    const noPaidAt = makeTx();
    expect(await debitCommissionFromWallet(noPaidAt.tx, input({ commission: { ...commission, walletPayoutId: null, paidAt: null } }))).toEqual({ debited: false, reason: 'PAYOUT_UNKNOWN' });
    expect(noPaidAt.payoutFindFirst).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
  });

  it('lệnh tra theo thời điểm không đủ chứa hoa hồng (grossAmount nhỏ hơn số thu hồi): coi là sai lệnh, không trừ', async () => {
    const { tx } = makeTx({ payout: { grossAmount: 100_000, taxWithheld: 10_000, taxRefunded: 0 } });
    expect(await debitCommissionFromWallet(tx, input({ commission: { ...commission, walletPayoutId: null } }))).toEqual({ debited: false, reason: 'PAYOUT_UNKNOWN' });
  });

  it('phần thực nhận bằng 0: không ghi dòng sổ 0đ, trả số dư hiện tại và số thuế', async () => {
    const { tx } = makeTx({ payout: { grossAmount: 10_000, taxWithheld: 10_000, taxRefunded: 0 }, balance: 7_000 });
    const res = await debitCommissionFromWallet(tx, input({ amount: 10_000 }));
    expect(res).toEqual({ debited: true, applied: true, walletDebit: 0, taxWithheld: 10_000, balanceAfter: 7_000 });
    expect(ledger).not.toHaveBeenCalled();
  });

  it('CTV đã ẩn danh: không trừ, báo thủ công', async () => {
    const { tx } = makeTx({ metadata: { anonymizedAt: '2026-10-01T00:00:00.000Z' } });
    const res = await debitCommissionFromWallet(tx, input());
    expect(res).toEqual({ debited: false, reason: 'ANONYMIZED' });
    expect(ledger).not.toHaveBeenCalled();
  });
});
