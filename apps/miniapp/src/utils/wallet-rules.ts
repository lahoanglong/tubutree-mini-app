export interface WalletBalance {
  walletBalance: number;
}

export interface WithdrawBankInfo {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

/** Điều kiện được phép gửi lệnh rút ví: đủ số tiền tối thiểu, không vượt số dư, đủ thông tin ngân hàng. */
export function canWithdraw(
  amount: number,
  wallet: WalletBalance | undefined,
  min: number,
  bank: WithdrawBankInfo,
): boolean {
  return (
    amount >= min &&
    wallet != null &&
    amount <= wallet.walletBalance &&
    bank.bankName.trim().length > 0 &&
    bank.accountNumber.trim().length >= 6 &&
    bank.accountName.trim().length > 0
  );
}

const WALLET_TX_LABELS: Record<string, string> = {
  OPENING: 'Số dư đầu kỳ',
  ORDER_PAY: 'Thanh toán đơn hàng',
  ORDER_REFUND: 'Hoàn tiền đơn hàng',
  COMMISSION_PAYOUT: 'Hoa hồng CTV về Ví',
  CASHBACK: 'Hoàn tiền sàn ngoài',
  WITHDRAW: 'Rút về ngân hàng',
  WITHDRAW_REFUND: 'Hoàn lệnh rút bị từ chối',
  XU_CONVERT: 'Đổi sang xu cũ (nay là Điểm Xanh)',
  MERGE_IN: 'Chuyển từ phiên mua khách',
  MERGE_OUT: 'Chuyển sang tài khoản chính',
  ADJUST: 'Điều chỉnh',
};

/** Nhãn dòng sao kê Ví theo loại biến động; loại BE mới thêm mà bản app cũ chưa biết vẫn hiện được. */
export function walletTxLabel(type: string): string {
  return WALLET_TX_LABELS[type] ?? 'Biến động ví';
}

/** dd/MM HH:mm theo giờ máy — không dùng toLocale* vì ICU mới đổi định dạng ngày "vi-VN". */
export function formatWalletTxTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
