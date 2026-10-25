import { useRef, useState } from 'react';
import { WHEEL_SEG as SEG, WHEEL_SLOTS as SLOTS, pickWheelSlot, wheelRotationFor } from '@tubutree/app-core/game-wheel';
import type { SpinResult } from '../services/game-api';
import { vi } from '../i18n/vi';
import { formatNumber } from '../utils/format';
import { haptic } from '../utils/haptic';
import { Button } from './ui/button';
import { Text } from './ui/text';

const SPIN_MS = 3600;

export function WheelOfFortune({
  cost,
  points = null,
  onEarnPoints,
  onSpin,
  onResult,
}: {
  cost: number;
  /** Điểm Xanh dùng được; thiếu thì thay nút quay bằng số dư và lối "Cách kiếm Điểm Xanh". null = chưa biết, vẫn cho quay. */
  points?: number | null;
  onEarnPoints?: () => void;
  onSpin: () => Promise<SpinResult>;
  /** `null` = vừa bắt đầu lượt quay mới; có `prize` = kết quả thật của backend. Hộp kết quả do cấp trang dựng (xem WheelPrizeSheet). */
  onResult: (prize: SpinResult['prize'] | null) => void;
}) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const lockRef = useRef(false);

  const handleSpin = async () => {
    if (lockRef.current) return;
    lockRef.current = true;
    setSpinning(true);
    onResult(null);
    haptic('medium');

    try {
      // Chờ giải thật của máy chủ rồi mới quay, để kim dừng đúng ô trúng. Lỗi thì bánh xe đứng yên.
      const result = await onSpin();
      const slot = pickWheelSlot(result.prize);
      setRotation((r) => wheelRotationFor(r, slot, 5, Math.random() - 0.5));
      await new Promise((r) => setTimeout(r, SPIN_MS));
      haptic('medium');
      onResult(result.prize);
    } catch {
      /* lỗi đã hiển thị qua snackbar ở caller */
    } finally {
      setSpinning(false);
      lockRef.current = false;
    }
  };

  const short = points != null && points < cost && !!onEarnPoints;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <div style={{ position: 'relative', width: 240, height: 240 }}>
        {/* Kim chỉ */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: -4,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '12px solid transparent',
            borderRight: '12px solid transparent',
            borderTop: '20px solid var(--color-action-primary-bg-pressed)',
            zIndex: 2,
          }}
        />
        {/* Bánh xe */}
        <div
          aria-hidden
          style={{
            width: 240,
            height: 240,
            borderRadius: '50%',
            border: '6px solid var(--color-action-primary-bg)',
            boxShadow: 'var(--elevation-2)',
            transform: `rotate(${rotation}deg)`,
            transition: spinning
              ? `transform ${SPIN_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`
              : 'none',
            background: `conic-gradient(${SLOTS.map(
              (_, i) =>
                `${i % 2 === 0 ? 'var(--sage-100)' : 'var(--forest-50)'} ${i * SEG}deg ${
                  (i + 1) * SEG
                }deg`,
            ).join(', ')})`,
            position: 'relative',
          }}
        >
          {SLOTS.map((s, i) => (
            <span
              key={i}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: 72,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                lineHeight: 1.15,
                transform: `translate(-50%, -50%) rotate(${i * SEG + SEG / 2}deg) translate(0, -86px) rotate(-${i * SEG + SEG / 2}deg)`,
              }}
            >
              <span style={{ fontSize: 20 }}>{s.emoji}</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>{s.label}</span>
            </span>
          ))}
        </div>
        {/* Trục giữa: nút thật, cùng việc với nút "Quay ngay" bên dưới */}
        <button
          type="button"
          aria-label="Quay vòng quay"
          disabled={spinning || short}
          onClick={() => void handleSpin()}
          className="tubu-press"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 48,
            height: 48,
            padding: 0,
            border: 'none',
            borderRadius: '50%',
            background: 'var(--color-action-primary-bg)',
            color: 'var(--color-action-primary-fg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--elevation-1)',
            opacity: spinning || short ? 0.7 : 1,
            zIndex: 2,
          }}
        >
          <Text variant="label" tone="inverse">
            QUAY
          </Text>
        </button>
      </div>

      {short ? (
        <>
          <Text variant="body-sm" tone="secondary" as="div" style={{ textAlign: 'center' }}>
            {vi.game.newbie.wheel.have(points, cost)}
          </Text>
          <Button size="lg" variant="secondary" onPress={onEarnPoints} style={{ minWidth: 200 }}>
            {vi.game.newbie.wheel.howToEarn}
          </Button>
        </>
      ) : (
      <Button
        size="lg"
        loading={spinning}
        disabled={spinning}
        onPress={() => void handleSpin()}
        style={{ minWidth: 200 }}
      >
        {spinning ? 'Đang quay...' : `Quay ngay (${formatNumber(cost)} Điểm Xanh)`}
      </Button>
      )}
    </div>
  );
}
