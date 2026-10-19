import { Lightbulb } from 'lucide-react';
import type { HarvestSpecies } from '@tubutree/app-core/api/game';
import { Sheet } from '@/components/ui/sheet';
import { ui } from '@/lib/guest-ui';
import { rarityBorder, rarityLabel, rarityText } from './game-utils';

// Harvest celebration. 🌳 lớn, 🌿 ở lời chúc và emoji loài là nội dung ăn mừng của game.
export function HarvestCelebration({
  open,
  coupon,
  certificate,
  species,
  onClose,
  onCopyCoupon,
  onUseCoupon,
}: {
  open: boolean;
  coupon: string | null;
  certificate: string | null;
  species: HarvestSpecies | null;
  onClose: () => void;
  onCopyCoupon: (code: string) => void;
  onUseCoupon: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Thu hoạch thành công!"
      footer={
        <div className="flex flex-col gap-2">
          {coupon && (
            <button type="button" onClick={onUseCoupon} className={`${ui.btnSecondary} w-full`}>
              Dùng mã giảm giá ngay
            </button>
          )}
          <button type="button" onClick={onClose} className={`${ui.btnPrimary} w-full`}>
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
          Cây ảo của bạn đã lớn — Tubu sẽ góp <b>1 cây</b> vào quỹ trồng cây 🌿
        </p>
        {coupon && (
          <button
            type="button"
            data-coupon
            onClick={() => onCopyCoupon(coupon)}
            className="mt-3 block w-full rounded-control border border-dashed border-stone-450 bg-stone-50 p-3 text-center"
          >
            <span className="block text-xs text-stone-700">Quà thu hoạch — mã giảm giá (chạm để sao chép)</span>
            <span className="block break-all text-base font-bold tracking-wide text-forest-700">{coupon}</span>
          </button>
        )}
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
      </div>
    </Sheet>
  );
}
