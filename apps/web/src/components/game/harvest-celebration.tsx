import { Lightbulb } from 'lucide-react';
import type { HarvestCouponCap, HarvestSpecies } from '@tubutree/app-core/api/game';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { Sheet } from '@/components/ui/sheet';
import { ui } from '@/lib/guest-ui';
import { miniBtnSecondary } from '@/components/loyalty/mini-surface';
import { rarityBorder, rarityLabel, rarityText } from './game-utils';

// Harvest celebration. 🌳 lớn, 🌿 ở lời chúc và emoji loài là nội dung ăn mừng của game.
export function HarvestCelebration({
  open,
  coupons,
  guest,
  onLogin,
  certificate,
  species,
  points,
  couponCapped,
  nextTarget,
  onClose,
  onCopyCoupon,
  onUseCoupon,
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
  couponCapped: HarvestCouponCap | null;
  /** 💧 cần cho cây kế tiếp. */
  nextTarget: number | null;
  onClose: () => void;
  onCopyCoupon: (code: string) => void;
  onUseCoupon: () => void;
  /** Đã đăng thành tích lần thu hoạch này lên Cộng đồng. */
  shared: boolean;
  sharing: boolean;
  onShare: () => void;
}) {
  const t = gameNewbieCopy.harvest;
  const seedling = points != null && points > 0;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Thu hoạch thành công!"
      footer={
        <div className="flex flex-col gap-2">
          {coupons.length > 0 && (
            <button type="button" onClick={onUseCoupon} className={`${miniBtnSecondary} w-full`}>
              Dùng mã giảm giá ngay
            </button>
          )}
          {guest && (
            <button type="button" onClick={onLogin} className={`${ui.btnPrimary} w-full`}>
              {t.guestCta}
            </button>
          )}
          {!guest && (
            <button type="button" disabled={shared || sharing} onClick={onShare} className={`${miniBtnSecondary} w-full`}>
              {shared ? t.shareCommunityDone : sharing ? t.shareCommunityBusy : t.shareCommunity}
            </button>
          )}
          <button type="button" onClick={onClose} className={`${guest ? miniBtnSecondary : ui.btnPrimary} w-full`}>
            Tuyệt vời!
          </button>
        </div>
      }
    >
      <div className="text-center">
        <div className="text-6xl leading-tight" aria-hidden="true">
          🌳
        </div>
        <p className="mt-1 text-sm text-stone-700">
          {seedling ? (
            t.seedling
          ) : (
            <>
              Cây ảo của bạn đã lớn — Tubu sẽ góp <b>1 cây</b> vào quỹ trồng cây 🌿
            </>
          )}
        </p>
        {seedling && (
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
