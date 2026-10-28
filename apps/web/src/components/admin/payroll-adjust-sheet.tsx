'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { adjustPayroll, type AdminPayrollRow } from '@tubutree/app-core/api/payroll';
import { ApiError } from '@/lib/client-api';
import { coreHttp } from '@/lib/core-http';
import { actionErrorText } from '@/lib/error-text';
import { formatVnd } from '@/lib/format-vnd';
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
 * trước khi ghi thêm.
 */
export function PayrollAdjustSheet({
  row,
  year,
  month,
  onClose,
  onDone,
}: {
  row: AdminPayrollRow;
  year: number;
  month: number;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const { confirm, dialog } = useConfirm();
  const name = row.staff.fullName ?? row.staff.phone ?? 'NV';
  const [kind, setKind] = useState<Kind | null>(null);
  const [amountText, setAmountText] = useState('');
  const [day, setDay] = useState(() => defaultDay(year, month));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const amount = /^\d+$/.test(amountText) ? Number(amountText) : 0;
  const reasonText = reason.trim();
  const valid =
    kind !== null && amount >= 1 && amount <= MAX_AMOUNT && reasonText.length >= MIN_REASON;
  const label = kind === 'bonus' ? 'thưởng' : 'phạt';

  const send = useMutation({
    mutationFn: (allowDuplicate: boolean) =>
      adjustPayroll(coreHttp, {
        staffId: row.staff.id,
        workDate: day,
        amount: kind === 'bonus' ? -amount : amount,
        reason: reasonText,
        ...(allowDuplicate ? { allowDuplicate: true } : {}),
      }),
  });

  const submit = async (allowDuplicate: boolean) => {
    setErr(null);
    try {
      await send.mutateAsync(allowDuplicate);
      onDone(`Đã ghi khoản ${label} ${formatVnd(amount)} cho ${name} (ngày ${dmy(day)}).`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === DUPLICATE_CODE) {
        const again = await confirm({
          title: 'Ghi thêm khoản thứ hai?',
          message: e.message,
          confirmLabel: 'Vẫn ghi thêm',
          tone: 'danger',
        });
        if (again) void submit(true);
        return;
      }
      setErr(actionErrorText(e));
    }
  };

  const review = async () => {
    if (!valid || send.isPending) return;
    const go = await confirm({
      title: kind === 'bonus' ? 'Ghi khoản thưởng?' : 'Ghi khoản phạt?',
      message:
        `${kind === 'bonus' ? 'Thưởng' : 'Phạt'} ${formatVnd(amount)} cho ${name}, ngày ${dmy(day)}.\nLý do: ${reasonText}\n` +
        `Lương tháng ${month}/${year} của ${name} sẽ ${kind === 'bonus' ? 'tăng' : 'giảm'} ${formatVnd(amount)}. ` +
        'Khoản này không xoá được; nếu ghi nhầm thì ghi thêm một khoản ngược lại.',
      confirmLabel: kind === 'bonus' ? 'Ghi thưởng' : 'Ghi phạt',
      tone: kind === 'bonus' ? 'default' : 'danger',
    });
    if (go) void submit(false);
  };

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={`Thưởng/phạt · ${name}`}
        footer={
          <button
            type="button"
            data-adjust-submit
            disabled={!valid || send.isPending}
            onClick={() => void review()}
            className={`${BTN_PRIMARY} w-full`}
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
              Phạt trừ vào lương tháng này, thưởng cộng thêm vào.
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
              className={INPUT_CLASS}
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
        </div>
      </Sheet>
      {dialog}
    </>
  );
}
