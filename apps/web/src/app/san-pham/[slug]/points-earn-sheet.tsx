'use client';

import Link from 'next/link';
import { Leaf, ShoppingBag, Sparkles, Truck, type LucideIcon } from 'lucide-react';
import { POINTS_EARN_POPUP, type PointsEarnPopup } from '@tubutree/app-core/points-earn-popup';
import { BottomSheet } from '@/components/mini/bottom-sheet';
import { Icon } from '@/components/mini/icon';
import { isWebRouteReady } from '@/lib/route-map';

const SCAN_ROUTE = '/points/scan';
const linkClass = 'inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-text-brand)]';

function Row({ icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon icon={icon} size="sm" tone="brand" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Popup "Cách tính Điểm Xanh" mở từ dòng "Nhận ~X Điểm Xanh" ở PDP. Chữ và số do `pointsEarnPopup` (app-core) dựng sẵn, giống Mini App. */
export function PointsEarnSheet({ open, onClose, popup }: { open: boolean; onClose: () => void; popup: PointsEarnPopup }) {
  return (
    <BottomSheet open={open} onClose={onClose} title={popup.title}>
      <div data-testid="points-earn-popup" className="flex flex-col gap-3">
        <Row icon={Sparkles}>{popup.tier}</Row>
        <Row icon={ShoppingBag}>{popup.tilde}</Row>
        <Row icon={Truck}>{popup.delivered}</Row>
        {popup.marketplace && <Row icon={Leaf}>{popup.marketplace}</Row>}
        <div className="flex flex-col items-start">
          <Link href="/tai-khoan/diem-xanh" className={linkClass} onClick={onClose}>
            {POINTS_EARN_POPUP.ranksLink}
          </Link>
          {popup.marketplace && isWebRouteReady(SCAN_ROUTE) && (
            <Link href={SCAN_ROUTE} className={linkClass} onClick={onClose}>
              {POINTS_EARN_POPUP.marketplaceLink}
            </Link>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
