/** Chữ và gói gửi chung cho màn xoá tài khoản khi Ví Tubu còn tiền (web và Mini App phải giống nhau). */

/** `amountText` là số tiền đã định dạng theo từng nền ("20.000đ"). */
export const walletForfeitNotice = (amountText: string): string =>
  `Ví Tubu còn ${amountText}. Xoá tài khoản thì số dư này mất và không hoàn lại.`;

export const WALLET_FORFEIT_AGREE = 'Tôi đồng ý bỏ số dư Ví Tubu và hiểu số tiền này không được hoàn lại.';

export const WALLET_FORFEIT_LOADING = 'Đang kiểm tra số dư Ví Tubu…';

export const WALLET_FORFEIT_UNKNOWN = 'Chưa tải được số dư Ví Tubu. Bạn thử lại sau khi tải xong.';

/** Phần đồng ý gửi kèm yêu cầu xoá: chỉ khi Ví còn tiền; máy chủ chỉ nhận khi số này đúng bằng số dư hiện tại. */
export function walletForfeitConsent(balance: number | undefined, agreed: boolean) {
  return balance !== undefined && balance > 0 && agreed ? { acknowledgedWalletBalance: balance, acceptWalletForfeit: true as const } : undefined;
}

/** Nút gửi yêu cầu xoá dùng được chưa: biết số dư, và nếu Ví còn tiền thì khách đã tick đồng ý. */
export function canSubmitDeletion(balance: number | undefined, agreed: boolean): boolean {
  return balance !== undefined && (balance <= 0 || agreed);
}
