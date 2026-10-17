import { useRef, useState } from 'react';
import type { SpinResult } from '../services/game-api';
import { formatNumber } from '../utils/format';
import { haptic } from '../utils/haptic';
import { Button } from './ui/button';
import { Text } from './ui/text';

/** 8 ô hiển thị (nhãn minh họa) — phần thưởng THẬT lấy từ backend spin(). */
const SLOTS = ['🌿', '🎁', '💧', '⭐', '🪴', '🏷️', '💚', '🍀'];
const SEG = 360 / SLOTS.length;
const SPIN_MS = 3600;

export function WheelOfFortune({
  cost,
  onSpin,
  onResult,
}: {
  cost: number;
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

    // Quay tối thiểu 5 vòng + dừng ở 1 ô ngẫu nhiên (chỉ là hiệu ứng).
    const landSlot = Math.floor(Math.random() * SLOTS.length);
    const target = rotation + 360 * 5 + (360 - landSlot * SEG);
    setRotation(target);

    try {
      const [result] = await Promise.all([
        onSpin(),
        new Promise((r) => setTimeout(r, SPIN_MS)),
      ]);
      haptic('medium');
      onResult(result.prize);
    } catch {
      /* lỗi đã hiển thị qua snackbar ở caller */
    } finally {
      setSpinning(false);
      lockRef.current = false;
    }
  };

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
                fontSize: 22,
                transform: `rotate(${i * SEG + SEG / 2}deg) translate(0, -88px) rotate(-${
                  i * SEG + SEG / 2
                }deg)`,
                transformOrigin: '0 0',
              }}
            >
              {s}
            </span>
          ))}
        </div>
        {/* Trục giữa */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'var(--color-action-primary-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--elevation-1)',
            zIndex: 2,
          }}
        >
          <Text variant="label" tone="inverse">
            QUAY
          </Text>
        </div>
      </div>

      <Button
        size="lg"
        loading={spinning}
        disabled={spinning}
        onPress={() => void handleSpin()}
        style={{ minWidth: 200 }}
      >
        {spinning ? 'Đang quay...' : `Quay ngay (${formatNumber(cost)} Điểm Xanh)`}
      </Button>
    </div>
  );
}
