const WALLET_TX_LABELS: Record<string, string> = {
  OPENING: 'Số dư đầu kỳ',
  ORDER_PAY: 'Thanh toán đơn',
  ORDER_REFUND: 'Hoàn tiền đơn hàng',
  COMMISSION_PAYOUT: 'Hoa hồng CTV về Ví',
  COMMISSION_REVERSAL: 'Thu hồi hoa hồng',
  CASHBACK: 'Hoàn tiền sàn ngoài',
  WITHDRAW: 'Rút về ngân hàng',
  WITHDRAW_REFUND: 'Hoàn lệnh rút bị từ chối',
  PIT_REFUND: 'Hoàn thuế TNCN giữ dư',
  XU_CONVERT: 'Đổi sang xu cũ (nay là Điểm Xanh)',
  MERGE_IN: 'Chuyển từ phiên mua khách',
  MERGE_OUT: 'Chuyển sang tài khoản chính',
  ADJUST: 'Điều chỉnh',
};

/** Nhãn dòng sao kê Ví theo loại biến động; loại BE mới thêm mà bản app cũ chưa biết vẫn hiện được.
 * ORDER_REFUND gộp mọi nguồn hoàn; chỉ "Hoàn tiền trả hàng đơn …" (trả một phần) chắc chắn là trả hàng. "Hoàn tiền đơn …" API ghi cả cho huỷ đơn, trả hàng toàn phần và đổi nơi nhận về Ví nên không đoán nguồn. */
export function walletTxLabel(type: string, reason?: string | null): string {
  if (type === 'ORDER_REFUND' && reason) {
    if (reason.startsWith('Hoàn tiền trả hàng')) return 'Hoàn tiền trả hàng';
  }
  return WALLET_TX_LABELS[type] ?? 'Biến động ví';
}

/**
 * Ví âm khi hoa hồng đã vào Ví của một đơn sau đó bị trả: tiền đã nhận không còn nguồn nên API trừ thẳng Ví (số dư có thể âm).
 * Hoa hồng mới về Ví cộng vào số âm cho tới khi về 0; trong lúc âm, Ví không trả đơn được. null khi Ví không âm.
 */
export function walletNegativeNote(balance: number): string | null {
  if (!(balance < 0)) return null;
  return 'Ví đang âm vì hoa hồng của đơn trả hàng đã được thu hồi. Hoa hồng mới về Ví sẽ bù vào số âm này. Trong lúc đó chưa dùng Ví để trả đơn được.';
}

/** Lý do nút trả đơn bằng Ví bị khoá khi Ví đang âm; `owed` là số âm đã định dạng tiền (vd "50.000đ"). */
export function walletNegativeCheckoutReason(owed: string): string {
  return `Ví đang âm ${owed} do thu hồi hoa hồng đơn trả hàng, nên chưa trả đơn bằng Ví được. Hãy chọn cách thanh toán khác.`;
}

/** dd/MM HH:mm theo giờ máy — không dùng toLocale* vì ICU mới đổi định dạng ngày "vi-VN". */
export function formatWalletTxTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
