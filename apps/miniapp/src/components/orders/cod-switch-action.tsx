import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'zmp-ui';
import { switchOrderToCod } from '@tubutree/app-core/api/orders';
import {
  COD_SWITCH_CONFIRM,
  COD_SWITCH_CONFIRM_TITLE,
  COD_SWITCH_CTA,
  COD_SWITCH_DONE,
  COD_SWITCH_KEEP,
  codSwitchConfirmBody,
} from '@tubutree/app-core/bank-payment-copy';
import { coreHttp } from '../../services/core-http';
import { getErrorMessage, isStaleStateError } from '../../services/api';
import { formatVnd } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import { Button } from '../ui/button';
import { ConfirmSheet } from '../ui/confirm-sheet';

/**
 * Nút phụ "Đổi sang trả tiền khi nhận (COD)" cho đơn chuyển khoản chưa trả (máy chủ báo `codSwitchable`), qua tấm xác nhận. Đổi xong hay máy chủ
 * từ chối (đã trả, đã huỷ, vừa đổi ở máy khác) đều tải lại đơn để màn không còn mời đổi; lời từ chối là câu máy chủ viết cho khách.
 */
export function CodSwitchAction({ code, total, onSwitched }: { code: string; total: number; onSwitched?: () => void }) {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['order', code] }),
      qc.invalidateQueries({ queryKey: ['bank-qr', code] }),
      qc.invalidateQueries({ queryKey: ['orders'] }),
    ]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await switchOrderToCod(coreHttp, code);
      haptic('success');
      setOpen(false);
      openSnackbar({ text: COD_SWITCH_DONE, type: 'success', position: 'top' });
      // Rời trang mã QR trước khi tải lại: mã QR của đơn đã thành COD trả 400, trang sẽ nháy khung "không còn chờ chuyển khoản".
      onSwitched?.();
      await refresh();
    } catch (err) {
      openSnackbar({ text: getErrorMessage(err), type: 'error', position: 'top' });
      if (isStaleStateError(err)) {
        setOpen(false);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        fullWidth
        variant="secondary"
        onPress={() => {
          haptic('light');
          setOpen(true);
        }}
      >
        {COD_SWITCH_CTA}
      </Button>
      <ConfirmSheet
        open={open}
        title={COD_SWITCH_CONFIRM_TITLE}
        message={codSwitchConfirmBody(formatVnd(total))}
        confirmLabel={COD_SWITCH_CONFIRM}
        cancelLabel={COD_SWITCH_KEEP}
        loading={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
