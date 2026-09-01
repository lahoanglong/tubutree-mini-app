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

/** Điều kiện được phép đổi Ví → TubuXu: số dương, không vượt số dư ví. */
export function canConvertToXu(amount: number, wallet: WalletBalance | undefined): boolean {
  return wallet != null && amount > 0 && amount <= wallet.walletBalance;
}
