import { useRef, useState } from 'react';
import { TreePine } from 'lucide-react';
import { vi } from '../../i18n/vi';
import { formatPoints } from '../../utils/format';
import { newIdempotencyKey } from '../../utils/idempotency';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Text } from '../ui/text';

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
  // Khoá đồng bộ: `submitting`/`buyPending` chỉ có hiệu lực sau lần dựng lại kế tiếp, còn hai cú chạm sát nhau
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {short ? (
        <>
          <Text variant="body-sm" tone="secondary" as="div" style={{ textAlign: 'center' }}>
            {vi.game.newbie.fund.have(points ?? 0, treePointsPrice ?? 0)}
          </Text>
          <Button fullWidth variant="secondary" icon={TreePine} onPress={onEarnPoints}>
            {vi.game.newbie.fund.howToEarn}
          </Button>
        </>
      ) : (
        <Button fullWidth variant="secondary" icon={TreePine} disabled={busy} loading={busy} onPress={openConfirm}>
          Góp quỹ trồng cây
          {treePointsPrice != null && ` (${formatPoints(treePointsPrice)})`}
        </Button>
      )}
      <Text variant="caption" tone="tertiary" as="div" style={{ textAlign: 'center' }}>
        {vi.game.newbie.fund.line}
      </Text>
      <BottomSheet
        open={confirmOpen}
        onClose={closeConfirm}
        dismissible={!busy}
        title="Góp quỹ trồng cây?"
        footer={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button fullWidth variant="secondary" disabled={busy} onPress={closeConfirm}>
              Huỷ
            </Button>
            <Button fullWidth disabled={busy} loading={busy} onPress={confirm}>
              Xác nhận
            </Button>
          </div>
        }
      >
        <Text variant="body-sm" as="div">
          {treePointsPrice != null ? `Góp quỹ trồng cây sẽ trừ ${formatPoints(treePointsPrice)} từ Điểm Xanh của bạn.` : 'Góp quỹ trồng cây sẽ trừ Điểm Xanh của bạn.'}
        </Text>
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 8 }}>
          {vi.game.newbie.fund.confirmOrder}
        </Text>
      </BottomSheet>
    </div>
  );
}
