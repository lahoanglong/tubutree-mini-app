'use client';

import Link from 'next/link';
import { Leaf, ShoppingBag, Sparkles, Truck, type LucideIcon } from 'lucide-react';
import { POINTS_EARN_POPUP, type PointsEarnPopup } from '@tubutree/app-core/points-earn-popup';
import { Sheet } from '@/components/ui/sheet';
import { Icon } from '@/components/mini/icon';

const linkClass = 'inline-flex min-h-11 items-center text-sm leading-5 font-semibold text-[var(--color-text-brand)]';

function Row({ icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-sm leading-5">
      <span className="flex w-5 shrink-0 justify-center pt-px">
        <Icon icon={icon} size="sm" tone="brand" />
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Popup "Cách tính Điểm Xanh" mở từ dòng "Nhận ~X Điểm Xanh" ở PDP. Chữ và số do `pointsEarnPopup` (app-core) dựng sẵn, giống Mini App. Web chưa có trang gửi đơn sàn (Q2 chỉ ở Mini), nên chỉ có câu, không có liên kết. */
export function PointsEarnSheet({ open, onClose, popup }: { open: boolean; onClose: () => void; popup: PointsEarnPopup }) {
  return (
    <Sheet open={open} onClose={onClose} title={popup.title}>
      <div data-testid="points-earn-popup" className="flex flex-col gap-3">
        <Row icon={Sparkles}>{popup.tier}</Row>
        {popup.tilde && <Row icon={ShoppingBag}>{popup.tilde}</Row>}
        {popup.delivered && <Row icon={Truck}>{popup.delivered}</Row>}
        {popup.marketplace && <Row icon={Leaf}>{popup.marketplace}</Row>}
        <div className="flex flex-col items-start">
          <Link href="/tai-khoan/diem-xanh" className={linkClass} onClick={onClose}>
            {POINTS_EARN_POPUP.ranksLink}
          </Link>
        </div>
      </div>
    </Sheet>
  );
}
