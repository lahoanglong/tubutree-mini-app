'use client';

import { useRef, useState } from 'react';
import type { SpinResult } from '@tubutree/app-core/api/game';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { WHEEL_SEG as SEG, WHEEL_SLOTS as SLOTS, pickWheelSlot, wheelRotationFor } from '@tubutree/app-core/game-wheel';
import { ui } from '@/lib/guest-ui';
import { miniBtnSecondary } from '@/components/loyalty/mini-surface';
import { formatNumber } from './format';

const SPIN_MS = 3600;

const WHEEL_BG = `conic-gradient(${SLOTS.map((_, i) => `${i % 2 === 0 ? 'var(--sage-100)' : 'var(--forest-50)'} ${i * SEG}deg ${(i + 1) * SEG}deg`).join(', ')})`;

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

    try {
      // Chờ giải thật của máy chủ rồi mới quay, để kim dừng đúng ô trúng. Lỗi thì bánh xe đứng yên.
      const result = await onSpin();
      const slot = pickWheelSlot(result.prize);
      setRotation((r) => wheelRotationFor(r, slot, 5, Math.random() - 0.5));
      await new Promise((r) => setTimeout(r, SPIN_MS));
      onResult(result.prize);
    } catch {
      /* lỗi đã hiển thị qua thông báo ở caller */
    } finally {
      setSpinning(false);
      lockRef.current = false;
    }
  };

  const short = points != null && points < cost && !!onEarnPoints;

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
              className="absolute left-1/2 top-1/2 flex w-[72px] flex-col items-center text-center leading-tight"
              style={{
                transform: `translate(-50%, -50%) rotate(${i * SEG + SEG / 2}deg) translate(0, -86px) rotate(-${i * SEG + SEG / 2}deg)`,
              }}
            >
              <span className="text-xl">{s.emoji}</span>
              <span className="text-xs font-medium text-stone-800">{s.label}</span>
            </span>
          ))}
        </div>
        {/* Trục giữa */}
        <button
          type="button"
          aria-label="Quay vòng quay"
          disabled={spinning || short}
          onClick={() => void handleSpin()}
          className="absolute left-1/2 top-1/2 z-[2] flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-forest-600 text-xs font-semibold text-stone-0 shadow-card disabled:opacity-70"
        >
          QUAY
        </button>
      </div>

      {short ? (
        <>
          <p className="text-center text-sm text-stone-700">{gameNewbieCopy.wheel.have(points, cost)}</p>
          <button type="button" onClick={onEarnPoints} className={`${miniBtnSecondary} min-h-12 min-w-[200px]`}>
            {gameNewbieCopy.wheel.howToEarn}
          </button>
        </>
      ) : (
        <button type="button" disabled={spinning} onClick={() => void handleSpin()} className={`${ui.btnPrimary} min-h-12 min-w-[200px]`}>
          {spinning ? 'Đang quay...' : `Quay ngay (${formatNumber(cost)} Điểm Xanh)`}
        </button>
      )}
    </div>
  );
}
