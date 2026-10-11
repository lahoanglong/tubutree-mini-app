import { useRef, useState } from 'react';
import { ShowerHead, TreePine } from 'lucide-react';
import { formatPoints } from '../../utils/format';
import { newIdempotencyKey } from '../../utils/idempotency';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Text } from '../ui/text';

export function TreeActions({
  treePointsPrice,
  waterPending,
  onWater,
  buyPending,
  onBuy,
}: {
  treePointsPrice: number | undefined;
  waterPending: boolean;
  onWater: () => void;
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
      <Button size="lg" fullWidth icon={ShowerHead} disabled={waterPending} loading={waterPending} onPress={() => onWater()}>
        Tưới cây (20💧)
      </Button>
      <Button fullWidth variant="secondary" icon={TreePine} disabled={busy} loading={busy} onPress={openConfirm}>
        Góp quỹ trồng cây
        {treePointsPrice != null && ` (${formatPoints(treePointsPrice)})`}
      </Button>
      <Text variant="caption" tone="tertiary" as="div" style={{ textAlign: 'center' }}>
        Góp bằng Điểm Xanh — dùng điểm thường trước, thiếu mới dùng điểm không hết hạn.
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
          Điểm thường trừ trước, rồi điểm quy đổi không hết hạn. Không hoàn lại sau khi góp.
        </Text>
      </BottomSheet>
    </div>
  );
}
