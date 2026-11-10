'use client';

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { adjustPayroll, recomputePayroll, type AdminPayrollRow } from '@tubutree/app-core/api/payroll';
import { ApiError } from '@/lib/client-api';
import { coreHttp } from '@/lib/core-http';
import { actionErrorText } from '@/lib/admin-error-text';
import { formatVnd } from '@/lib/format-vnd';
import { reloadWhenStale } from '@/lib/stale-write-rejection';
import { currentVnYearMonth, dowLabel, shortDayLabel, vnDateKey } from '@/lib/week';
import { Sheet } from '@/components/ui/sheet';
import { useConfirm } from './confirm-dialog';
import { BTN_PRIMARY, chipClass, Field, FIELD_CLASS, INPUT_CLASS, Notice } from './ui';

/** Cùng trần với AdjustDto của API: một cú gõ thừa số 0 không được thành khoản trăm triệu. */
const MAX_AMOUNT = 50_000_000;
const MIN_REASON = 3;
const MAX_REASON = 500;
const DUPLICATE_CODE = 'PAYROLL_ADJUST_DUPLICATE';

type Kind = 'fine' | 'bonus';

const pad2 = (n: number) => String(n).padStart(2, '0');
const dayKeysOf = (year: number, month: number) =>
  Array.from(
    { length: new Date(Date.UTC(year, month, 0)).getUTCDate() },
    (_, i) => `${year}-${pad2(month)}-${pad2(i + 1)}`,
  );
const dmy = (key: string) => key.split('-').reverse().join('/');

/** Tháng đang xem là tháng này thì mặc định hôm nay, tháng cũ thì ngày cuối tháng: ngày nằm trong tháng đang mở (API chặn tháng đã chốt). */
function defaultDay(year: number, month: number): string {
  const keys = dayKeysOf(year, month);
  const now = currentVnYearMonth();
  return now.year === year && now.month === month ? vnDateKey(new Date()) : keys[keys.length - 1]!;
}

/**
 * Thưởng/phạt tay cho một nhân viên: chọn loại và số tiền dương (máy chủ lưu số dương = trừ lương, số âm = thưởng, nên người dùng
 * không phải nhớ dấu), ngày công, lý do bắt buộc. Chỉ ghi sau khi xác nhận có nhắc lại số tiền; khoản giống hệt vừa ghi thì hỏi lại
 * trước khi ghi thêm. Khoản không xoá được nên một khoá ref phủ cả đường hỏi lẫn đường gửi và nhánh "khoản giống hệt" (Huỷ → tính lại),
 * nhả ở mọi đường thoát; lệnh bị từ chối vì bảng lương đã cũ (404/409 không phải khoản trùng; 400 là lỗi nhập số tiền/lý do nên chỉ hiện trong tờ) thì tải lại bảng (`onStale`) rồi mới nhả.
 */
