'use client';

import { MapPin } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { attendanceStatusQuery } from '@tubutree/app-core/queries/attendance';
import { coreHttp } from '@/lib/core-http';
import { isoToVnHHMM } from '@/lib/week';
import { ui } from '@/lib/guest-ui';
import { Skeleton } from '@/components/ui/skeleton';
import { MiniAppOnlyNotice } from '@/components/mini-app-only-notice';
import { errText } from './staff-shell';

/**
 * Thẻ "Chấm công hôm nay": chỉ hiển thị trạng thái. Vào/ra ca và heartbeat cần token vị trí của Zalo (Mini App) nên web
 * không có cách chấm công nào khác, chỉ chỉ dẫn mở Mini App.
 */
export function TodayCard() {
  const statusQ = useQuery(attendanceStatusQuery(coreHttp));
  const open = statusQ.data?.openSession ?? null;
  const todayShifts = statusQ.data?.shifts ?? [];

  return (
    <section aria-label="Chấm công hôm nay" className={`p-4 ${ui.card}`}>
      <div className="flex items-center gap-2">
        <MapPin className="h-5 w-5 text-forest-600" aria-hidden="true" />
        <h2 className={ui.sectionTitle}>Chấm công hôm nay</h2>
      </div>

      {statusQ.isLoading && <Skeleton height={40} style={{ marginTop: 8 }} />}

      {statusQ.isError && !statusQ.data && (
        <div role="alert" className="mt-2">
          <p className={ui.error}>Không tải được trạng thái chấm công. {errText(statusQ.error)}</p>
          <button type="button" onClick={() => void statusQ.refetch()} className={ui.btnText}>
            Tải lại trạng thái
          </button>
        </div>
      )}

      {statusQ.data && (
        <div className="mt-2 text-sm text-stone-800">
          {open ? (
            <p>
              Đang trong ca · vào lúc {isoToVnHHMM(open.checkinAt)}
              {open.isLate ? ' · đi trễ' : ''}
            </p>
          ) : todayShifts.length === 0 ? (
            <p className="text-stone-700">Hôm nay bạn không có ca đã duyệt.</p>
          ) : (
            <ul className="space-y-1">
              {todayShifts.map((s) => (
                <li key={s.id}>
                  Ca {isoToVnHHMM(s.approvedStart ?? s.startAt)}–{isoToVnHHMM(s.approvedEnd ?? s.endAt)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {statusQ.data && (open || todayShifts.length > 0) && (
        <>
          <p className="mt-3 text-xs text-stone-600">Chấm công cần ở đúng mạng WiFi công ty, trong vùng làm việc và chỉ thực hiện được trên Mini App Zalo.</p>
          <MiniAppOnlyNotice miniappPath="/staff" compact />
        </>
      )}
    </section>
  );
}
