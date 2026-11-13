'use client';

import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminEditSession } from '@tubutree/app-core/api/attendance';
import {
  finalizePayroll,
  markPaid,
  recomputePayroll,
  reopenPayroll,
  setRate,
  type AdminPayrollRow,
  type PayrollStatus,
} from '@tubutree/app-core/api/payroll';
import { payrollReopenMessage } from '@tubutree/app-core/payroll-copy';
import { adminPayrollDetailQuery, adminPayrollQuery } from '@tubutree/app-core/queries/payroll';
import { coreHttp } from '@/lib/core-http';
import { settleWithin } from '@/lib/settle-within';
import { reloadWhenStale } from '@/lib/stale-write-rejection';
import { usePressLock } from '@/lib/use-press-lock';
import { actionErrorText } from '@/lib/admin-error-text';
import { downloadCsvFile } from '@/lib/export-csv';
import { formatVnd } from '@/lib/format-vnd';
import { addDaysKey, currentVnYearMonth, dowLabel, isoToVnHHMM, shiftYearMonth, shortDayLabel, vnDateKey, vnDateTimeISO } from '@/lib/week';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { Sheet } from '@/components/ui/sheet';
import { EvidenceUpload } from '@/components/evidence-upload';
import { errText, PeriodNav } from '@/components/staff/staff-shell';
import { IMAGES_UPLOADING } from '@/lib/image-compress';
import { useUploadBusy } from '@/lib/use-upload-busy';
import { useConfirm } from './confirm-dialog';
import { safeEvidenceImage } from './evidence-images';
import { payrollCsv } from './payroll-csv';
import { BTN_LINK, BTN_PRIMARY, BTN_SECONDARY, BTN_XS_PRIMARY, BTN_XS_SECONDARY, Field, INPUT_CLASS, Notice, ListSkeleton } from './ui';

// Chỉ nạp khi bấm "Thưởng/phạt": giữ gói đầu của /admin nhẹ.
const PayrollAdjustSheet = dynamic(() => import('./payroll-adjust-sheet').then((m) => m.PayrollAdjustSheet));

/** Việc theo dòng và tháng: tháng đi cùng biến để `onSuccess` không phải đọc tháng đang xem. */
type PayrollJob = { r: AdminPayrollRow; year: number; month: number };

