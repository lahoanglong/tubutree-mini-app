'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { postDailyCheckIn, type CheckInStatusResponse } from '@tubutree/app-core/api/loyalty';
import { checkInSuccessText } from '@tubutree/app-core/daily-check-in-copy';
import { checkInView } from '@tubutree/app-core/loyalty-copy';
import { checkInQuery, loyaltyQuery, pointsTxnQuery } from '@tubutree/app-core/queries/loyalty';
import { coreHttp } from '@/lib/core-http';
import { loadErrorText } from './error-text';

const errText = loadErrorText;

/**
 * Điểm danh dùng chung cho Trang chủ, Ưu đãi và trang Điểm Xanh: cùng khoá ['loyalty-checkin'], cùng POST /me/daily-check-in
 * (một lần bấm cộng cả Điểm Xanh và giọt nước Vườn Xanh). Web không có snackbar nên kết quả trả ở `message` để thẻ tự
 * in một dòng `role="status"`.
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
      // Thiếu một phần cũng báo kiểu lỗi, giống Vườn Xanh: khách phải thấy là cần bấm lại.
      setMessage({ text: checkInSuccessText(res), error: res.pending.length > 0 });
      if (res.pending.length === 0) {
        qc.setQueryData<CheckInStatusResponse>(checkInQuery(coreHttp).queryKey, (old) => (old ? { ...old, checkedInToday: true } : old));
      }
      // Trả lời hứa tải lại: TanStack Query đợi nó trước `onSettled`, nên khoá `busy` còn giữ tới khi trạng thái điểm danh và số dư mới về
      // (nhả sớm hơn thì nút còn "Điểm danh" theo số cũ và bấm được lần hai, nhất là sau lần chỉ nhận một phần).
      return Promise.all([
        qc.invalidateQueries({ queryKey: loyaltyQuery(coreHttp).queryKey }),
        qc.invalidateQueries({ queryKey: ['game'] }),
        qc.invalidateQueries({ queryKey: checkInQuery(coreHttp).queryKey }),
        qc.invalidateQueries({ queryKey: pointsTxnQuery(coreHttp).queryKey }),
      ]);
    },
    onError: (e) => {
      setMessage({ text: errText(e), error: true });
      return qc.invalidateQueries({ queryKey: checkInQuery(coreHttp).queryKey });
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
