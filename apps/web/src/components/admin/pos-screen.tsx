'use client';

import { useRef, useState } from 'react';
import { ScanLine, UserRound, RotateCcw } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  getPosCreditEnabled,
  posCredit,
  scanMember,
  type PosCreditResult,
  type PosMember,
} from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import { pointsSummary } from '@/lib/checkout-points';
import {
  memberCodeError,
  orderTotalError,
  parseVndInput,
  posErrorView,
  receiptIdError,
  type PosErrorView,
} from '@/lib/loyalty-pos';
import { Field, INPUT_CLASS, Notice, TOUCH_H } from './ui';
import { formatDateTime } from '@/lib/format-date';

function ErrorBox({ err }: { err: PosErrorView }) {
  return (
    <Notice tone={err.kind === 'disabled' || err.kind === 'rate-limited' ? 'warning' : 'danger'} role="alert">
      {err.message}
    </Notice>
  );
}

/**
 * Màn thu ngân (STAFF/ADMIN): quét/nhập mã thành viên → xem khách → nhập tổng tiền + mã hoá đơn → tích
 * Điểm Xanh. Chống bấm đôi 3 lớp: khoá ref đồng bộ (click thứ 2 trong cùng tick không gửi), nút khoá khi
 * đang gửi, và mã hoá đơn là khoá idempotency phía BE (gửi lại cùng hoá đơn → `replayed`, không cộng thêm).
 * Sau khi tích xong form bị khoá tới khi bấm "Khách tiếp theo".
 */