const PAY_STATUS: Record<PayrollStatus, string> = { OPEN: 'Đang tính', FINALIZED: 'Đã chốt', PAID: 'Đã trả' };
const fmtHM = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Lương theo tháng cho quản trị: dòng theo nhân viên, giờ công và sửa phiên, đơn giá, chốt, mở lại, đã trả, xuất CSV. */
export function PayrollAdminTab() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [ym, setYm] = useState(() => currentVnYearMonth());
  const payQ = useQuery(adminPayrollQuery(coreHttp, ym.year, ym.month));
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [qrRow, setQrRow] = useState<AdminPayrollRow | null>(null);
  const qrRaw = qrRow ? (qrRow.qrImageUrl ?? qrRow.profile?.qrImageUrl ?? '') : '';
  const qrImg = qrRaw ? safeEvidenceImage(qrRaw) : null;
  const [rateRow, setRateRow] = useState<AdminPayrollRow | null>(null);
  const [rateVal, setRateVal] = useState('');
  const [payRow, setPayRow] = useState<AdminPayrollRow | null>(null);
  const [proof, setProof] = useState('');
  // Cờ nằm ở trang vì tấm "Xác nhận đã chuyển" gỡ nội dung khi đóng, còn ảnh về muộn vẫn ghi vào `proof` của trang.
  const { busy: proofBusy, onBusyChange: onProofBusyChange } = useUploadBusy();
  const [note, setNote] = useState('');
  const [detailRow, setDetailRow] = useState<AdminPayrollRow | null>(null);
  const [adjustRow, setAdjustRow] = useState<AdminPayrollRow | null>(null);
  // Trả lời hứa làm mới để khoá giữ tới khi bảng lương mới về (tối đa `settleWithin`, kẻo mạng chậm giữ nút lâu hơn lệnh vừa xong): nhả sớm thì dòng vừa chốt còn hiện nút "Chốt" cũ và bấm lại được.
  // Lệnh bị từ chối vì bảng đã cũ (tháng đã chốt/đã trả, nhân viên không còn: 400/404/409) cũng tải lại rồi mới nhả. Lệnh có ô nhập (Đơn giá, Ghi đã trả, Sửa giờ phiên) thì 400 là lỗi nhập liệu:
  // hiện trong tờ, không tải lại, khoá nhả ngay; chỉ 404/409 tải lại. Quy tắc này chỉ quyết định việc CHỜ tải lại trước khi nhả khoá: trên production MutationCache vẫn làm cũ khoá admin-* ở lỗi khác.
  // Chốt/mở lại/tính lại làm mới theo tháng của chính lệnh (đi trong biến mutation), không theo tháng đang xem lúc xong: đổi tháng khi lệnh còn bay mà làm mới nhầm tháng thì quay lại thấy dữ liệu cũ.
  // `refetchType: 'all'` vì tháng cũ lúc đó không còn ai xem nên mặc định chỉ đánh dấu cũ chứ không tải lại.
  const refreshMonth = (p: { year: number; month: number }) => qc.invalidateQueries({ queryKey: ['admin-payroll', p.year, p.month], refetchType: 'all' });
  const refresh = () => refreshMonth(ym);
  const invalidate = () => void refresh();
  const ok = (text: string) => setMsg({ tone: 'success', text });
  const fail = (e: unknown) => setMsg({ tone: 'danger', text: errText(e) });
  // Lớp nền của hai tờ nhập (Đơn giá, Ghi đã trả) che lời báo của trang, nên lỗi của lệnh gửi từ tờ hiện ngay trong tờ.
  const [rateErr, setRateErr] = useState<string | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);

  // Chốt, mở lại và đánh dấu đã trả đều đổi trạng thái bảng lương nên chỉ một việc mỗi lúc (cũng là lý do các dòng khác bị khoá khi một dòng đang chạy).
  // Khoá ref vì `isPending` chỉ đúng sau lần vẽ kế tiếp: hai cú chạm sát nhau vẫn gửi cả hai.
  const acting = useRef(false);
  const releaseActing = () => {
    acting.current = false;
  };
  const exclusive = (run: () => void) => {
    if (acting.current) return false;
    acting.current = true;
    run();
    return true;
  };

  const rateM = useLockedMutation({
    mutationFn: () => setRate(coreHttp, rateRow!.staff.id, Number(rateVal)),
    onSuccess: () => {
      ok('Đã lưu đơn giá.');
      setRateRow(null);
      setRateErr(null);
      return settleWithin(refresh());
    },
    onError: (e) => {
      setRateErr(errText(e));
      return reloadWhenStale(e, refresh, true);
    },
  });
  const finalizeM = useLockedMutation({
    onSettled: releaseActing,
    mutationFn: (v: PayrollJob) => finalizePayroll(coreHttp, v.r.staff.id, v.year, v.month),
    onSuccess: (_d, v) => {
      ok('Đã chốt lương.');
      return settleWithin(refreshMonth(v));
    },
    onError: (e, v) => {
      fail(e);
      return reloadWhenStale(e, () => refreshMonth(v));
    },
  });
  const reopenM = useLockedMutation({
    onSettled: releaseActing,
    mutationFn: (v: PayrollJob) => reopenPayroll(coreHttp, v.r.staff.id, v.year, v.month),
    onSuccess: (_d, v) => {
      ok('Đã mở lại bảng lương — sửa xong nhớ chốt lại.');
      return settleWithin(refreshMonth(v));
    },
    onError: (e, v) => {
      fail(e);
      return reloadWhenStale(e, () => refreshMonth(v));
    },
  });
  const paidM = useLockedMutation({
    onSettled: releaseActing,
    mutationFn: () => markPaid(coreHttp, payRow!.staff.id, { year: ym.year, month: ym.month, proofImageUrl: proof, note: note || undefined }),
    onSuccess: () => {
      ok('Đã đánh dấu đã trả lương.');
      setPayRow(null);
      setPayErr(null);
      setProof('');
      setNote('');
      return settleWithin(refresh());
    },
    onError: (e) => {
      setPayErr(errText(e));
      return reloadWhenStale(e, refresh, true);
    },
  });
  const payrollBusy = finalizeM.isPending || reopenM.isPending || paidM.isPending;
  const retryPayroll = usePressLock(() => payQ.refetch());

  // Khoá ref (`isPending` chỉ đúng sau lần vẽ kế): hai cú chạm sát nhau không gửi hai lần tính lại; một việc mỗi lúc cho cả bảng.
  const recomputeM = useLockedMutation({
    mutationFn: (v: PayrollJob) => recomputePayroll(coreHttp, v.r.staff.id, v.year, v.month),
    onSuccess: (_d, v) => {
      ok(`Đã tính lại bảng lương T${v.month}/${v.year} của ${v.r.staff.fullName ?? v.r.staff.phone ?? 'NV'}.`);
      return settleWithin(refreshMonth(v));
    },
    onError: (e, v) => {
      setMsg({ tone: 'danger', text: actionErrorText(e) });
      return reloadWhenStale(e, () => refreshMonth(v));
    },
  });

  const askRecompute = async (r: AdminPayrollRow) => {
    if (recomputeM.isPending) return;
    const go = await confirm({
      title: 'Tính lại bảng lương tháng này?',
      message: `Tính lại giờ công và tiền phạt tự động của ${r.staff.fullName ?? r.staff.phone ?? 'NV'} trong T${ym.month}/${ym.year} theo dữ liệu chấm công hiện có. Đơn giá của những ngày đã tính được giữ nguyên.`,
      confirmLabel: 'Tính lại',
    });
    if (go) recomputeM.mutate({ r, year: ym.year, month: ym.month });
  };

  const askFinalize = async (r: AdminPayrollRow) => {
    if (acting.current) return;
    const go = await confirm({
      title: 'Chốt bảng lương?',
      message: `Chốt bảng lương T${ym.month}/${ym.year} của ${r.staff.fullName ?? r.staff.phone ?? 'NV'}: ${fmtHM(r.month.totalMinutes)}, thực nhận ${formatVnd(r.month.net)}. Sau khi chốt, muốn sửa phải mở lại.`,
      confirmLabel: 'Chốt lương',
    });
    if (go) exclusive(() => finalizeM.mutate({ r, year: ym.year, month: ym.month }));
  };

  const askReopen = async (r: AdminPayrollRow) => {
    if (acting.current) return;
    const go = await confirm({
      title: 'Mở lại bảng lương?',
      message: payrollReopenMessage(ym.month, ym.year, r.staff.fullName ?? 'NV', r.month.status),
      confirmLabel: 'Mở lại',
    });
    if (go) exclusive(() => reopenM.mutate({ r, year: ym.year, month: ym.month }));
  };

  const rows = payQ.data ?? [];

  return (
    <div className="space-y-3">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-stone-900">Lương</h2>
        <button
          type="button"
          disabled={rows.length === 0}
          onClick={() => downloadCsvFile(payrollCsv(rows), `bang-luong-${ym.year}-${pad2(ym.month)}.csv`)}
          className={BTN_SECONDARY}
        >
          Xuất CSV
        </button>
      </div>
      <PeriodNav
        label={`Tháng ${ym.month}/${ym.year}`}
        prevLabel="Tháng trước"
        nextLabel="Tháng sau"
        onPrev={() => setYm(shiftYearMonth(ym.year, ym.month, -1))}
        onNext={() => setYm(shiftYearMonth(ym.year, ym.month, 1))}
      />
      {msg && (
        <Notice tone={msg.tone} role={msg.tone === 'danger' ? 'alert' : 'status'}>
          {msg.text}
        </Notice>
      )}
      {payQ.isLoading && <ListSkeleton label="Đang tải bảng lương" rows={4} className="h-16" />}
      {payQ.isError && (
        <div role="alert" className="text-sm text-danger-fg">
          {errText(payQ.error)}{' '}
          <button type="button" onClick={retryPayroll.press} aria-busy={retryPayroll.busy || undefined} aria-disabled={retryPayroll.busy || undefined} className="font-medium underline">
            Thử lại
          </button>
        </div>
      )}
      {payQ.data && rows.length === 0 && <p className="text-sm text-stone-500">Chưa có nhân sự</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((row) => {
          const name = row.staff.fullName ?? row.staff.phone ?? 'NV';
          // Chỉ dòng đang chạy có trạng thái bận; dòng khác khoá để không chốt/mở lại hai nhân viên cùng lúc.
          const finalizing = finalizeM.isPending && finalizeM.variables?.r.staff.id === row.staff.id;
          const reopening = reopenM.isPending && reopenM.variables?.r.staff.id === row.staff.id;
          const recomputing = recomputeM.isPending && recomputeM.variables?.r.staff.id === row.staff.id;
          return (
            <section key={row.staff.id} aria-label={name} className="rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-semibold text-stone-900">{name}</h3>
                  <p className="text-xs tabular-nums text-stone-600">
                    {fmtHM(row.month.totalMinutes)} · {formatVnd(row.profile?.hourlyRate ?? 0)}/h · {PAY_STATUS[row.month.status]}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold tabular-nums text-forest-700">{formatVnd(row.month.net)}</div>
                  {row.month.totalFines > 0 && <div className="text-xs tabular-nums text-danger-fg">−{formatVnd(row.month.totalFines)}</div>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" aria-label={`Xem giờ · ${name}`} onClick={() => setDetailRow(row)} className={BTN_XS_SECONDARY}>
                  Xem giờ
                </button>
                {/* Lệnh lưu xong là tờ đã đóng nhưng khoá còn giữ tới khi bảng mới về: mở lại lúc này nạp đơn giá CŨ rồi Lưu ghi đè đơn giá vừa lưu (payroll-hub cũng chặn nút mở tấm khi lệnh lưu còn chờ). */}
                <button
                  type="button"
                  aria-label={`Đơn giá · ${name}`}
                  aria-busy={rateM.isPending || undefined}
                  aria-disabled={rateM.isPending || undefined}
                  onClick={() => {
                    if (rateM.isPending) return;
                    setRateErr(null);
                    setRateRow(row);
                    setRateVal(String(row.profile?.hourlyRate ?? 0));
                  }}
                  className={`${BTN_XS_SECONDARY} aria-disabled:opacity-50`}
                >
                  Đơn giá
                </button>
                {row.month.status === 'OPEN' && (
                  <>
                    <button type="button" aria-label={`Thưởng/phạt · ${name}`} onClick={() => setAdjustRow(row)} className={BTN_XS_SECONDARY}>
                      Thưởng/phạt
                    </button>
                    <button
                      type="button"
                      aria-label={`Tính lại tháng · ${name}`}
                      aria-busy={recomputing || undefined}
                      aria-disabled={recomputeM.isPending || undefined}
                      onClick={() => void askRecompute(row)}
                      className={BTN_XS_SECONDARY}
                    >
                      {recomputing ? 'Đang tính…' : 'Tính lại tháng'}
                    </button>
                  </>
                )}
                {(row.qrImageUrl || row.profile?.qrImageUrl) && (
                  <button type="button" aria-label={`QR chuyển · ${name}`} onClick={() => setQrRow(row)} className={BTN_XS_SECONDARY}>
                    QR chuyển
                  </button>
                )}
                {row.month.status === 'OPEN' && (
                  <button
                    type="button"
                    aria-label={`Chốt · ${name}`}
                    aria-busy={finalizing || undefined}
                    aria-disabled={payrollBusy || undefined}
                    onClick={() => void askFinalize(row)}
                    className={BTN_XS_SECONDARY}
                  >
                    {finalizing ? 'Đang chốt…' : 'Chốt'}
                  </button>
                )}
                {row.month.status !== 'PAID' && (
                  <button
                    type="button"
                    aria-label={`Ghi đã trả lương · ${name}`}
                    aria-busy={paidM.isPending || undefined}
                    aria-disabled={paidM.isPending || undefined}
                    onClick={() => {
                      if (paidM.isPending) return;
                      setPayErr(null);
                      setPayRow(row);
                      setProof('');
                      setNote('');
                    }}
                    className={`${row.month.status === 'OPEN' ? BTN_XS_SECONDARY : BTN_XS_PRIMARY} aria-disabled:opacity-50`}
                  >
                    Ghi đã trả lương
                  </button>
                )}
                {row.month.status !== 'OPEN' && (
                  <button
                    type="button"
                    aria-label={`Mở lại · ${name}`}
                    aria-busy={reopening || undefined}
                    aria-disabled={payrollBusy || undefined}
                    onClick={() => void askReopen(row)}
                    className={BTN_LINK}
                  >
                    {reopening ? 'Đang mở…' : 'Mở lại'}
                  </button>
                )}
              </div>
              {row.month.status === 'FINALIZED' && <p className="mt-1.5 text-xs text-stone-500">Mở lại bảng lương trước khi thưởng/phạt hoặc tính lại tháng.</p>}
              {row.month.status === 'PAID' && <p className="mt-1.5 text-xs text-stone-500">Tháng đã trả: ghi thưởng/phạt vào tháng sau.</p>}
            </section>
          );
        })}
      </div>

      <Sheet open={!!qrRow} onClose={() => setQrRow(null)} title={`Chuyển lương ${qrRow?.staff.fullName ?? ''}`}>
        <div className="flex flex-col items-center gap-2.5">
          <div className="text-xl font-bold tabular-nums text-forest-700">{formatVnd(qrRow?.month.net ?? 0)}</div>
          {qrImg && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrImg.src} alt="QR" referrerPolicy="no-referrer" className="w-full max-w-[260px]" />
          )}
          {qrRow?.profile?.bankAccountNo && (
            <p className="text-sm">
              {qrRow.profile.bankAccountName} · {qrRow.profile.bankAccountNo}
            </p>
          )}
          <p className="text-xs text-stone-600">Quét chuyển khoản rồi bấm &quot;Ghi đã trả lương&quot; để tải ảnh xác nhận.</p>
        </div>
      </Sheet>

      <Sheet
        open={!!rateRow}
        onClose={() => setRateRow(null)}
        dismissible={!rateM.isPending}
        title={`Đơn giá giờ · ${rateRow?.staff.fullName ?? ''}`}
        footer={
          <button
            type="button"
            disabled={!/^\d+$/.test(rateVal)}
            aria-busy={rateM.isPending || undefined}
            aria-disabled={rateM.isPending || undefined}
            onClick={() => rateM.mutate()}
            className={`${BTN_PRIMARY} w-full`}
          >
            Lưu đơn giá
          </button>
        }
      >
        <Field label="Đơn giá (VND/giờ)">
          <input type="number" inputMode="numeric" value={rateVal} onChange={(e) => setRateVal(e.target.value)} className={`${INPUT_CLASS} tabular-nums`} />
        </Field>
        {rateErr && (
          <p role="alert" className="mt-2 text-sm text-danger-fg">
            {rateErr}
          </p>
        )}
      </Sheet>

      <Sheet
        open={!!payRow}
        onClose={() => setPayRow(null)}
        // Đóng giữa lúc ảnh còn đang lên rồi mở nhân viên khác: ảnh của người trước về muộn sẽ nằm trong tấm của người sau.
        dismissible={!paidM.isPending && !proofBusy}
        title={`Xác nhận đã chuyển · ${payRow?.staff.fullName ?? ''}`}
        footer={
          <button
            type="button"
            disabled={!proof}
            aria-busy={payrollBusy || proofBusy || undefined}
            aria-disabled={payrollBusy || proofBusy || undefined}
            onClick={() => {
              if (proofBusy) return;
              exclusive(() => paidM.mutate());
            }}
            className={`${BTN_PRIMARY} w-full`}
          >
            {proofBusy ? IMAGES_UPLOADING : 'Đánh dấu đã trả'}
          </button>
        }
      >
        <div className="space-y-3">
          <div className="flex justify-between text-sm tabular-nums">
            <span className="text-stone-600">Số tiền</span>
            <strong>{formatVnd(payRow?.month.net ?? 0)}</strong>
          </div>
          <EvidenceUpload
            label="Ảnh xác nhận chuyển khoản"
            hint="bắt buộc"
            max={1}
            value={proof ? [proof] : []}
            onChange={(v) => setProof(v[0] ?? '')}
            onBusyChange={onProofBusyChange}
            disabled={paidM.isPending}
          />
          <Field label="Ghi chú (tuỳ chọn)">
            <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={INPUT_CLASS} />
          </Field>
          {payErr && (
            <p role="alert" className="text-sm text-danger-fg">
              {payErr}
            </p>
          )}
        </div>
      </Sheet>

      {adjustRow && (
        <PayrollAdjustSheet
          row={adjustRow}
          year={ym.year}
          month={ym.month}
          onClose={() => setAdjustRow(null)}
          onStale={refresh}
          onDone={(text) => {
            ok(text);
            invalidate();
            void qc.invalidateQueries({ queryKey: ['admin-payroll-detail'] });
          }}
        />
      )}

      <DetailSheet row={detailRow} year={ym.year} month={ym.month} onClose={() => setDetailRow(null)} onChanged={refresh} />
    </div>
  );
}

