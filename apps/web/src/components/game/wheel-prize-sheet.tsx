import type { SpinResult } from '@tubutree/app-core/api/game';
import { Sheet } from '@/components/ui/sheet';
import { formatDate } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { formatDrops, formatNumber } from './format';

type Prize = SpinResult['prize'];

type Outcome = 'COUPON' | 'SEEDS' | 'POINTS' | 'MISS';

function outcomeOf(prize: Prize): Outcome {
  if (prize.rewardType === 'COUPON' && prize.coupon) return 'COUPON';
  if (prize.rewardType === 'SEEDS' && prize.value > 0) return 'SEEDS';
  if (prize.rewardType === 'POINTS' && prize.value > 0) return 'POINTS';
  return 'MISS';
}

/**
 * Hộp kết quả vòng quay, đặt ở cấp trang (ngoài các khối tab): kết quả về sau vài giây, lúc đó khách có thể đã sang tab
 * khác. `prize` được giữ lại sau khi đóng để nội dung không biến mất giữa chừng.
 *
 * Nội dung theo loại giải: chỉ giải có thật (voucher, giọt nước, điểm) mới chúc mừng kèm pháo hoa; lượt không trúng gì
 * chỉ động viên, để khách không đọc "Chúc mừng!" rồi mới thấy mình trắng tay.
 */
export function WheelPrizeSheet({
  prize,
  open,
  onClose,
  onUseCoupon,
}: {
  prize: Prize | null;
  open: boolean;
  onClose: () => void;
  onUseCoupon: () => void;
}) {
  const outcome = prize ? outcomeOf(prize) : 'POINTS';
  const won = outcome !== 'MISS';

  const useCoupon = () => {
    onClose();
    onUseCoupon();
  };

  const footer =
    outcome === 'COUPON' ? (
      <div className="flex flex-col gap-2">
        <button type="button" onClick={useCoupon} className={`${ui.btnPrimary} w-full`}>
          Dùng ngay
        </button>
        <button type="button" onClick={onClose} className={`${ui.btnText} justify-center`}>
          Để sau
        </button>
      </div>
    ) : (
      <button type="button" onClick={onClose} className={`${ui.btnPrimary} w-full`}>
        {won ? 'Tuyệt vời!' : 'Quay tiếp nhé'}
      </button>
    );

  return (
    <Sheet open={open} onClose={onClose} title={won ? 'Chúc mừng!' : 'Tiếc quá!'} footer={footer}>
      {prize && (
        <div className="text-center">
          <div className="text-6xl leading-tight" aria-hidden="true">
            {won ? '🎉' : '🍀'}
          </div>
          <div className={`mt-1 text-base font-semibold ${won ? 'text-forest-700' : 'text-stone-900'}`}>{prize.name}</div>
          {outcome === 'POINTS' && <p className="mt-1 text-sm text-stone-700">+{formatNumber(prize.value)} Điểm Xanh đã vào tài khoản</p>}
          {outcome === 'SEEDS' && <p className="mt-1 text-sm text-stone-700">+{formatDrops(prize.value)} đã vào bình nước của bạn</p>}
          {outcome === 'MISS' && <p className="mt-1 text-sm text-stone-700">Lần này chưa trúng quà, thử lại lần sau nhé!</p>}
          {outcome === 'COUPON' && prize.coupon && (
            <div className="mt-3 rounded-control border border-dashed border-stone-450 bg-stone-50 p-3">
              <div className="break-all text-base font-bold tracking-wide text-stone-900">{prize.coupon.code}</div>
              <p className="mt-1 text-sm text-stone-700">Đơn tối thiểu {formatVnd(prize.coupon.minOrder)}</p>
              <p className="text-sm text-stone-700">Hạn dùng {formatDate(prize.coupon.expiresAt)}</p>
              <p className="mt-1.5 text-xs text-stone-600">Mã đã vào mục Mã giảm giá của tôi</p>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
