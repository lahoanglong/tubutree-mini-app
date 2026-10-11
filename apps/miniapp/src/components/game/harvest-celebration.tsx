import { Box, Text, Button, useSnackbar } from 'zmp-ui';
import type { HarvestSpecies } from '../../services/game-api';
import { copyText } from '../../utils/clipboard';
import { rarityColor, rarityLabel } from './game-utils';

// Harvest celebration
export function HarvestCelebration({
  coupon,
  certificate,
  species,
  onClose,
  onUseCoupon,
}: {
  coupon: string | null;
  certificate: string | null;
  species: HarvestSpecies | null;
  onClose: () => void;
  onUseCoupon: () => void;
}) {
  const { openSnackbar } = useSnackbar();
  return (
    <Box
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}
    >
      <Box
        onClick={(e) => e.stopPropagation()}
        p={5}
        style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-xl)', textAlign: 'center', maxWidth: 320, width: '100%' }}
      >
        <Text style={{ fontSize: 64 }}>🌳</Text>
        <Text bold size="large" style={{ marginTop: 8 }}>
          Thu hoạch thành công!
        </Text>
        <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 6 }}>
          Cây ảo của bạn đã lớn — Tubu sẽ góp <b>1 cây thật</b> vào rừng "Rừng Xanh Lên" cùng PanNature 🌿
        </Text>
        {coupon && (
          <Box
            className="tubu-press"
            mt={3}
            p={3}
            onClick={() => {
              void copyText(coupon).then((ok) =>
                openSnackbar(
                  ok
                    ? { text: 'Đã sao chép mã giảm giá', type: 'success' }
                    : { text: `Không sao chép được — mã của bạn: ${coupon}`, type: 'info', duration: 4000 },
                ),
              );
            }}
            style={{ background: 'var(--leaf-50)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--leaf-600)' }}
          >
            <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
              Quà thu hoạch — mã giảm giá (chạm để sao chép)
            </Text>
            <Text bold style={{ color: 'var(--leaf-700)', letterSpacing: 1 }}>
              {coupon}
            </Text>
          </Box>
        )}
        {certificate && (
          <Box mt={2} p={3} style={{ background: 'var(--leaf-50)', borderRadius: 'var(--radius-md)' }}>
            <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
              Mã chứng nhận cây thật
            </Text>
            <Text bold style={{ color: 'var(--leaf-700)', letterSpacing: 1 }}>
              {certificate}
            </Text>
          </Box>
        )}
        {species && (
          <Box mt={3} p={3} style={{ background: 'var(--leaf-50)', borderRadius: 'var(--radius-md)', border: `1px solid ${rarityColor(species.rarity)}` }}>
            <Text size="xSmall" style={{ color: rarityColor(species.rarity), fontWeight: 700 }}>
              {rarityLabel(species.rarity)} · Sưu tập mới!
            </Text>
            <Text bold style={{ marginTop: 2 }}>
              {species.emoji} {species.name}
            </Text>
            {species.ecoFact && (
              <Text size="xSmall" style={{ color: 'var(--neutral-600)', marginTop: 4 }}>
                💡 {species.ecoFact}
              </Text>
            )}
          </Box>
        )}
        {coupon && (
          <Button
            fullWidth
            variant="secondary"
            onClick={onUseCoupon}
            style={{ marginTop: 12 }}
          >
            Dùng mã giảm giá ngay
          </Button>
        )}
        <Button
          fullWidth
          onClick={onClose}
          style={{ marginTop: coupon ? 8 : 20, background: 'var(--leaf-600)' }}
        >
          Tuyệt vời!
        </Button>
      </Box>
    </Box>
  );
}
