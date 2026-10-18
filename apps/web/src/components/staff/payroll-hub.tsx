'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Landmark } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { updateBank, type PayrollDay, type PayrollStatus, type StaffProfile } from '@tubutree/app-core/api/payroll';
import type { SessionHistory } from '@tubutree/app-core/api/attendance';
import { myAttendanceHistoryQuery } from '@tubutree/app-core/queries/attendance';
import { myPayrollQuery } from '@tubutree/app-core/queries/payroll';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import {
  addDaysKey,
  currentVnYearMonth,
  dayOfMonth,
  dowLabel,
  isoToVnHHMM,
  mondayKeyOf,
  shiftYearMonth,
  shortDayLabel,
  vnDateKey,
  vnDateTimeISO,
} from '@/lib/week';
import { ui } from '@/lib/guest-ui';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { Field } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { EvidenceUpload } from '@/components/evidence-upload';
import { errText, PeriodNav, useNotice } from './staff-shell';

const STATUS_LABEL: Record<PayrollStatus, string> = {
  OPEN: 'Đang tính',
  FINALIZED: 'Đã chốt',
  PAID: 'Đã trả',
};

const fmtH = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;

/** Bảng lương theo tháng của nhân viên: thực nhận, chi tiết theo tuần/ngày/phiên chấm công, tài khoản nhận lương. */
export function PayrollHub() {
  const qc = useQueryClient();
  const { node: noticeNode, notify, clear } = useNotice();
  const [ym, setYm] = useState(() => currentVnYearMonth());
  const payQ = useQuery(myPayrollQuery(coreHttp, ym.year, ym.month));
  // Biên theo GIỜ VN, không phải UTC: BE lọc lịch sử theo `checkinAt` thật; lệch 7 tiếng thì phiên 06:00 sáng ngày 1
  // (= 23:00 UTC ngày cuối tháng trước) rơi ra ngoài, bảng lương vẫn tính tiền ngày đó mà bấm xổ lại báo không có phiên.
  const monFrom = vnDateTimeISO(`${ym.year}-${String(ym.month).padStart(2, '0')}-01`, '00:00');
  const nextM = shiftYearMonth(ym.year, ym.month, 1);
  const monTo = vnDateTimeISO(`${nextM.year}-${String(nextM.month).padStart(2, '0')}-01`, '00:00');
  const histQ = useQuery(myAttendanceHistoryQuery(coreHttp, ym.year, ym.month, monFrom, monTo));
  const [openDay, setOpenDay] = useState<string | null>(null);

  // Gom phiên theo ngày VN (checkinAt là mốc UTC → đổi sang ngày VN để khớp workDate).
  const sessionsByDay = useMemo(() => {
    const map: Record<string, SessionHistory[]> = {};
    for (const s of histQ.data ?? []) (map[vnDateKey(new Date(s.checkinAt))] ??= []).push(s);
    return map;
  }, [histQ.data]);

  const weeks = useMemo(() => {
    const byWeek: Record<string, PayrollDay[]> = {};
    for (const d of payQ.data?.days ?? []) (byWeek[mondayKeyOf(new Date(d.workDate))] ??= []).push(d);
    return Object.entries(byWeek)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([wk, days]) => ({
        wk,
        days,
        minutes: days.reduce((s, d) => s + d.workedMinutes, 0),
        net: days.reduce((s, d) => s + d.net, 0),
      }));
  }, [payQ.data]);

  // Hồ sơ ngân hàng không đổi theo tháng nên giữ lần tải THÀNH CÔNG gần nhất: đổi tháng làm payQ.data tạm về undefined,
  // mở form đúng lúc đó sẽ nạp ô RỖNG và bấm Lưu gửi chuỗi rỗng đè mất tài khoản đã lưu (upsert `update: dto` ở BE).
  // `profileLoaded` tách "chưa tải được lần nào / tải lỗi" khỏi "nhân viên chưa có hồ sơ" (profile null hợp lệ): trường hợp đầu khoá nút,
  // không thì form rỗng + Lưu cũng đè mất tài khoản đã lưu.
  const [profileCache, setProfileCache] = useState<StaffProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  useEffect(() => {
    if (payQ.data) {
      setProfileCache(payQ.data.profile);
      setProfileLoaded(true);
    }
  }, [payQ.data]);

  const [bankOpen, setBankOpen] = useState(false);
  const [bin, setBin] = useState('');
  const [accNo, setAccNo] = useState('');
  const [accName, setAccName] = useState('');
  const [qr, setQr] = useState('');

  const openBank = () => {
    clear();
    setBin(profileCache?.bankBin ?? '');
    setAccNo(profileCache?.bankAccountNo ?? '');
    setAccName(profileCache?.bankAccountName ?? '');
    setQr(profileCache?.qrImageUrl ?? '');
    setBankOpen(true);
  };

  const bankM = useMutation({
    mutationFn: () => updateBank(coreHttp, { bankBin: bin.trim(), bankAccountNo: accNo.trim(), bankAccountName: accName.trim(), qrImageUrl: qr || undefined }),
    onSuccess: () => {
      notify({ text: 'Đã lưu thông tin nhận lương.', tone: 'success' });
      setBankOpen(false);
      void qc.invalidateQueries({ queryKey: ['my-payroll'] });
    },
    onError: (e) => notify({ text: errText(e), tone: 'error' }),
  });

  const m = payQ.data?.month;

  return (
    <div className="flex flex-col gap-3 pb-6">
      <div aria-live="polite">{noticeNode}</div>
      <PeriodNav
        label={`Tháng ${ym.month}/${ym.year}`}
        prevLabel="Tháng trước"
        nextLabel="Tháng sau"
        onPrev={() => setYm(shiftYearMonth(ym.year, ym.month, -1))}
        onNext={() => setYm(shiftYearMonth(ym.year, ym.month, 1))}
      />

      {payQ.isLoading && <Skeleton height={120} rounded="rounded-card" />}
      {payQ.isError && <ErrorState message={errText(payQ.error)} onRetry={() => void payQ.refetch()} />}

      <div className="grid gap-3 lg:grid-cols-[22rem_1fr] lg:items-start">
        <div className="flex flex-col gap-3">
          {m && (
            <section aria-label="Tổng kết tháng" className="rounded-card bg-forest-800 p-4 text-stone-0">
              <div className="text-sm">
                Thực nhận tháng {m.month}/{m.year}
              </div>
              <div className="mt-0.5 font-display text-3xl font-semibold tabular-nums">{formatVnd(m.net)}</div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span>Giờ công: {fmtH(m.totalMinutes)}</span>
                <span>Đơn giá: {formatVnd(payQ.data?.profile?.hourlyRate ?? 0)}/h</span>
                <span>Lương gộp: {formatVnd(m.gross)}</span>
                <span>Phạt: {formatVnd(m.totalFines)}</span>
              </div>
              <div className="mt-2">
                <Badge tone="neutral">{STATUS_LABEL[m.status]}</Badge>
              </div>
              {m.status === 'PAID' && m.proofImageUrl && (
                <div className="mt-3">
                  <div className="mb-1 text-xs">Ảnh xác nhận đã chuyển:</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.proofImageUrl} alt="Xác nhận chuyển khoản" className="max-w-full rounded-control" />
                </div>
              )}
            </section>
          )}

          <button type="button" onClick={openBank} disabled={!profileLoaded} className={ui.btnSecondary}>
            <Landmark className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Thông tin nhận lương
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {weeks.map((w, i) => (
            <section key={w.wk} className={`p-3 ${ui.card}`}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-stone-900">
                  Tuần {i + 1} ({shortDayLabel(w.wk)}–{shortDayLabel(addDaysKey(w.wk, 6))})
                </h2>
                <span className="text-sm font-bold text-forest-700">
                  {fmtH(w.minutes)} · {formatVnd(w.net)}
                </span>
              </div>
              {w.days.map((d) => {
                const key = d.workDate.slice(0, 10);
                const sess = sessionsByDay[key] ?? [];
                const isOpen = openDay === key;
                return (
                  <div key={d.id} className="border-t border-stone-200">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpenDay(isOpen ? null : key)}
                      className="flex min-h-11 w-full items-center justify-between gap-2 py-1.5 text-left"
                    >
                      <span className="flex items-center gap-1 text-sm text-stone-900">
                        <ChevronDown className={`h-4 w-4 text-stone-600 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                        {dowLabel(key)} {dayOfMonth(key)} · {fmtH(d.workedMinutes)}
                      </span>
                      <span className="text-right">
                        <span className="block text-sm font-bold tabular-nums text-stone-900">{formatVnd(d.net)}</span>
                        {d.fines > 0 && <span className="block text-xs text-danger-fg">−{formatVnd(d.fines)} phạt</span>}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="pb-1.5 pl-6">
                        {sess.length === 0 && <p className="text-xs text-stone-600">Không có phiên chấm công.</p>}
                        {sess.map((s) => (
                          <p key={s.id} className="text-xs text-stone-700">
                            {isoToVnHHMM(s.checkinAt)} → {s.checkoutAt ? isoToVnHHMM(s.checkoutAt) : 'đang mở'}
                            {s.isLate ? ' · trễ' : ''}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
          {payQ.data && payQ.data.days.length === 0 && (
            <p className={`p-6 text-center text-sm text-stone-600 ${ui.card}`}>Chưa có dữ liệu công tháng này.</p>
          )}
        </div>
      </div>

      <Sheet
        open={bankOpen}
        onClose={() => setBankOpen(false)}
        title="Thông tin nhận lương"
        footer={
          <button type="button" disabled={bankM.isPending} onClick={() => bankM.mutate()} className={`${ui.btnPrimary} w-full`}>
            {bankM.isPending ? 'Đang lưu...' : 'Lưu'}
          </button>
        }
      >
        <div className="flex flex-col gap-2.5">
          <Field label="Mã ngân hàng (BIN Napas, VD 970407)">
            <input className={ui.field} inputMode="numeric" value={bin} onChange={(e) => setBin(e.target.value)} />
          </Field>
          <Field label="Số tài khoản">
            <input className={ui.field} inputMode="numeric" value={accNo} onChange={(e) => setAccNo(e.target.value)} />
          </Field>
          <Field label="Tên chủ tài khoản">
            <input className={ui.field} value={accName} onChange={(e) => setAccName(e.target.value)} />
          </Field>
          <p className="text-xs text-stone-600">Hoặc tải ảnh QR nhận tiền (ưu tiên nếu có):</p>
          <EvidenceUpload label="QR nhận lương" max={1} value={qr ? [qr] : []} onChange={(v) => setQr(v[0] ?? '')} />
        </div>
      </Sheet>
    </div>
  );
}
