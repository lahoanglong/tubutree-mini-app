'use client';

import { useRef, useState } from 'react';
import type { SpinResult } from '@tubutree/app-core/api/game';
import { ui } from '@/lib/guest-ui';
import { formatNumber } from './format';

/** 8 ô hiển thị (nhãn minh họa) — phần thưởng THẬT lấy từ backend spin(). */
const SLOTS = ['🌿', '🎁', '💧', '⭐', '🪴', '🏷️', '💚', '🍀'];
const SEG = 360 / SLOTS.length;
const SPIN_MS = 3600;

const WHEEL_BG = `conic-gradient(${SLOTS.map((_, i) => `${i % 2 === 0 ? 'var(--sage-100)' : 'var(--forest-50)'} ${i * SEG}deg ${(i + 1) * SEG}deg`).join(', ')})`;

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

    // Quay tối thiểu 5 vòng + dừng ở 1 ô ngẫu nhiên (chỉ là hiệu ứng).
    const landSlot = Math.floor(Math.random() * SLOTS.length);
    setRotation(rotation + 360 * 5 + (360 - landSlot * SEG));

    try {
      const [result] = await Promise.all([onSpin(), new Promise((r) => setTimeout(r, SPIN_MS))]);
      onResult(result.prize);
    } catch {
      /* lỗi đã hiển thị qua thông báo ở caller */
    } finally {
      setSpinning(false);
      lockRef.current = false;
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative h-60 w-60">
        {/* Kim chỉ */}
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-[-4px] z-[2] h-0 w-0 -translate-x-1/2 border-x-[12px] border-t-[20px] border-x-transparent border-t-forest-700"
        />
        {/* Bánh xe */}
        <div
          aria-hidden="true"
          className="relative h-60 w-60 rounded-full border-[6px] border-forest-600 shadow-card motion-reduce:!transition-none"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.16, 1, 0.3, 1)` : 'none',
            background: WHEEL_BG,
          }}
        >
          {SLOTS.map((s, i) => (
            <span
              key={i}
              className="absolute left-1/2 top-1/2 text-[22px]"
              style={{
                transform: `rotate(${i * SEG + SEG / 2}deg) translate(0, -88px) rotate(-${i * SEG + SEG / 2}deg)`,
                transformOrigin: '0 0',
              }}
            >
              {s}
            </span>
          ))}
        </div>
        {/* Trục giữa */}
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 z-[2] flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-forest-600 shadow-card"
        >
          <span className="text-xs font-semibold text-stone-0">QUAY</span>
        </div>
      </div>

      <button type="button" disabled={spinning} onClick={() => void handleSpin()} className={`${ui.btnPrimary} min-h-12 min-w-[200px]`}>
        {spinning ? 'Đang quay...' : `Quay ngay (${formatNumber(cost)} Điểm Xanh)`}
      </button>
    </div>
  );
}
