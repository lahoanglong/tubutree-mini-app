import { useRef, useState } from 'react';
import { Box, Text, Button } from 'zmp-ui';
import type { SpinResult } from '../services/game-api';
import { haptic } from '../utils/haptic';

/** 8 ô hiển thị (nhãn minh họa) — phần thưởng THẬT lấy từ backend spin(). */
const SLOTS = ['🌿', '🎁', '💧', '⭐', '🪴', '🏷️', '💚', '🍀'];
const SEG = 360 / SLOTS.length;
const SPIN_MS = 3600;

export function WheelOfFortune({
  cost,
  onSpin,
}: {
  cost: number;
  onSpin: () => Promise<SpinResult>;
}) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [prize, setPrize] = useState<SpinResult['prize'] | null>(null);
  const lockRef = useRef(false);

  const handleSpin = async () => {
    if (lockRef.current) return;
    lockRef.current = true;
    setSpinning(true);
    setPrize(null);
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
      setPrize(result.prize);
    } catch {
      /* lỗi đã hiển thị qua snackbar ở caller */
    } finally {
      setSpinning(false);
      lockRef.current = false;
    }
  };

  return (
    <Box flex flexDirection="column" alignItems="center" style={{ gap: 16 }}>
      <Box style={{ position: 'relative', width: 240, height: 240 }}>
        {/* Kim chỉ */}
        <Box
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
            borderTop: '20px solid var(--primary-700)',
            zIndex: 2,
            filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.2))',
          }}
        />
        {/* Bánh xe */}
        <div
          style={{
            width: 240,
            height: 240,
            borderRadius: '50%',
            border: '6px solid var(--primary-600)',
            boxShadow: 'var(--shadow-md)',
            transform: `rotate(${rotation}deg)`,
            transition: spinning
              ? `transform ${SPIN_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`
              : 'none',
            background: `conic-gradient(${SLOTS.map(
              (_, i) =>
                `${i % 2 === 0 ? 'var(--leaf-100)' : 'var(--primary-50)'} ${i * SEG}deg ${
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
        <Box
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'var(--primary-600)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--shadow-sm)',
            zIndex: 2,
          }}
        >
          <Text bold style={{ color: 'var(--neutral-0)', fontSize: 11 }}>
            QUAY
          </Text>
        </Box>
      </Box>

      <Button
        loading={spinning}
        onClick={() => void handleSpin()}
        style={{ background: 'var(--clay-500)', minWidth: 200 }}
      >
        {spinning ? 'Đang quay...' : `Quay ngay (${cost} Điểm Xanh)`}
      </Button>

      {/* Modal kết quả */}
      {prize && (
        <Box
          onClick={() => setPrize(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 24,
          }}
        >
          <Box
            onClick={(e) => e.stopPropagation()}
            p={5}
            style={{
              background: 'var(--neutral-0)',
              borderRadius: 'var(--radius-xl)',
              textAlign: 'center',
              maxWidth: 320,
              width: '100%',
            }}
          >
            <Text style={{ fontSize: 56 }}>🎉</Text>
            <Text bold size="large" style={{ marginTop: 8 }}>
              Chúc mừng!
            </Text>
            <Text style={{ color: 'var(--leaf-700)', fontWeight: 600, marginTop: 4 }}>
              {prize.name}
            </Text>
            {prize.rewardType === 'POINTS' && prize.value > 0 && (
              <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 4 }}>
                +{prize.value} Điểm Xanh đã vào tài khoản
              </Text>
            )}
            <Button
              fullWidth
              onClick={() => setPrize(null)}
              style={{ marginTop: 20, background: 'var(--primary-600)' }}
            >
              Tuyệt vời!
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}
