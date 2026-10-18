'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminEditSession } from '@tubutree/app-core/api/attendance';
import {
  finalizePayroll,
  markPaid,
  reopenPayroll,
  setRate,
  type AdminPayrollRow,
  type PayrollStatus,
} from '@tubutree/app-core/api/payroll';
import { adminPayrollDetailQuery, adminPayrollQuery } from '@tubutree/app-core/queries/payroll';
import { coreHttp } from '@/lib/core-http';
import { downloadCsvFile } from '@/lib/export-csv';
import { formatVnd } from '@/lib/format-vnd';
import { addDaysKey, currentVnYearMonth, dowLabel, isoToVnHHMM, shiftYearMonth, shortDayLabel, vnDateKey, vnDateTimeISO } from '@/lib/week';
import { Sheet } from '@/components/ui/sheet';
import { EvidenceUpload } from '@/components/evidence-upload';
import { errText, PeriodNav } from '@/components/staff/staff-shell';
import { useConfirm } from './confirm-dialog';
import { payrollCsv } from './payroll-csv';
import { BTN_LINK, BTN_PRIMARY, BTN_SECONDARY, BTN_XS_PRIMARY, BTN_XS_SECONDARY, Field, INPUT_CLASS, Notice } from './ui';

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
  const [rateRow, setRateRow] = useState<AdminPayrollRow | null>(null);
  const [rateVal, setRateVal] = useState('');
  const [payRow, setPayRow] = useState<AdminPayrollRow | null>(null);
  const [proof, setProof] = useState('');
  const [note, setNote] = useState('');
  const [detailRow, setDetailRow] = useState<AdminPayrollRow | null>(null);
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin-payroll', ym.year, ym.month] });
  const ok = (text: string) => setMsg({ tone: 'success', text });
  const fail = (e: unknown) => setMsg({ tone: 'danger', text: errText(e) });

  const rateM = useMutation({
    mutationFn: () => setRate(coreHttp, rateRow!.staff.id, Number(rateVal)),
    onSuccess: () => {
      ok('Đã lưu đơn giá.');
      setRateRow(null);
      invalidate();
    },
    onError: fail,
  });
  const finalizeM = useMutation({
    mutationFn: (r: AdminPayrollRow) => finalizePayroll(coreHttp, r.staff.id, ym.year, ym.month),
    onSuccess: () => {
      ok('Đã chốt lương.');
      invalidate();
    },
    onError: fail,
  });
  const reopenM = useMutation({
    mutationFn: (r: AdminPayrollRow) => reopenPayroll(coreHttp, r.staff.id, ym.year, ym.month),
    onSuccess: () => {
      ok('Đã mở lại bảng lương — sửa xong nhớ chốt lại.');
      invalidate();
    },
    onError: fail,
  });
  const paidM = useMutation({
    mutationFn: () => markPaid(coreHttp, payRow!.staff.id, { year: ym.year, month: ym.month, proofImageUrl: proof, note: note || undefined }),
    onSuccess: () => {
      ok('Đã đánh dấu đã trả lương.');
      setPayRow(null);
      setProof('');
      setNote('');
      invalidate();
    },
    onError: fail,
  });

  const askReopen = async (r: AdminPayrollRow) => {
    const go = await confirm({
      title: 'Mở lại bảng lương?',
      message: `Mở lại bảng lương T${ym.month}/${ym.year} của ${r.staff.fullName ?? 'NV'}? Cần chốt lại sau khi sửa.`,
      confirmLabel: 'Mở lại',
    });
    if (go) reopenM.mutate(r);
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
      {payQ.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {payQ.isError && (
        <div role="alert" className="text-sm text-danger-fg">
          {errText(payQ.error)}{' '}
          <button type="button" onClick={() => void payQ.refetch()} className="font-medium underline">
            Thử lại
          </button>
        </div>
      )}
      {payQ.data && rows.length === 0 && <p className="text-sm text-stone-500">Chưa có nhân sự</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((row) => {
          const name = row.staff.fullName ?? row.staff.phone ?? 'NV';
          // Chỉ dòng đang chạy có trạng thái bận; dòng khác khoá để không chốt/mở lại hai nhân viên cùng lúc.
          const finalizing = finalizeM.isPending && finalizeM.variables?.staff.id === row.staff.id;
          const reopening = reopenM.isPending && reopenM.variables?.staff.id === row.staff.id;
          return (
            <section key={row.staff.id} aria-label={name} className="rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-semibold text-stone-900">{name}</h3>
                  <p className="text-xs text-stone-600">
                    {fmtHM(row.month.totalMinutes)} · {formatVnd(row.profile?.hourlyRate ?? 0)}/h · {PAY_STATUS[row.month.status]}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-forest-700">{formatVnd(row.month.net)}</div>
                  {row.month.totalFines > 0 && <div className="text-xs text-danger-fg">−{formatVnd(row.month.totalFines)}</div>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" aria-label={`Xem giờ · ${name}`} onClick={() => setDetailRow(row)} className={BTN_XS_SECONDARY}>
                  Xem giờ
                </button>
                <button
                  type="button"
                  aria-label={`Đơn giá · ${name}`}
                  onClick={() => {
                    setRateRow(row);
                    setRateVal(String(row.profile?.hourlyRate ?? 0));
                  }}
                  className={BTN_XS_SECONDARY}
                >
                  Đơn giá
                </button>
                {(row.qrImageUrl || row.profile?.qrImageUrl) && (
                  <button type="button" aria-label={`QR chuyển · ${name}`} onClick={() => setQrRow(row)} className={BTN_XS_SECONDARY}>
                    QR chuyển
                  </button>
                )}
                {row.month.status === 'OPEN' && (
                  <button
                    type="button"
                    aria-label={`Chốt · ${name}`}
                    disabled={finalizeM.isPending}
                    onClick={() => finalizeM.mutate(row)}
                    className={BTN_XS_SECONDARY}
                  >
                    {finalizing ? 'Đang chốt…' : 'Chốt'}
                  </button>
                )}
                {row.month.status !== 'PAID' && (
                  <button
                    type="button"
                    aria-label={`Đã chuyển · ${name}`}
                    onClick={() => {
                      setPayRow(row);
                      setProof('');
                      setNote('');
                    }}
                    className={BTN_XS_PRIMARY}
                  >
                    Đã chuyển
                  </button>
                )}
                {row.month.status !== 'OPEN' && (
                  <button type="button" aria-label={`Mở lại · ${name}`} disabled={reopenM.isPending} onClick={() => void askReopen(row)} className={BTN_LINK}>
                    {reopening ? 'Đang mở…' : 'Mở lại'}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <Sheet open={!!qrRow} onClose={() => setQrRow(null)} title={`Chuyển lương ${qrRow?.staff.fullName ?? ''}`}>
        <div className="flex flex-col items-center gap-2.5">
          <div className="text-xl font-bold text-forest-700">{formatVnd(qrRow?.month.net ?? 0)}</div>
          {qrRow && (qrRow.qrImageUrl || qrRow.profile?.qrImageUrl) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={(qrRow.qrImageUrl ?? qrRow.profile?.qrImageUrl) as string} alt="QR" className="w-full max-w-[260px]" />
          )}
          {qrRow?.profile?.bankAccountNo && (
            <p className="text-sm">
              {qrRow.profile.bankAccountName} · {qrRow.profile.bankAccountNo}
            </p>
          )}
          <p className="text-xs text-stone-600">Quét chuyển khoản rồi bấm "Đã chuyển" để tải ảnh xác nhận.</p>
        </div>
      </Sheet>

      <Sheet
        open={!!rateRow}
        onClose={() => setRateRow(null)}
        title={`Đơn giá giờ · ${rateRow?.staff.fullName ?? ''}`}
        footer={
          <button type="button" disabled={rateM.isPending || !/^\d+$/.test(rateVal)} onClick={() => rateM.mutate()} className={`${BTN_PRIMARY} w-full`}>
            Lưu đơn giá
          </button>
        }
      >
        <Field label="Đơn giá (VND/giờ)">
          <input type="number" inputMode="numeric" value={rateVal} onChange={(e) => setRateVal(e.target.value)} className={INPUT_CLASS} />
        </Field>
      </Sheet>

      <Sheet
        open={!!payRow}
        onClose={() => setPayRow(null)}
        title={`Xác nhận đã chuyển · ${payRow?.staff.fullName ?? ''}`}
        footer={
          <button type="button" disabled={paidM.isPending || !proof} onClick={() => paidM.mutate()} className={`${BTN_PRIMARY} w-full`}>
            Đánh dấu đã trả
          </button>
        }
      >
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-stone-600">Số tiền</span>
            <strong>{formatVnd(payRow?.month.net ?? 0)}</strong>
          </div>
          <EvidenceUpload label="Ảnh xác nhận chuyển khoản" hint="bắt buộc" max={1} value={proof ? [proof] : []} onChange={(v) => setProof(v[0] ?? '')} />
          <Field label="Ghi chú (tuỳ chọn)">
            <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT_CLASS} />
          </Field>
        </div>
      </Sheet>

      <DetailSheet row={detailRow} year={ym.year} month={ym.month} onClose={() => setDetailRow(null)} onChanged={invalidate} />
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
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const staffId = row?.staff.id ?? '';
  const detailQ = useQuery({ ...adminPayrollDetailQuery(coreHttp, staffId, year, month), enabled: !!row });
  const [editId, setEditId] = useState<string | null>(null);
  const [ci, setCi] = useState('08:00');
  const [co, setCo] = useState('17:00');
  const [err, setErr] = useState<string | null>(null);

  const editM = useMutation({
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
      void qc.invalidateQueries({ queryKey: ['admin-payroll-detail', staffId, year, month] });
      onChanged();
    },
    onError: (e) => setErr(errText(e)),
  });

  return (
    <Sheet open={!!row} onClose={onClose} size="full" title={`Giờ công · ${row?.staff.fullName ?? ''} · T${month}/${year}`}>
      <div className="space-y-2.5">
        {err && <p role="alert" className="text-sm text-danger-fg">{err}</p>}
        {detailQ.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
        {detailQ.isError && (
          <p role="alert" className="text-sm text-danger-fg">
            {errText(detailQ.error)}
          </p>
        )}
        {detailQ.data && (
          <>
            <p className="text-sm">
              Tổng: <strong>{fmtHM(detailQ.data.month.totalMinutes)}</strong> · Thực nhận <strong>{formatVnd(detailQ.data.month.net)}</strong>
            </p>
            {detailQ.data.days.map((d) => {
              const dayKey = d.workDate.slice(0, 10);
              const sess = detailQ.data.sessions.filter((s) => vnDateKey(new Date(s.checkinAt)) === dayKey);
              return (
                <div key={d.id} className="border-t border-stone-200 pt-1.5">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="font-bold">
                      {dowLabel(dayKey)} {shortDayLabel(dayKey)} · {fmtHM(d.workedMinutes)}
                    </span>
                    <span>{formatVnd(d.net)}</span>
                  </div>
                  {sess.map((s) => (
                    <div key={s.id} className="mt-0.5 flex items-center justify-between gap-2 pl-2">
                      <span className="text-xs text-stone-600">
                        {isoToVnHHMM(s.checkinAt)} → {s.checkoutAt ? isoToVnHHMM(s.checkoutAt) : 'đang mở'}
                        {s.isLate ? ' · trễ' : ''}
                      </span>
                      <button
                        type="button"
                        aria-label={`Sửa giờ phiên ${isoToVnHHMM(s.checkinAt)}`}
                        onClick={() => {
                          setErr(null);
                          setEditId(s.id);
                          setCi(isoToVnHHMM(s.checkinAt));
                          setCo(s.checkoutAt ? isoToVnHHMM(s.checkoutAt) : isoToVnHHMM(s.checkinAt));
                        }}
                        className={BTN_LINK}
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
                      <button type="button" disabled={editM.isPending || co === ci || !ci || !co} onClick={() => editM.mutate(dayKey)} className={BTN_PRIMARY}>
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
