import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import type { GameProfile } from '@tubutree/app-core/api/game';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { ui } from '@/lib/guest-ui';
import { miniBtnSecondary, miniCard, miniSectionTitle } from '@/components/loyalty/mini-surface';

const t = gameNewbieCopy.orderWater;

/** Nguồn nước "Từ đơn hàng" kèm tiến độ tuần (thứ Hai đến Chủ nhật, giờ VN). Ẩn khi admin tắt hoặc API cũ không trả. */
export function OrderWaterCard({ info, shopHref }: { info: GameProfile['orderWater']; shopHref: string }) {
  if (!info || info.perOrder <= 0 || info.weeklyCap <= 0) return null;
  const got = Math.min(info.weeklyGranted, info.weeklyCap);
  const pct = Math.round((got / info.weeklyCap) * 100);
  return (
    <section className={`p-4 ${miniCard}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className={`flex items-center gap-1.5 ${ui.sectionTitle} ${miniSectionTitle}`}>
            <ShoppingBag className="h-5 w-5 flex-none text-forest-600" aria-hidden="true" />
            {t.title}
          </h2>
          <p className="text-xs text-stone-600">{t.perOrder(info.perOrder)}</p>
        </div>
        <Link href={shopHref} className={`${miniBtnSecondary} flex-none`}>
          {t.cta}
        </Link>
      </div>
      <div
        role="progressbar"
        aria-label={t.progress(got, info.weeklyCap)}
        aria-valuemin={0}
        aria-valuemax={info.weeklyCap}
        aria-valuenow={got}
        className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100"
      >
        <div className="h-2 rounded-full bg-forest-600" style={{ width: `${pct}%` }} />
      </div>
      <p data-testid="order-water-progress" className="mt-1.5 text-xs text-stone-700">
        {got >= info.weeklyCap ? t.full : t.progress(got, info.weeklyCap)}
      </p>
    </section>
  );
}
