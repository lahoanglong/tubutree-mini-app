import { Lightbulb } from 'lucide-react';
import { useSnackbar } from 'zmp-ui';
import type { HarvestSpecies } from '../../services/game-api';
import { copyText } from '../../utils/clipboard';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { rowKeyboardProps } from '../ui/row-keyboard';
import { Text } from '../ui/text';
import { rarityColor, rarityLabel } from './game-utils';

// Harvest celebration. 🌳 lớn, 🌿 ở lời chúc và emoji loài là nội dung ăn mừng của game.
// Luôn dựng sẵn và điều khiển bằng `open`: BottomSheet cần còn mounted để chạy hoạt ảnh đóng.
export function HarvestCelebration({
  open,
  coupon,
  certificate,
  species,
  onClose,
  onUseCoupon,
}: {
  open: boolean;
  coupon: string | null;
  certificate: string | null;
  species: HarvestSpecies | null;
  onClose: () => void;
  onUseCoupon: () => void;
}) {
  const { openSnackbar } = useSnackbar();
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Thu hoạch thành công!"
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {coupon && (
            <Button fullWidth variant="secondary" onPress={onUseCoupon}>
              Dùng mã giảm giá ngay
            </Button>
          )}
          <Button fullWidth onPress={onClose}>
            Tuyệt vời!
          </Button>
        </div>
      }
    >
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 56, lineHeight: 1.2 }}>🌳</div>
        <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 4 }}>
          Cây ảo của bạn đã lớn — Tubu sẽ góp <b>1 cây</b> vào quỹ trồng cây 🌿
        </Text>
        {coupon && (
          <div
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
        )}
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
      </div>
    </BottomSheet>
  );
}
