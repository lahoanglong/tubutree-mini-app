import { Lightbulb } from 'lucide-react';
import { useSnackbar } from 'zmp-ui';
import type { HarvestCouponCap, HarvestSpecies } from '../../services/game-api';
import { vi } from '../../i18n/vi';
import { copyText } from '../../utils/clipboard';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { rowKeyboardProps } from '../ui/row-keyboard';
import { Text } from '../ui/text';
import { rarityColor, rarityLabel } from './game-utils';

const CONFETTI = [
  ['6%', 'var(--forest-500)', 0],
  ['16%', 'var(--honey-500)', 120],
  ['27%', 'var(--clay-500)', 60],
  ['38%', 'var(--forest-300)', 200],
  ['49%', 'var(--honey-600)', 20],
  ['60%', 'var(--forest-600)', 160],
  ['71%', 'var(--clay-500)', 90],
  ['82%', 'var(--honey-600)', 40],
  ['92%', 'var(--forest-500)', 140],
] as const;

/** Pháo giấy nhẹ rơi một lần khi mở hộp; tắt khi máy bật giảm chuyển động (CSS .tubu-confetti). */
function Confetti() {
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {CONFETTI.map(([left, color, delay]) => (
        <span key={left} className="tubu-confetti" style={{ left, background: color, animationDelay: `${delay}ms` }} />
      ))}
    </div>
  );
}

// Harvest celebration. 🌳 lớn, 🌿 ở lời chúc và emoji loài là nội dung ăn mừng của game.
// Luôn dựng sẵn và điều khiển bằng `open`: BottomSheet cần còn mounted để chạy hoạt ảnh đóng.
export function HarvestCelebration({
  open,
  coupons,
  guest,
  onLogin,
  certificate,
  species,
  points,
  sprout,
  couponCapped,
  nextTarget,
  onClose,
  onUseCoupon,
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
  couponCapped: HarvestCouponCap | null;
  /** 💧 cần cho cây kế tiếp. */
  nextTarget: number | null;
  onClose: () => void;
  /** Nút chính khi có mã: tới giỏ (chọn sẵn mã) hoặc mua sắm, với mã đầu tiên của lần thu hoạch. */
  onUseCoupon: (code: string) => void;
  /** Mở hộp chia sẻ Zalo gốc. Cộng đồng trong Mini App chỉ đọc nên không đăng bài ở đây. */
  onShare: () => void;
}) {
  const { openSnackbar } = useSnackbar();
  const t = vi.game.newbie.harvest;
  const seedling = sprout || (points != null && points > 0);
  const showPoints = points != null && points > 0;
  const hasCoupon = coupons.length > 0;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Thu hoạch thành công!"
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {hasCoupon && (
            <Button fullWidth onPress={() => onUseCoupon(coupons[0]!)}>
              {t.useCoupon}
            </Button>
          )}
          {guest && (
            <Button fullWidth onPress={onLogin}>
              {t.guestCta}
            </Button>
          )}
          {!guest && (
            <Button fullWidth variant={hasCoupon ? 'ghost' : 'secondary'} onPress={onShare}>
              {t.shareFriends}
            </Button>
          )}
          <Button fullWidth variant={hasCoupon || guest ? 'secondary' : 'primary'} onPress={onClose}>
            {hasCoupon ? t.later : 'Tuyệt vời!'}
          </Button>
        </div>
      }
    >
      <div style={{ textAlign: 'center', position: 'relative' }}>
        {open && <Confetti />}
        <div style={{ fontSize: 56, lineHeight: 1.2 }}>
          {/* Dựng lại mỗi lần mở để hoạt ảnh lớn lên chạy lại. */}
          <span key={String(open)} className="tubu-grow">
            🌳
          </span>
        </div>
        <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 4 }}>
          {certificate ? t.fund : seedling ? t.seedling : t.grown}
        </Text>
        {showPoints && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-control)', border: '1px dashed var(--color-border-selected)' }}>
            <Text variant="body-md" tone="brand" as="div" style={{ fontWeight: 700 }}>
              {t.points(points)}
            </Text>
            <Text variant="caption" tone="secondary" as="div">
              {t.pointsCaption}
            </Text>
          </div>
        )}
        {guest && (
          <div role="note" style={{ marginTop: 12, padding: 12, background: 'var(--color-status-warning-bg)', borderRadius: 'var(--radius-control)' }}>
            <Text variant="caption" tone="warning" as="div">
              {t.guest}
            </Text>
          </div>
        )}
        {couponCapped && (
          <div role="note" style={{ marginTop: 12, padding: 12, background: 'var(--color-status-warning-bg)', borderRadius: 'var(--radius-control)' }}>
            <Text variant="caption" tone="warning" as="div">
              {t.capped[couponCapped]}
            </Text>
          </div>
        )}
        {coupons.map((coupon) => (
          <div
            key={coupon}
            role="button"
            {...rowKeyboardProps()}
            className="tubu-press"
            onClick={() => {
              void copyText(coupon).then((ok) =>
                openSnackbar(
                  ok
                    ? { text: 'Đã sao chép mã giảm giá', type: 'success' }
                    : { text: `Không sao chép được — mã của bạn: ${coupon}`, type: 'info', duration: 4000 },
                ),
              );
            }}
            style={{
              marginTop: 12,
              padding: 12,
              background: 'var(--color-bg-subtle)',
              borderRadius: 'var(--radius-control)',
              border: '1px dashed var(--color-border-selected)',
              cursor: 'pointer',
            }}
          >
            <Text variant="caption" tone="secondary" as="div">
              Quà thu hoạch — mã giảm giá (chạm để sao chép)
            </Text>
            <Text variant="body-md" tone="brand" as="div" style={{ fontWeight: 700, letterSpacing: 1 }}>
              {coupon}
            </Text>
          </div>
        ))}
        {certificate && (
          <div style={{ marginTop: 8, padding: 12, background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-control)' }}>
            <Text variant="caption" tone="secondary" as="div">
              Mã đóng góp quỹ trồng cây
            </Text>
            <Text variant="body-md" tone="brand" as="div" style={{ fontWeight: 700, letterSpacing: 1 }}>
              {certificate}
            </Text>
          </div>
        )}
        {species && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              background: 'var(--color-bg-subtle)',
              borderRadius: 'var(--radius-control)',
              border: `1px solid ${rarityColor(species.rarity)}`,
            }}
          >
            <Text variant="caption" as="div" style={{ color: rarityColor(species.rarity), fontWeight: 700 }}>
              {rarityLabel(species.rarity)} · Sưu tập mới!
            </Text>
            <Text variant="body-md" as="div" style={{ fontWeight: 700, marginTop: 2 }}>
              {species.emoji} {species.name}
            </Text>
            {species.ecoFact && (
              <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 4, display: 'flex', gap: 6, justifyContent: 'center' }}>
                <Icon icon={Lightbulb} size="sm" tone="muted" style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{species.ecoFact}</span>
              </Text>
            )}
          </div>
        )}
        {nextTarget != null && nextTarget > 0 && (
          <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 12 }}>
            {t.nextTree(nextTarget)}
          </Text>
        )}
      </div>
    </BottomSheet>
  );
}
