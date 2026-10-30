import type { Prisma } from '@prisma/client';
import { debitCommissionFromWallet, walletShareOfCommission } from './commission-wallet-reversal';
import { applyWalletDelta } from './wallet-ledger.service';

jest.mock('./wallet-ledger.service', () => ({
  applyWalletDelta: jest.fn(async (_tx: unknown, input: { delta: number }) => ({ applied: true, balanceAfter: 1_000 + input.delta, entryId: 'w1' })),
}));
const ledger = jest.mocked(applyWalletDelta);

describe('walletShareOfCommission: phần hoa hồng thực sự đã vào Ví của lệnh chuyển gốc', () => {
  it('lệnh chuyển không thuế (hoặc lệnh cũ không có grossAmount): trừ đủ số gộp', () => {
    expect(walletShareOfCommission(10_000, { grossAmount: 10_000, taxWithheld: 0, taxRefunded: 0 })).toEqual({ debit: 10_000, taxShare: 0, tax: 0 });
    expect(walletShareOfCommission(10_000, { grossAmount: null, taxWithheld: 0, taxRefunded: 0 })).toEqual({ debit: 10_000, taxShare: 0, tax: 0 });
    expect(walletShareOfCommission(10_000, null)).toEqual({ debit: 10_000, taxShare: 0, tax: 0 });
  });

  it('lệnh chuyển bị giữ thuế: chỉ trừ phần thực nhận; taxShare là phần thuế của riêng khoản này, tax là thuế cả lệnh', () => {
    // Chuyển 6.000.000đ, giữ 600.000đ, Ví nhận 5.400.000đ: hoa hồng 500.000đ chỉ có 450.000đ nằm trong Ví.
    expect(walletShareOfCommission(500_000, { grossAmount: 6_000_000, taxWithheld: 600_000, taxRefunded: 0 })).toEqual({ debit: 450_000, taxShare: 50_000, tax: 600_000 });
  });

  it('thuế thực giữ = taxWithheld − taxRefunded: phần đã hoàn về Ví không còn là thuế', () => {
    expect(walletShareOfCommission(500_000, { grossAmount: 6_000_000, taxWithheld: 600_000, taxRefunded: 600_000 })).toEqual({ debit: 500_000, taxShare: 0, tax: 0 });
    expect(walletShareOfCommission(500_000, { grossAmount: 6_000_000, taxWithheld: 600_000, taxRefunded: 300_000 })).toEqual({ debit: 475_000, taxShare: 25_000, tax: 300_000 });
  });

  it('lệnh chuyển bị truy thu ăn hết (Ví nhận 0đ): không trừ gì, cả khoản là phần thuế', () => {
    expect(walletShareOfCommission(10_000, { grossAmount: 10_000, taxWithheld: 10_000, taxRefunded: 0 })).toEqual({ debit: 0, taxShare: 10_000, tax: 10_000 });
  });

  it('làm tròn: phần thuế lẻ làm tròn lên, nên phần trừ Ví làm tròn xuống, không bao giờ quá số gộp hay xuống dưới 0', () => {
    expect(walletShareOfCommission(3_333, { grossAmount: 10_000, taxWithheld: 1_000, taxRefunded: 0 })).toEqual({ debit: 2_999, taxShare: 334, tax: 1_000 });
    expect(walletShareOfCommission(1, { grossAmount: 10, taxWithheld: 10, taxRefunded: 0 }).debit).toBe(0);
    expect(walletShareOfCommission(5, { grossAmount: 10, taxWithheld: 99, taxRefunded: 0 }).debit).toBe(0);
  });

  it('lệnh 5.300.000đ giữ 530.000đ, hoa hồng 12.342đ bị cắt ba lần 4.114đ: tổng trừ Ví không vượt phần hoa hồng này đã nhận', () => {
    const payout = { grossAmount: 5_300_000, taxWithheld: 530_000, taxRefunded: 0 };
    const debits = [4_114, 4_114, 4_114].map((cut) => walletShareOfCommission(cut, payout).debit);
    expect(debits).toEqual([3_702, 3_702, 3_702]);
    // Phần hoa hồng 12.342đ đã vào Ví: 12.342 × (5.300.000 − 530.000) / 5.300.000 = 11.107,8đ.
    expect(debits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual((12_342 * (5_300_000 - 530_000)) / 5_300_000);
  });

  it('mọi số cắt: phần trừ Ví không vượt đúng tỉ lệ đã nhận, nên thu hồi hết các hoa hồng của một lệnh không trừ quá số lệnh đã cộng vào Ví', () => {
    const payout = { grossAmount: 5_300_000, taxWithheld: 530_000, taxRefunded: 0 };
    for (let cut = 1; cut <= 5_000; cut += 1) {
      const { debit, taxShare } = walletShareOfCommission(cut, payout);
      expect(debit + taxShare).toBe(cut);
      expect(debit * 5_300_000).toBeLessThanOrEqual(cut * (5_300_000 - 530_000));
    }
  });
});

describe('debitCommissionFromWallet', () => {
  const commission = { id: 'c1', affiliateUserId: 'ctv', walletPayoutId: 'p1' as string | null, paidAt: new Date('2026-10-05T03:00:00Z') };
  type PayoutRow = { id?: string; grossAmount: number | null; taxWithheld: number; taxRefunded: number; paidAt?: Date | null; requestedAt?: Date };
  const taxedPayout: PayoutRow = {
    id: 'p1',
    grossAmount: 6_000_000,
    taxWithheld: 600_000,
    taxRefunded: 0,
    paidAt: new Date('2026-09-30T17:30:00Z'), // 00:30 ngày 01/10 giờ VN: kê khai tháng 10
    requestedAt: new Date('2026-09-30T17:29:59Z'),
  };

  function makeTx(opts: { payout?: PayoutRow | null; metadata?: unknown; balance?: number } = {}) {
    const row = opts.payout === undefined ? taxedPayout : opts.payout && { id: 'p1', paidAt: taxedPayout.paidAt, requestedAt: taxedPayout.requestedAt, ...opts.payout };
    const payoutFindUnique = jest.fn().mockResolvedValue(row);
    const payoutFindFirst = jest.fn().mockResolvedValue(row);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ metadata: opts.metadata ?? null, walletBalance: opts.balance ?? 7_000 }]),
      payout: { findUnique: payoutFindUnique, findFirst: payoutFindFirst },
    } as unknown as Prisma.TransactionClient;
    return { tx, payoutFindUnique, payoutFindFirst };
  }
  const input = (over: Partial<Parameters<typeof debitCommissionFromWallet>[1]> = {}) => ({ commission, amount: 500_000, refId: 'c1', reason: 'Thu hồi', ...over });
  beforeEach(() => ledger.mockClear());

  it('trừ phần thực nhận (sau thuế của lệnh chuyển gốc), cho phép âm; trả phần thuế của khoản, thuế cả lệnh, lệnh gốc và tháng đã kê thu nhập', async () => {
    const { tx, payoutFindUnique, payoutFindFirst } = makeTx();
    const res = await debitCommissionFromWallet(tx, input());
    expect(res).toEqual({
      debited: true,
      applied: true,
      note: {
        affiliateUserId: 'ctv',
        amount: 500_000,
        walletDebit: 450_000,
        taxShare: 50_000,
        payoutTax: 600_000,
        payoutId: 'p1',
        incomeDeclared: true,
        incomeMonth: '2026-10',
        balanceAfter: 1_000 - 450_000,
      },
    });
    expect(ledger).toHaveBeenCalledWith(tx, expect.objectContaining({ userId: 'ctv', delta: -450_000, type: 'COMMISSION_REVERSAL', refType: 'COMMISSION', refId: 'c1', allowNegative: true }));
    expect(payoutFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1' } }));
    expect(payoutFindFirst).not.toHaveBeenCalled();
  });

  it('hoa hồng cũ chưa có walletPayoutId: lấy lệnh chuyển Ví gần nhất của CTV tạo trước và chi sau lúc hoa hồng thành PAID', async () => {
    const { tx, payoutFindUnique, payoutFindFirst } = makeTx();
    const res = await debitCommissionFromWallet(tx, input({ commission: { ...commission, walletPayoutId: null } }));
    expect(res).toMatchObject({ debited: true, note: { walletDebit: 450_000, taxShare: 50_000, payoutTax: 600_000, payoutId: 'p1' } });
    expect(payoutFindUnique).not.toHaveBeenCalled();
    expect(payoutFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'ctv',
          method: 'WALLET_BALANCE',
          status: { not: 'REJECTED' },
          requestedAt: { lte: commission.paidAt },
          paidAt: { gte: commission.paidAt },
        },
        orderBy: { requestedAt: 'desc' },
      }),
    );
  });

  it('lệnh chuyển cũ trước khi có khấu trừ thuế (grossAmount rỗng): cộng đủ vào Ví, trừ đủ số gộp, thu nhập chưa kê ở báo cáo thuế', async () => {
    const { tx } = makeTx({ payout: { grossAmount: null, taxWithheld: 0, taxRefunded: 0 } });
    const res = await debitCommissionFromWallet(tx, input({ commission: { ...commission, walletPayoutId: null } }));
    expect(res).toMatchObject({ debited: true, note: { walletDebit: 500_000, taxShare: 0, payoutTax: 0, incomeDeclared: false } });
  });

  it('lệnh không thuế nhưng có grossAmount: vẫn là thu nhập đã kê', async () => {
    const { tx } = makeTx({ payout: { grossAmount: 600_000, taxWithheld: 0, taxRefunded: 0 } });
    const res = await debitCommissionFromWallet(tx, input());
    expect(res).toMatchObject({ debited: true, note: { walletDebit: 500_000, taxShare: 0, incomeDeclared: true, incomeMonth: '2026-10' } });
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

  it('phần thực nhận bằng 0: không ghi dòng sổ 0đ, trả số dư hiện tại, cả khoản là phần thuế', async () => {
    const { tx } = makeTx({ payout: { grossAmount: 10_000, taxWithheld: 10_000, taxRefunded: 0 }, balance: 7_000 });
    const res = await debitCommissionFromWallet(tx, input({ amount: 10_000 }));
    expect(res).toMatchObject({ debited: true, applied: true, note: { walletDebit: 0, taxShare: 10_000, payoutTax: 10_000, balanceAfter: 7_000 } });
    expect(ledger).not.toHaveBeenCalled();
  });

  it('CTV đã ẩn danh: không trừ, báo thủ công', async () => {
    const { tx } = makeTx({ metadata: { anonymizedAt: '2026-10-01T00:00:00.000Z' } });
    const res = await debitCommissionFromWallet(tx, input());
    expect(res).toEqual({ debited: false, reason: 'ANONYMIZED' });
    expect(ledger).not.toHaveBeenCalled();
  });
});
