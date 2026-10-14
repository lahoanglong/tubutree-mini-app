import type { MerchantPayout } from './merchant-client';

type PayoutLike = Pick<MerchantPayout, 'amount'> & Partial<Pick<MerchantPayout, 'direction'>>;
type Tone = 'warning' | 'success' | 'neutral';

/** Phiếu âm: gian hàng đã giữ tiền COD nên nộp lại phí sàn cho Tubu. */
export function payoutToTubu(p: PayoutLike): boolean {
  return p.direction ? p.direction === 'TO_TUBU' : p.amount < 0;
}

/** Nhãn trạng thái theo chiều tiền; `admin` là góc nhìn Tubu (phiếu âm Tubu "thu", không phải đối tác "nộp"). */
export function payoutStatus(
  p: PayoutLike & Pick<MerchantPayout, 'status'>,
  viewer: 'merchant' | 'admin' = 'merchant',
): { label: string; tone: Tone } {
  if (p.status === 'CANCELLED') return { label: 'Đã huỷ', tone: 'neutral' };
  if (payoutToTubu(p)) {
    return p.status === 'PAID' ? { label: 'Đã thu', tone: 'success' } : { label: viewer === 'admin' ? 'Chờ thu' : 'Chờ nộp', tone: 'warning' };
  }
  return p.status === 'PAID' ? { label: 'Đã chuyển', tone: 'success' } : { label: 'Chờ chuyển', tone: 'warning' };
}
