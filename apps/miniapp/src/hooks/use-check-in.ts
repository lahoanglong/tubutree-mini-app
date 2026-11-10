import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'zmp-ui';
import { checkInSuccessText } from '@tubutree/app-core/daily-check-in-copy';
import { checkInView, getDailyCheckInStatus, postDailyCheckIn, type CheckInStatusResponse } from '../services/account-api';
import { getErrorMessage, isStaleStateError } from '../services/api';
import { haptic } from '../utils/haptic';
import { settleWithin } from '../utils/settle-within';

/**
 * Điểm danh dùng chung cho Trang chủ, Ưu đãi và trang Điểm Xanh: cùng khoá ['loyalty-checkin'], cùng POST /me/daily-check-in
 * (một lần bấm cộng cả Điểm Xanh và giọt nước Vườn Xanh).
 */
export function useCheckIn(enabled: boolean) {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const statusQ = useQuery({ queryKey: ['loyalty-checkin'], queryFn: getDailyCheckInStatus, enabled, staleTime: 60_000 });
  // Khoá đồng bộ chống chạm đúp: `isPending` chỉ có hiệu lực sau lần render kế; backend đã unique theo ngày.
  const busy = useRef(false);
  const mut = useMutation({
    mutationFn: postDailyCheckIn,
    onSuccess: (res) => {
      haptic('medium');
      openSnackbar({ text: checkInSuccessText(res), type: res.pending.length > 0 ? 'warning' : 'success' });
      if (res.pending.length === 0) {
        qc.setQueryData<CheckInStatusResponse>(['loyalty-checkin'], (old) => (old ? { ...old, checkedInToday: true } : old));
      }
      void qc.invalidateQueries({ queryKey: ['loyalty'] });
      void qc.invalidateQueries({ queryKey: ['game'] });
      void qc.invalidateQueries({ queryKey: ['loyalty-checkin'] });
      void qc.invalidateQueries({ queryKey: ['points-txn'] });
    },
    onError: (e) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      // Mọi lỗi đều tải lại để nút khớp trạng thái thật (quá hạn/5xx: máy chủ có thể đã ghi điểm danh trước khi trả lời).
      const reload = qc.invalidateQueries({ queryKey: ['loyalty-checkin'] });
      // Máy chủ từ chối vì trạng thái đã đổi (400/404/409, vd đã điểm danh hôm nay): giữ khoá tới khi dữ liệu về (tối đa `settleWithin`), kẻo nút còn sáng với trạng thái cũ và bấm lại nhận đúng lỗi đó. Lỗi khác nhả khoá ngay để không kẹt.
      return isStaleStateError(e) ? settleWithin(reload) : undefined;
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  const checkIn = () => {
    if (busy.current) return;
    busy.current = true;
    mut.mutate();
  };
  const view = statusQ.data ? checkInView(statusQ.data) : null;
  return { status: statusQ.data, statusQ, view, pending: mut.isPending, checkIn };
}
