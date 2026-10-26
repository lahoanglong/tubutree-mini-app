import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'zmp-ui';
import { checkInView, getDailyCheckInStatus, postDailyCheckIn, type CheckInStatusResponse } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { haptic } from '../utils/haptic';

/**
 * Điểm danh Điểm Xanh dùng chung cho Trang chủ và Ưu đãi: cùng khoá ['loyalty-checkin'], cùng POST /me/loyalty/check-in.
 * Không đổi mức thưởng và không gộp với điểm danh giọt nước của Vườn Xanh.
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
      openSnackbar({ text: res.message, type: 'success' });
      qc.setQueryData<CheckInStatusResponse>(['loyalty-checkin'], (old) => (old ? { ...old, checkedInToday: true } : old));
      void qc.invalidateQueries({ queryKey: ['loyalty'] });
      void qc.invalidateQueries({ queryKey: ['loyalty-checkin'] });
      void qc.invalidateQueries({ queryKey: ['points-txn'] });
    },
    onError: (e) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      void qc.invalidateQueries({ queryKey: ['loyalty-checkin'] });
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
