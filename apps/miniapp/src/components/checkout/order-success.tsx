import { Box, Text, Button, useNavigate } from 'zmp-ui';
import type { OrderDTO } from '@tubutree/shared-types';
import { vi } from '../../i18n/vi';
import { useStorefrontContext } from '../../store/storefront-context';

const LEAVES = [
  { left: '12%', delay: '0ms', size: 16, rotate: 20 },
  { left: '28%', delay: '350ms', size: 12, rotate: -30 },
  { left: '46%', delay: '150ms', size: 18, rotate: 45 },
  { left: '62%', delay: '500ms', size: 13, rotate: -15 },
  { left: '78%', delay: '250ms', size: 15, rotate: 60 },
  { left: '90%', delay: '650ms', size: 11, rotate: -50 },
];

function Leaf({ size, rotate }: { size: number; rotate: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ transform: `rotate(${rotate}deg)` }} aria-hidden>
      <path d="M7 18c-1-7 4-13 12-13.5.5 8-3.5 13.5-10 14-1 .1-1.7-.2-2-.5z" fill="var(--leaf-400)" />
    </svg>
  );
}

/**
 * Màn hình "Cảm ơn bạn đã chọn Tubu" (DI #6) —
 * checkmark draw 600ms + lá rơi nhẹ, mã đơn nổi bật, 2 CTA rõ.
 */
export function OrderSuccess({
  order,
  onTrack,
  onContinue,
}: {
  order: OrderDTO;
  onTrack: () => void;
  onContinue: () => void;
}) {
  const navigate = useNavigate();
  const sfSlug = useStorefrontContext((s) => s.slug);
  const sfKind = useStorefrontContext((s) => s.kind);

  const handleContinue = () => {
    if (sfSlug) {
      navigate(sfKind === 'brand' ? `/brand/${sfSlug}` : `/s/${sfSlug}`, { replace: true });
    } else {
      onContinue();
    }
  };

  return (
    <Box
      style={{
        position: 'relative',
        minHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        overflow: 'hidden',
      }}
    >
      {/* Lá rơi nền — pointer-events none, tôn trọng reduced-motion qua CSS */}
      {LEAVES.map((l, i) => (
        <span key={i} className="tubu-leaf" style={{ left: l.left, animationDelay: l.delay }}>
          <Leaf size={l.size} rotate={l.rotate} />
        </span>
      ))}

      <svg width="88" height="88" viewBox="0 0 88 88" fill="none" aria-hidden className="tubu-pop">
        <circle cx="44" cy="44" r="40" fill="var(--leaf-50)" />
        <circle cx="44" cy="44" r="40" stroke="var(--leaf-400)" strokeWidth="2.5" opacity="0.5" />
        <path
          className="tubu-check-path"
          d="M28 45l11 11 21-23"
          stroke="var(--leaf-600)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>

      <Text.Title style={{ marginTop: 20, textAlign: 'center' }}>{vi.success.heading}</Text.Title>

      <Box
        style={{
          marginTop: 16,
          background: 'var(--neutral-0)',
          border: '1px dashed var(--primary-200)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 20px',
          textAlign: 'center',
        }}
      >
        <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
          {vi.success.orderCode}
        </Text>
        <Text bold style={{ fontSize: 18, letterSpacing: 1, color: 'var(--primary-700)' }}>
          {order.code}
        </Text>
      </Box>

      {order.pointsEarned > 0 && (
        <Text size="small" style={{ color: 'var(--leaf-700)', marginTop: 12, textAlign: 'center' }}>
          🌱 {vi.success.pointsComing(order.pointsEarned)}
        </Text>
      )}

      <Box style={{ marginTop: 28, width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Button fullWidth onClick={onTrack} style={{ background: 'var(--primary-600)', minHeight: 48, fontWeight: 600 }}>
          {vi.success.trackOrder}
        </Button>
        <Button fullWidth variant="tertiary" onClick={handleContinue} style={{ color: 'var(--primary-700)', minHeight: 44 }}>
          {vi.success.keepShopping}
        </Button>
      </Box>
    </Box>
  );
}