export function PosScreen() {
  const enabledQ = useQuery({ queryKey: ['pos-credit-enabled'], queryFn: getPosCreditEnabled, staleTime: 60_000 });

  const [code, setCode] = useState('');
  const [member, setMember] = useState<PosMember | null>(null);
  const memberPoints = member ? pointsSummary(member) : null;
  const [memberCodeUsed, setMemberCodeUsed] = useState('');
  const [lookupErr, setLookupErr] = useState<PosErrorView | null>(null);

  const [total, setTotal] = useState('');
  const [receipt, setReceipt] = useState('');
  const [note, setNote] = useState('');
  const [formErr, setFormErr] = useState<string | null>(null);
  const [creditErr, setCreditErr] = useState<PosErrorView | null>(null);
  const [result, setResult] = useState<PosCreditResult | null>(null);
  const inFlight = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);

  const lookup = useMutation({
    mutationFn: (memberCode: string) => scanMember(memberCode),
    onSuccess: (r, memberCode) => {
      setMember(r.member);
      setMemberCodeUsed(memberCode);
      setLookupErr(null);
    },
    onError: (e) => {
      setMember(null);
      setLookupErr(posErrorView(e));
    },
  });

  const credit = useMutation({
    mutationFn: (body: { memberCode: string; orderTotal: number; receiptId: string; note?: string }) => posCredit(body),
    onSuccess: (r) => {
      setResult(r);
      setMember(r.member);
      setCreditErr(null);
    },
    onError: (e) => setCreditErr(posErrorView(e)),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const submitLookup = () => {
    const e = memberCodeError(code);
    if (e) return setLookupErr({ kind: 'other', message: e });
    setResult(null);
    setCreditErr(null);
    lookup.mutate(code.trim());
  };

  const submitCredit = () => {
    if (!member || inFlight.current || credit.isPending || result) return;
    const amount = parseVndInput(total);
    const err = orderTotalError(amount) ?? receiptIdError(receipt);
    if (err) return setFormErr(err);
    setFormErr(null);
    setCreditErr(null);
    inFlight.current = true;
    credit.mutate({
      memberCode: memberCodeUsed,
      orderTotal: amount!,
      receiptId: receipt.trim(),
      ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}),
    });
  };

  const nextCustomer = () => {
    setCode('');
    setMember(null);
    setMemberCodeUsed('');
    setLookupErr(null);
    setTotal('');
    setReceipt('');
    setNote('');
    setFormErr(null);
    setCreditErr(null);
    setResult(null);
    lookup.reset();
    credit.reset();
    codeInput.current?.focus();
  };

  const locked = credit.isPending || !!result;
  const amountPreview = parseVndInput(total);

  return (
    <div className="space-y-4">
      {enabledQ.data === false && (
        <Notice tone="warning" role="status">
          Tích điểm tại quầy đang TẮT — vẫn tra cứu được thành viên nhưng chưa cộng được điểm. Quản trị viên bật trong Quản trị
          → Cấu hình → Điểm Xanh.
        </Notice>
      )}

      <section className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-stone-900">
          <ScanLine className="h-4 w-4 text-forest-700" aria-hidden /> 1. Quét thẻ thành viên
        </h2>
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submitLookup();
          }}
        >
          <input
            ref={codeInput}
            autoFocus
            aria-label="Mã thành viên"
            placeholder="Quét mã QR trên thẻ, hoặc nhập TUBU… / SĐT"
            className={`${INPUT_CLASS} ${TOUCH_H} min-w-[240px] flex-1 font-mono`}
            value={code}
            maxLength={40}
            onChange={(e) => setCode(e.target.value)}
            disabled={lookup.isPending || locked}
          />
          <button
            type="submit"
            disabled={lookup.isPending || locked || !code.trim()}
            className={`${TOUCH_H} rounded-control bg-forest-600 px-4 py-1.5 text-sm font-medium text-stone-0 hover:bg-forest-700 disabled:bg-stone-200 disabled:text-stone-500`}
          >
            {lookup.isPending ? 'Đang tra…' : 'Tra cứu'}
          </button>
        </form>
        {lookupErr && (
          <div className="mt-2">
            <ErrorBox err={lookupErr} />
          </div>
        )}

        {member && (
          <div className="mt-3 flex items-center gap-3 rounded-control border border-forest-200 bg-forest-50 p-3" aria-label="Thành viên">
            <UserRound className="h-8 w-8 shrink-0 text-forest-700" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-stone-900">{member.name}</div>
              <div className="text-xs text-stone-600">
                {member.phone ?? 'Chưa có SĐT'} · Hạng <b>{member.tier}</b> · {member.memberCode}
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-forest-700">{(memberPoints?.total ?? 0).toLocaleString('vi-VN')}</div>
              <div className="text-[11px] text-stone-500">Điểm Xanh</div>
              {memberPoints?.convertedNote && <div className="text-[11px] text-stone-500">{memberPoints.convertedNote}</div>}
            </div>
          </div>
        )}
      </section>

      {member && (
        <section className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
          <h2 className="font-display text-sm font-semibold text-stone-900">2. Tích điểm cho hoá đơn</h2>
          <form
            className="mt-2 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitCredit();
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Tổng tiền hoá đơn (đ)" hint={amountPreview ? formatVnd(amountPreview) : undefined}>
                <input
                  aria-label="Tổng tiền hoá đơn"
                  inputMode="numeric"
                  className={`${INPUT_CLASS} ${TOUCH_H}`}
                  placeholder="vd 250000"
                  value={total}
                  onChange={(e) => setTotal(e.target.value.replace(/[^\d.,]/g, ''))}
                  disabled={locked}
                />
              </Field>
              <Field label="Mã hoá đơn POS" hint="In trên hoá đơn. Mỗi hoá đơn chỉ tích 1 lần.">
                <input
                  aria-label="Mã hoá đơn POS"
                  className={`${INPUT_CLASS} ${TOUCH_H} font-mono`}
                  placeholder="vd HD-000123"
                  value={receipt}
                  maxLength={64}
                  onChange={(e) => setReceipt(e.target.value.trim())}
                  disabled={locked}
                />
              </Field>
            </div>
            <Field label="Ghi chú (tuỳ chọn)">
              <input
                aria-label="Ghi chú"
                className={`${INPUT_CLASS} ${TOUCH_H}`}
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                disabled={locked}
              />
            </Field>
            {formErr && <p role="alert" className="text-sm text-danger-fg">{formErr}</p>}
            {creditErr && <ErrorBox err={creditErr} />}
            {!result && (
              <button
                type="submit"
                disabled={locked}
                className="min-h-[44px] w-full rounded-control bg-forest-600 px-4 py-2.5 text-sm font-semibold text-stone-0 hover:bg-forest-700 disabled:bg-stone-200 disabled:text-stone-500"
              >
                {credit.isPending ? 'Đang tích điểm…' : 'Tích điểm'}
              </button>
            )}
          </form>

          {result && (
            <div className="mt-3 space-y-2" role="status">
              {result.replayed ? (
                <Notice tone="warning">
                  Hoá đơn <b>{result.posTransaction.receiptId}</b> ĐÃ được tích điểm trước đó (
                  {formatDateTime(result.posTransaction.creditedAt)}, +{result.posTransaction.pointsEarned} điểm) —
                  KHÔNG cộng thêm lần nữa.
                </Notice>
              ) : (
                <Notice tone="success">
                  Đã cộng <b>+{result.posTransaction.pointsEarned} Điểm Xanh</b> cho hoá đơn {result.posTransaction.receiptId} (
                  {formatVnd(result.posTransaction.orderTotal)}). Số dư mới: <b>{pointsSummary(result.member).total.toLocaleString('vi-VN')}</b>{' '}
                  điểm.
                </Notice>
              )}
              <button
                type="button"
                onClick={nextCustomer}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-control border border-stone-450 bg-stone-0 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                <RotateCcw className="h-4 w-4" aria-hidden /> Khách tiếp theo
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
