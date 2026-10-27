'use client';

import { useRef, useState } from 'react';
import { TreePine } from 'lucide-react';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { Sheet } from '@/components/ui/sheet';
import { newIdempotencyKey } from '@/lib/idempotency-key';
import { ui } from '@/lib/guest-ui';
import { miniBtnSecondary } from '@/components/loyalty/mini-surface';
import { formatPoints } from './format';

/**
 * Góp quỹ trồng cây bằng Điểm Xanh (tab Vườn, cạnh Tác động xanh). Thiếu điểm thì không mở hộp xác nhận mà hiện số dư
 * kèm lối "Cách kiếm Điểm Xanh".
 */
export function TreeFund({
  treePointsPrice,
  points,
  onEarnPoints,
  buyPending,
  onBuy,
}: {
  treePointsPrice: number | undefined;
  /** Điểm Xanh dùng được; null khi chưa tải được (lúc đó vẫn cho góp, API là lưới an toàn). */
  points: number | null;
  onEarnPoints: () => void;
  buyPending: boolean;
  /** Gửi lượt góp kèm key của hộp xác nhận đang mở; trả `true` khi thành công, `false` khi lỗi (caller đã báo lỗi). */
  onBuy: (idempotencyKey: string) => Promise<boolean>;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Một hộp xác nhận = một lượt góp = một key. Key giữ nguyên cho tới khi hộp đóng: lỗi mạng thì hộp ở lại và
  // "Xác nhận" gửi lại đúng key cũ, nên nếu server đã trừ điểm rồi thì chỉ nhận lại kết quả cũ chứ không trừ lần hai.
  const idempotencyKey = useRef<string | null>(null);
  // Khoá đồng bộ: `submitting`/`buyPending` chỉ có hiệu lực sau lần dựng lại kế tiếp, còn hai cú bấm sát nhau
  // đều đã kịp vào handler.
  const inFlight = useRef(false);
  const busy = buyPending || submitting;
  const short = points != null && treePointsPrice != null && points < treePointsPrice;

  const openConfirm = () => {
    idempotencyKey.current = newIdempotencyKey();
    setConfirmOpen(true);
  };

  const closeConfirm = () => {
    if (inFlight.current) return;
    idempotencyKey.current = null;
    setConfirmOpen(false);
  };

  const confirm = async () => {
    const key = idempotencyKey.current;
    if (inFlight.current || buyPending || key === null) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      if (await onBuy(key)) {
        idempotencyKey.current = null;
        setConfirmOpen(false);
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {short ? (
        <>
          <p className="text-center text-sm text-stone-700">{gameNewbieCopy.fund.have(points ?? 0, treePointsPrice ?? 0)}</p>
          <button type="button" onClick={onEarnPoints} className={`${miniBtnSecondary} w-full gap-2`}>
            <TreePine className="h-5 w-5" aria-hidden="true" />
            {gameNewbieCopy.fund.howToEarn}
          </button>
        </>
      ) : (
        <button type="button" disabled={busy} onClick={openConfirm} className={`${miniBtnSecondary} w-full gap-2`}>
          <TreePine className="h-5 w-5" aria-hidden="true" />
          <span>
            Góp quỹ trồng cây
            {treePointsPrice != null && ` (${formatPoints(treePointsPrice)})`}
          </span>
        </button>
      )}
      <p className="text-center text-caption text-stone-600">{gameNewbieCopy.fund.line}</p>
      <Sheet
        open={confirmOpen}
        onClose={closeConfirm}
        dismissible={!busy}
        title="Góp quỹ trồng cây?"
        footer={
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={closeConfirm} className={`${miniBtnSecondary} flex-1`}>
              Huỷ
            </button>
            <button type="button" disabled={busy} onClick={() => void confirm()} className={`${ui.btnPrimary} flex-1`}>
              Xác nhận
            </button>
          </div>
        }
      >
        <p className="text-sm text-stone-900">
          {treePointsPrice != null ? `Góp quỹ trồng cây sẽ trừ ${formatPoints(treePointsPrice)} từ Điểm Xanh của bạn.` : 'Góp quỹ trồng cây sẽ trừ Điểm Xanh của bạn.'}
        </p>
        <p className="mt-2 text-caption text-stone-600">{gameNewbieCopy.fund.confirmOrder}</p>
      </Sheet>
    </div>
  );
}
