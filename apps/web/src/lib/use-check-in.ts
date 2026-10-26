'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { postDailyCheckIn, type CheckInStatusResponse } from '@tubutree/app-core/api/loyalty';
import { checkInView } from '@tubutree/app-core/loyalty-copy';
import { checkInQuery, loyaltyQuery, pointsTxnQuery } from '@tubutree/app-core/queries/loyalty';
import { coreHttp } from '@/lib/core-http';

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

/**
 * Điểm danh Điểm Xanh dùng chung cho Trang chủ và Ưu đãi: cùng khoá ['loyalty-checkin'], cùng POST /me/loyalty/check-in với trang
 * Điểm Xanh. Không đổi mức thưởng và không gộp với điểm danh giọt nước của Vườn Xanh. Web không có snackbar nên kết quả
 * trả ở `message` để thẻ tự in một dòng `role="status"`.
 */
export function useCheckIn(enabled: boolean) {
  const qc = useQueryClient();
  const statusQ = useQuery({ ...checkInQuery(coreHttp), enabled, staleTime: 60_000 });
  // Khoá đồng bộ chống chạm đúp: `isPending` chỉ có hiệu lực sau lần render kế; backend đã unique theo ngày.
  const busy = useRef(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const mut = useMutation({
    mutationFn: () => postDailyCheckIn(coreHttp),
    onSuccess: (res) => {
      setMessage({ text: res.message, error: false });
      qc.setQueryData<CheckInStatusResponse>(checkInQuery(coreHttp).queryKey, (old) => (old ? { ...old, checkedInToday: true } : old));
      void qc.invalidateQueries({ queryKey: loyaltyQuery(coreHttp).queryKey });
      void qc.invalidateQueries({ queryKey: checkInQuery(coreHttp).queryKey });
      void qc.invalidateQueries({ queryKey: pointsTxnQuery(coreHttp).queryKey });
    },
    onError: (e) => {
      setMessage({ text: errText(e), error: true });
      void qc.invalidateQueries({ queryKey: checkInQuery(coreHttp).queryKey });
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  const checkIn = () => {
    if (busy.current) return;
    busy.current = true;
    setMessage(null);
    mut.mutate();
  };
  const view = statusQ.data ? checkInView(statusQ.data) : null;
  return { status: statusQ.data, statusQ, view, pending: mut.isPending, checkIn, message };
}