function DetailSheet({
  row,
  year,
  month,
  onClose,
  onChanged,
}: {
  row: AdminPayrollRow | null;
  year: number;
  month: number;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const qc = useQueryClient();
  const staffId = row?.staff.id ?? '';
  const detailQ = useQuery({ ...adminPayrollDetailQuery(coreHttp, staffId, year, month), enabled: !!row });
  const [editId, setEditId] = useState<string | null>(null);
  const [ci, setCi] = useState('08:00');
  const [co, setCo] = useState('17:00');
  const [err, setErr] = useState<string | null>(null);
  // Sửa giờ đổi cả giờ công của tháng lẫn dòng lương nên làm mới cả hai; khoá giữ tới khi cả hai về.
  const refreshAll = () => Promise.all([onChanged(), qc.invalidateQueries({ queryKey: ['admin-payroll-detail', staffId, year, month] })]);

  const editM = useLockedMutation({
    mutationFn: (dayKey: string) =>
      adminEditSession(coreHttp, editId as string, {
        // Ca qua đêm: giờ ra nhỏ hơn giờ vào thuộc NGÀY HÔM SAU, dựng cả hai mốc cùng ngày sẽ gửi checkout < checkin và BE từ chối.
        // `co < ci` chứ không phải `<=`: phiên chưa ra ca được khởi tạo co = ci, dấu `=` sẽ ghi thành ca đúng 24 tiếng
        // (BE chỉ chặn checkout <= checkin) rồi bảng lương trả tiền cho 24 giờ đó.
        checkinAt: vnDateTimeISO(dayKey, ci),
        checkoutAt: vnDateTimeISO(co < ci ? addDaysKey(dayKey, 1) : dayKey, co),
      }),
    onSuccess: () => {
      setErr(null);
      setEditId(null);
      return settleWithin(refreshAll());
    },
    onError: (e) => {
      setErr(errText(e));
      return reloadWhenStale(e, refreshAll, true);
    },
  });

  return (
    <Sheet open={!!row} onClose={onClose} dismissible={!editM.isPending} size="full" title={`Giờ công · ${row?.staff.fullName ?? ''} · T${month}/${year}`}>
      <div className="space-y-2.5">
        {err && <p role="alert" className="text-sm text-danger-fg">{err}</p>}
        {detailQ.isLoading && <ListSkeleton label="Đang tải giờ công" rows={3} className="h-12" />}
        {detailQ.isError && (
          <p role="alert" className="text-sm text-danger-fg">
            {errText(detailQ.error)}
          </p>
        )}
        {detailQ.data && (
          <>
            <p className="text-sm tabular-nums">
              Tổng: <strong>{fmtHM(detailQ.data.month.totalMinutes)}</strong> · Thực nhận <strong>{formatVnd(detailQ.data.month.net)}</strong>
            </p>
            {detailQ.data.days.map((d) => {
              const dayKey = d.workDate.slice(0, 10);
              const sess = detailQ.data.sessions.filter((s) => vnDateKey(new Date(s.checkinAt)) === dayKey);
              return (
                <div key={d.id} className="border-t border-stone-200 pt-1.5">
                  <div className="flex justify-between gap-2 text-sm tabular-nums">
                    <span className="font-bold">
                      {dowLabel(dayKey)} {shortDayLabel(dayKey)} · {fmtHM(d.workedMinutes)}
                    </span>
                    <span>{formatVnd(d.net)}</span>
                  </div>
                  {sess.map((s) => (
                    <div key={s.id} className="mt-0.5 flex items-center justify-between gap-2 pl-2">
                      <span className="text-xs tabular-nums text-stone-600">
                        {isoToVnHHMM(s.checkinAt)} → {s.checkoutAt ? isoToVnHHMM(s.checkoutAt) : 'đang mở'}
                        {s.isLate ? ' · trễ' : ''}
                      </span>
                      {/* Lưu xong là form đã đóng nhưng khoá còn giữ tới khi chi tiết mới về: mở lại lúc này nạp giờ CŨ của phiên rồi Lưu ghi đè giờ vừa sửa. */}
                      <button
                        type="button"
                        aria-label={`Sửa giờ phiên ${isoToVnHHMM(s.checkinAt)}`}
                        aria-busy={editM.isPending || undefined}
                        aria-disabled={editM.isPending || undefined}
                        onClick={() => {
                          if (editM.isPending) return;
                          setErr(null);
                          setEditId(s.id);
                          setCi(isoToVnHHMM(s.checkinAt));
                          setCo(s.checkoutAt ? isoToVnHHMM(s.checkoutAt) : isoToVnHHMM(s.checkinAt));
                        }}
                        className={`${BTN_LINK} aria-disabled:opacity-50`}
                      >
                        Sửa giờ
                      </button>
                    </div>
                  ))}
                  {sess.length === 0 && <p className="pl-2 text-xs text-stone-500">Không có phiên.</p>}
                  {editId && sess.some((s) => s.id === editId) && (
                    <div className="mt-1.5 space-y-1.5 pl-2">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Field label="Giờ vào">
                            <input type="time" value={ci} onChange={(e) => setCi(e.target.value)} className={INPUT_CLASS} />
                          </Field>
                        </div>
                        <div className="flex-1">
                          <Field label="Giờ ra">
                            <input type="time" value={co} onChange={(e) => setCo(e.target.value)} className={INPUT_CLASS} />
                          </Field>
                        </div>
                      </div>
                      {/* co === ci là phiên chưa ra ca (ô giờ ra khởi tạo bằng giờ vào): lưu lúc đó ghi khoảng 0 phút hoặc cả 24 tiếng. */}
                      {co === ci && <p className="text-xs text-warning-fg">Nhập giờ ra khác giờ vào để lưu.</p>}
                      <button
                        type="button"
                        disabled={co === ci || !ci || !co}
                        aria-busy={editM.isPending || undefined}
                        aria-disabled={editM.isPending || undefined}
                        onClick={() => editM.mutate(dayKey)}
                        className={BTN_PRIMARY}
                      >
                        Lưu giờ
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {detailQ.data.days.length === 0 && <p className="text-sm text-stone-600">Chưa có công tháng này.</p>}
          </>
        )}
      </div>
    </Sheet>
  );
}