export function PayrollAdjustSheet({
  row,
  year,
  month,
  onClose,
  onDone,
  onStale,
}: {
  row: AdminPayrollRow;
  year: number;
  month: number;
  onClose: () => void;
  onDone: (text: string) => void;
  /** Tải lại bảng lương của tháng đang mở; trả Promise để khoá chờ được. */
  onStale?: () => PromiseLike<unknown> | unknown;
}) {
  const { confirm, dialog } = useConfirm();
  const name = row.staff.fullName ?? row.staff.phone ?? 'NV';
  const [kind, setKind] = useState<Kind | null>(null);
  const [amountText, setAmountText] = useState('');
  const [day, setDay] = useState(() => defaultDay(year, month));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Ref vì state chỉ đúng sau lần vẽ kế; `working` chỉ để báo aria-busy và chặn đóng tờ.
  const acting = useRef(false);
  const [working, setWorking] = useState(false);

  const amount = /^\d+$/.test(amountText) ? Number(amountText) : 0;
  const reasonText = reason.trim();
  const valid =
    kind !== null && amount >= 1 && amount <= MAX_AMOUNT && reasonText.length >= MIN_REASON;
  const label = kind === 'bonus' ? 'thưởng' : 'phạt';

  const send = useMutation({
    mutationFn: async (allowDuplicate: boolean) => {
      await adjustPayroll(coreHttp, {
        staffId: row.staff.id,
        workDate: day,
        amount: kind === 'bonus' ? -amount : amount,
        reason: reasonText,
        ...(allowDuplicate ? { allowDuplicate: true } : {}),
      });
      // Máy chủ chỉ tự tính lại bảng lương khi mở đúng tháng hiện tại; cron chỉ tính lại tháng trước trong 3 ngày đầu tháng, ngoài khoảng đó
      // số tháng cũ (kể cả trong QR và ô "Số tiền" khi ghi đã trả) đứng yên tới khi có lần đọc hay ghi tính lại tháng đó (chốt, ghi đã trả,
      // Xem giờ, nhân viên mở Lương của tôi). Khoản đã ghi rồi nên lỗi ở bước này không được biến thành lỗi ghi khoản
      // (admin sẽ ghi lại và phạt hai lần).
      try {
        await recomputePayroll(coreHttp, row.staff.id, year, month);
        return true;
      } catch {
        return false;
      }
    },
  });

  const submit = async (allowDuplicate: boolean): Promise<void> => {
    setErr(null);
    setInfo(null);
    try {
      const recomputed = await send.mutateAsync(allowDuplicate);
      const done = `Đã ghi khoản ${label} ${formatVnd(amount)} cho ${name} (ngày ${dmy(day)}).`;
      onDone(recomputed ? done : `${done} Chưa cập nhật được số lương trên dòng: bấm Tính lại tháng để cập nhật số.`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === DUPLICATE_CODE) {
        const again = await confirm({
          title: 'Ghi thêm khoản thứ hai?',
          message: e.message,
          confirmLabel: 'Vẫn ghi thêm',
          tone: 'danger',
        });
        if (again) {
          await submit(true);
          return;
        }
        // Lần ghi trước có thể đã vào sổ mà phản hồi bị mất: tính lại để dòng lương khớp sổ dù admin không ghi thêm.
        let recomputed = true;
        try {
          await recomputePayroll(coreHttp, row.staff.id, year, month);
        } catch {
          recomputed = false;
        }
        const same = 'Khoản giống hệt đã có nên chưa ghi thêm.';
        const text = recomputed ? `${same} Đã cập nhật số lương trên dòng.` : `${same} Chưa cập nhật được số lương trên dòng: bấm Tính lại tháng để cập nhật số.`;
        // Hộp vẫn mở và lớp nền tối che lời báo của trang, nên báo cả trong hộp.
        setInfo(text);
        onDone(text);
        return;
      }
      setErr(actionErrorText(e));
      // Có ô số tiền và lý do nên 400 là lỗi nhập (hiện trong tờ ở trên), không phải bảng đã cũ: chỉ 404/409 tải lại bảng.
      await reloadWhenStale(e, () => onStale?.(), true);
    }
  };

  const confirmAndWrite = async () => {
    const go = await confirm({
      title: kind === 'bonus' ? 'Ghi khoản thưởng?' : 'Ghi khoản phạt?',
      message:
        `${kind === 'bonus' ? 'Thưởng' : 'Phạt'} ${formatVnd(amount)} cho ${name}, ngày ${dmy(day)}.\nLý do: ${reasonText}\n` +
        `Lương tháng ${month}/${year} của ${name} sẽ ${kind === 'bonus' ? 'tăng' : 'giảm'} ${formatVnd(amount)}. ` +
        'Khoản này không xoá được; nếu ghi nhầm thì ghi thêm một khoản ngược lại.',
      confirmLabel: kind === 'bonus' ? 'Ghi thưởng' : 'Ghi phạt',
      tone: kind === 'bonus' ? 'default' : 'danger',
    });
    if (go) await submit(false);
  };

  const review = async () => {
    if (!valid || acting.current) return;
    acting.current = true;
    setWorking(true);
    try {
      await confirmAndWrite();
    } finally {
      acting.current = false;
      setWorking(false);
    }
  };

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        dismissible={!working}
        title={`Thưởng/phạt · ${name}`}
        footer={
          <button
            type="button"
            data-adjust-submit
            disabled={!valid}
            aria-busy={working || undefined}
            aria-disabled={working || undefined}
            onClick={() => void review()}
            className={`${BTN_PRIMARY} w-full aria-disabled:opacity-60`}
          >
            {send.isPending ? 'Đang ghi…' : 'Xem lại và ghi'}
          </button>
        }
      >
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs font-medium text-stone-700">Loại khoản</p>
            <div role="group" aria-label="Loại khoản" className="flex gap-2">
              <button
                type="button"
                aria-pressed={kind === 'fine'}
                className={chipClass(kind === 'fine')}
                onClick={() => setKind('fine')}
              >
                Phạt
              </button>
              <button
                type="button"
                aria-pressed={kind === 'bonus'}
                className={chipClass(kind === 'bonus')}
                onClick={() => setKind('bonus')}
              >
                Thưởng
              </button>
            </div>
            <p className="mt-1 text-[11px] text-stone-500">
              {`Phạt trừ vào lương tháng ${month}/${year}, thưởng cộng thêm vào.`}
            </p>
          </div>
          <Field
            label="Số tiền (VND)"
            hint={
              amount >= 1 && amount <= MAX_AMOUNT
                ? formatVnd(amount)
                : 'Số nguyên từ 1 đến 50.000.000'
            }
          >
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_AMOUNT}
              step={1}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>
          <Field label="Ngày công">
            <select
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className={`${FIELD_CLASS} min-h-[44px] w-full sm:min-h-[36px]`}
            >
              {dayKeysOf(year, month).map((k) => (
                <option key={k} value={k}>
                  {dowLabel(k)} {shortDayLabel(k)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Lý do (nhân viên đọc được)"
            hint={`Từ ${MIN_REASON} ký tự, tối đa ${MAX_REASON}.`}
          >
            <textarea
              rows={3}
              maxLength={MAX_REASON}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={INPUT_CLASS}
              placeholder="VD: đi trễ ca sáng 2 lần"
            />
          </Field>
          {err && (
            <Notice tone="danger" role="alert">
              {err}
            </Notice>
          )}
          {info && (
            <Notice tone="info" role="status">
              {info}
            </Notice>
          )}
        </div>
      </Sheet>
      {dialog}
    </>
  );
}
