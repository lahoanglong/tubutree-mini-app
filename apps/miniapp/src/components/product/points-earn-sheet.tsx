import { useNavigate } from 'zmp-ui';
import { Leaf, ShoppingBag, Sparkles, Truck, type LucideIcon } from 'lucide-react';
import { POINTS_EARN_POPUP, type PointsEarnPopup } from '@tubutree/app-core/points-earn-popup';
import { BottomSheet } from '../ui/bottom-sheet';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';

function Row({ icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <Icon icon={icon} size="sm" tone="brand" />
      <Text variant="body-sm" as="div" style={{ minWidth: 0 }}>
        {children}
      </Text>
    </div>
  );
}

const linkStyle = { minHeight: 44, display: 'inline-flex', alignItems: 'center', background: 'none', border: 0, padding: 0, color: 'var(--color-text-brand)', fontWeight: 600, fontSize: 'inherit', fontFamily: 'inherit' } as const;

/** Popup "Cách tính Điểm Xanh" mở từ dòng "Nhận ~X Điểm Xanh" ở PDP. Chữ và số do `pointsEarnPopup` (app-core) dựng sẵn, giống web. */
export function PointsEarnSheet({ open, onClose, popup }: { open: boolean; onClose: () => void; popup: PointsEarnPopup }) {
  const navigate = useNavigate();
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  return (
    <BottomSheet open={open} onClose={onClose} title={popup.title}>
      <div data-testid="points-earn-popup" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Row icon={Sparkles}>{popup.tier}</Row>
        <Row icon={ShoppingBag}>{popup.tilde}</Row>
        <Row icon={Truck}>{popup.delivered}</Row>
        {popup.marketplace && <Row icon={Leaf}>{popup.marketplace}</Row>}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <button type="button" style={linkStyle} onClick={() => go('/loyalty')}>
            {POINTS_EARN_POPUP.ranksLink}
          </button>
          {popup.marketplace && (
            <button type="button" style={linkStyle} onClick={() => go('/points/scan')}>
              {POINTS_EARN_POPUP.marketplaceLink}
            </button>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
