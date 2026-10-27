import { Lightbulb } from 'lucide-react';
import type { HarvestCouponCap, HarvestSpecies } from '@tubutree/app-core/api/game';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import type { CouponNotice } from '@/lib/use-coupon-use';
import { Sheet } from '@/components/ui/sheet';
import { ui } from '@/lib/guest-ui';
import { miniBtnSecondary } from '@/components/loyalty/mini-surface';
import { rarityBorder, rarityLabel, rarityText } from './game-utils';

const CONFETTI = [
  ['6%', 'bg-forest-500', 0],
  ['16%', 'bg-honey-500', 120],
  ['27%', 'bg-promo-solid', 60],
  ['38%', 'bg-forest-300', 200],
  ['49%', 'bg-honey-600', 20],
  ['60%', 'bg-forest-600', 160],
  ['71%', 'bg-promo-solid', 90],
  ['82%', 'bg-honey-600', 40],
  ['92%', 'bg-forest-500', 140],
] as const;

/** Pháo giấy nhẹ rơi một lần khi mở hộp; tắt khi máy bật giảm chuyển động (CSS .tubu-confetti). */
function Confetti() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {CONFETTI.map(([left, color, delay]) => (
        <span key={left} className={`tubu-confetti ${color}`} style={{ left, animationDelay: `${delay}ms` }} />
      ))}
    </div>
  );
}

// Harvest celebration. 🌳 lớn, 🌿 ở lời chúc và emoji loài là nội dung ăn mừng của game.
export function HarvestCelebration({
  open,
  coupons,
  guest,
  onLogin,
  certificate,
  species,
  points,
  sprout,
  canShare,
  couponCapped,
  nextTarget,
  onClose,
  onCopyCoupon,
  onUseCoupon,
  couponNotice,
  shared,
  sharing,
  onShare,
}: {
  open: boolean;
  coupons: string[];
  /** Khách vãng lai: không có quà thu hoạch, mời đăng nhập. */
  guest: boolean;
  onLogin: () => void;
  certificate: string | null;
  species: HarvestSpecies | null;
  /** Điểm Xanh thưởng cây mầm (lần thu hoạch đầu); khi có thì không có mã và không nói chuyện góp quỹ cây. */
  points: number | null;
  /** Lần tưới có thu hoạch cây mầm (xem `HarvestReward.sprout`). */
  sprout: boolean;
  /** Chỉ cây ở lô nhà mới chia sẻ được. */
  canShare: boolean;
  couponCapped: HarvestCouponCap | null;
  /** 💧 cần cho cây kế tiếp. */
  nextTarget: number | null;
  onClose: () => void;
  onCopyCoupon: (code: string) => void;
  /** Nút chính khi có mã: tới giỏ (chọn sẵn mã) hoặc sản phẩm, với mã đầu tiên của lần thu hoạch. */
  onUseCoupon: (code: string) => void;
  /** Câu báo của lần "Dùng mã" (mã chưa áp được, lỗi mạng…), in ngay trong hộp trước khi sang giỏ. */
  couponNotice?: CouponNotice | null;
  /** Đã đăng thành tích lần thu hoạch này lên Cộng đồng. */
  shared: boolean;
  sharing: boolean;
  onShare: () => void;
}) {
  const t = gameNewbieCopy.harvest;
  const seedling = sprout || (points != null && points > 0);
  const showPoints = points != null && points > 0;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Thu hoạch thành công!"
      footer={
        <div className="flex flex-col gap-2">
          {couponNotice && (
            <p role={couponNotice.error ? 'alert' : 'status'} className={`text-center text-xs ${couponNotice.error ? 'text-danger-fg' : 'text-stone-700'}`}>
              {couponNotice.text}
            </p>
          )}
          {coupons.length > 0 && (
            <button type="button" onClick={() => onUseCoupon(coupons[0]!)} className={`${ui.btnPrimary} w-full`}>
              {t.useCoupon}
            </button>
          )}
          {guest && (
            <button type="button" onClick={onLogin} className={`${ui.btnPrimary} w-full`}>
              {t.guestCta}
            </button>
          )}
          {!guest && canShare && (
            <>
              <button type="button" disabled={shared || sharing} onClick={onShare} className={`${miniBtnSecondary} w-full`}>
                {shared ? t.shareCommunityDone : sharing ? t.shareCommunityBusy : t.shareCommunity}
              </button>
              <p className="text-center text-xs text-stone-700">{t.shareCommunityNote}</p>
            </>
          )}
          <button type="button" onClick={onClose} className={`${coupons.length > 0 || guest ? miniBtnSecondary : ui.btnPrimary} w-full`}>
            {coupons.length > 0 ? t.later : 'Tuyệt vời!'}
          </button>
        </div>
      }
    >
      <div className="relative text-center">
        {open && <Confetti />}
        <div className="text-6xl leading-tight" aria-hidden="true">
          <span key={String(open)} className="tubu-grow">
            🌳
          </span>
        </div>
        <p className="mt-1 text-sm text-stone-700">
          {certificate ? t.fund : seedling ? t.seedling : t.grown}
        </p>
        {showPoints && (
          <div className="mt-3 rounded-control border border-dashed border-stone-450 bg-stone-50 p-3">
            <div className="text-base font-bold text-forest-700">{t.points(points)}</div>
            <div className="text-xs text-stone-700">{t.pointsCaption}</div>
          </div>
        )}
        {guest && (
          <p role="note" className="mt-3 rounded-control bg-warning-bg p-3 text-xs text-warning-fg">
            {t.guest}
          </p>
        )}
        {couponCapped && (
          <p role="note" className="mt-3 rounded-control bg-warning-bg p-3 text-xs text-warning-fg">
            {t.capped[couponCapped]}
          </p>
        )}
        {coupons.map((coupon) => (
          <button
            key={coupon}
            type="button"
            data-coupon
            onClick={() => onCopyCoupon(coupon)}
            className="mt-3 block w-full rounded-control border border-dashed border-stone-450 bg-stone-50 p-3 text-center"
          >
            <span className="block text-xs text-stone-700">Quà thu hoạch — mã giảm giá (chạm để sao chép)</span>
            <span className="block break-all text-base font-bold tracking-wide text-forest-700">{coupon}</span>
          </button>
        ))}
        {certificate && (
          <div className="mt-2 rounded-control bg-stone-50 p-3">
            <div className="text-xs text-stone-700">Mã đóng góp quỹ trồng cây</div>
            <div className="break-all text-base font-bold tracking-wide text-forest-700">{certificate}</div>
          </div>
        )}
        {species && (
          <div className={`mt-3 rounded-control border bg-stone-50 p-3 ${rarityBorder(species.rarity)}`}>
            <div className={`text-xs font-bold ${rarityText(species.rarity)}`}>{rarityLabel(species.rarity)} · Sưu tập mới!</div>
            <div className="mt-0.5 text-base font-bold text-stone-900">
              {species.emoji} {species.name}
            </div>
            {species.ecoFact && (
              <div className="mt-1 flex justify-center gap-1.5 text-xs text-stone-700">
                <Lightbulb className="mt-0.5 h-4 w-4 flex-none text-stone-500" aria-hidden="true" />
                <span>{species.ecoFact}</span>
              </div>
            )}
          </div>
        )}
        {nextTarget != null && nextTarget > 0 && <p className="mt-3 text-sm text-stone-700">{t.nextTree(nextTarget)}</p>}
      </div>
    </Sheet>
  );
}
