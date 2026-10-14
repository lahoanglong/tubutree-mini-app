'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dismissCustomerRefund,
  listCustomerRefunds,
  releaseCustomerRefund,
  verifyCustomerRefund,
  type AdminCustomerRefund,
  type AdminCustomerRefundKind,
  type AdminCustomerRefundStatus,
} from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import { parseVndInput } from '@/lib/loyalty-pos';
import {
  CUSTOMER_REFUNDS_QUERY_KEY,
  CUSTOMER_REFUND_EMPTY,
  CUSTOMER_REFUND_FILTERS,
  CUSTOMER_REFUND_KINDS,
  CUSTOMER_REFUND_STALE_HINT,
  CUSTOMER_REFUND_VIEW_LABEL,
  CUSTOMER_REFUND_VIEW_TONE,
  DISMISS_REASON_MIN,
  TAKE_OVER_REASON_MIN,
  claimHolderSuffix,
  customerRefundView,
  markPaidFailure,
  needsBankAccount,
  needsClaim,
  overpaidAmountError,
  overpaymentFailure,
  refundKindLabel,
  refundReasonLabel,
  takeOverFrom,
  type RefundAction,
} from '@/lib/customer-refunds-admin';
import { CopyButton } from '@/components/copy-button';
import { BTN_LINK, BTN_SECONDARY, BTN_SMALL, BTN_WARNING, FIELD_CLASS, FIELD_XS, Notice, TOUCH_H, ToneBadge, chipClass } from './ui';
import { CustomerRefundPaidDialog, type MarkPaidOutcome } from './customer-refund-paid-dialog';
import { useConfirm } from './confirm-dialog';
import { formatDateTime } from '@/lib/format-date';

const PAGE_SIZE = 20;

/** "450000" → "450.000" để admin đọc đúng số tiền đang nhập. */
const groupDigits = (n: number | null) => (n == null ? '' : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));

const fmtDate = formatDateTime;

/**
 * Số khoản đang chờ chuyển khoản cạnh nhãn tab: một lần gọi limit=1 lấy meta.total (không thêm endpoint). Lỗi tải thì
 * không hiện gì, không chặn thanh tab. Cùng tiền tố khoá với danh sách nên mark-paid làm mới cả hai.
 */
export function CustomerRefundsPendingBadge() {
  const q = useQuery({
    queryKey: [CUSTOMER_REFUNDS_QUERY_KEY, 'PENDING', 'count'],
    queryFn: () => listCustomerRefunds('PENDING', 1, 1).then((r) => r.meta.total),
  });
  const n = q.data ?? 0;
  if (n <= 0) return null;
  return (
    <span
      data-refunds-pending
      className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-warning-bg px-1.5 text-[11px] font-semibold leading-5 text-warning-fg"
    >
      <span className="sr-only">, </span>
      {n > 99 ? '99+' : n}
      <span className="sr-only"> khoản chờ chuyển khoản</span>
    </span>
  );
}

/**
 * Hàng đợi hoàn tiền chuyển khoản tay. Mỗi dòng MANUAL_TRANSFER PENDING là tiền Tubu đang nợ khách:
 * - khách cuối của đơn CTV lên hộ (PA-1 / Q-01), chuyển theo SĐT;
 * - khách chọn "Tài khoản ngân hàng" khi huỷ/trả đơn đã trả tiền (D2), chuyển về tài khoản khách đã nhập;
 * - tiền về sau khi đơn đã huỷ/hết hạn (D2), chờ khách chọn nơi nhận hoặc admin nhập tài khoản khách cung cấp.
 * Khoản của khách có tài khoản: admin bấm "Bắt đầu chuyển khoản" (khoá nơi nhận, khách không rút về Ví được nữa) TRƯỚC khi
 * chuyển tiền bên ngoài, rồi xác nhận kèm mã giao dịch để sổ khớp. Màn này chỉ ghi sổ, không chuyển tiền thật.
 */
export function CustomerRefundsTab({ meId }: { meId?: string } = {}) {
  const [filter, setFilter] = useState<AdminCustomerRefundStatus>('PENDING');
  const [kind, setKind] = useState<AdminCustomerRefundKind | ''>('');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<{ refund: AdminCustomerRefund; mode: RefundAction } | null>(null);
  const [flash, setFlash] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  // Dòng vừa ghi xong: BE đã COMPLETED nhưng danh sách chưa tải lại xong, ẩn nút để không mở hộp lần hai.
  const [recorded, setRecorded] = useState<ReadonlySet<string>>(() => new Set());
  const q = useQuery({
    queryKey: [CUSTOMER_REFUNDS_QUERY_KEY, filter, kind, page],
    queryFn: () => listCustomerRefunds(filter, page, PAGE_SIZE, kind || undefined),
  });

  const total = q.data?.meta.total ?? 0;
  const totalPages = q.data ? Math.max(1, Math.ceil(total / (q.data.meta.limit || PAGE_SIZE))) : 1;
  // Xử lý xong dòng cuối của trang cuối thì trang đó rỗng: lùi về trang cuối còn dữ liệu thay vì kẹt ở màn rỗng.
  const outOfRange = !!q.data && page > totalPages;
  useEffect(() => {
    if (outOfRange) setPage(totalPages);
  }, [outOfRange, totalPages]);

  const rows = outOfRange ? [] : (q.data?.data ?? []);

  const qc = useQueryClient();
  const { ask, confirm, dialog } = useConfirm();
  const release = useMutation({
    mutationFn: ({ refund: r, takeOverReason }: { refund: AdminCustomerRefund; takeOverReason?: string }) =>
      releaseCustomerRefund(r.id, takeOverReason ? { takeOverReason } : undefined),
    onSuccess: (_d, { refund: r }) => {
      void qc.invalidateQueries({ queryKey: [CUSTOMER_REFUNDS_QUERY_KEY] });
      setFlash({ tone: 'success', text: `Đã trả khoản ${formatVnd(r.amount)} (đơn ${r.orderCode}) về hàng chờ. Khách lại đổi được nơi nhận.` });
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: [CUSTOMER_REFUNDS_QUERY_KEY] });
      setFlash({ tone: 'warning', text: markPaidFailure(e, 'claim').message });
    },
  });

  const onRelease = async (r: AdminCustomerRefund) => {
    setFlash(null);
    const from = takeOverFrom(r, meId);
    if (!from) {
      release.mutate({ refund: r });
      return;
    }
    const reason = await ask({
      title: 'Tiếp quản khoản đang chuyển khoản',
      message:
        `Khoản ${formatVnd(r.amount)} (đơn ${r.orderCode}) đang do ${from.holder} chuyển khoản${from.since ? ` từ ${fmtDate(from.since)}` : ''}.\n\n` +
        `Chỉ trả về hàng chờ khi chắc chắn ${from.holder} chưa chuyển và sẽ không chuyển nữa: khách sẽ đổi được sang Ví Tubu, ` +
        'nếu tiền đã đi là hoàn hai lần. Lý do được lưu vào lịch sử đơn.',
      confirmLabel: 'Trả về hàng chờ',
      cancelLabel: 'Đóng',
      tone: 'danger',
      input: { label: 'Lý do tiếp quản', placeholder: `Vd: ${from.holder} báo chưa chuyển được`, maxLength: 300, required: true },
    });
    if (reason === null) return;
    if (reason.length < TAKE_OVER_REASON_MIN) {
      setFlash({ tone: 'warning', text: `Ghi lý do tiếp quản ít nhất ${TAKE_OVER_REASON_MIN} ký tự rồi bấm lại.` });
      return;
    }
    release.mutate({ refund: r, takeOverReason: reason });
  };

  const verify = useMutation({
    mutationFn: ({ refund: r, amount }: { refund: AdminCustomerRefund; amount: number }) => verifyCustomerRefund(r.id, { amount }),
    onSuccess: (_d, { refund: r, amount }) => {
      void qc.invalidateQueries({ queryKey: [CUSTOMER_REFUNDS_QUERY_KEY] });
      setFlash({
        tone: 'success',
        text: `Đã xác nhận tiền trả dư ${formatVnd(amount)} (đơn ${r.orderCode}). Khách được báo để chọn nhận về Ví Tubu hay tài khoản ngân hàng; khoản chuyển sang "Chờ chuyển khoản".`,
      });
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: [CUSTOMER_REFUNDS_QUERY_KEY] });
      setFlash({ tone: 'warning', text: overpaymentFailure(e) });
    },
  });
  const dismiss = useMutation({
    mutationFn: ({ refund: r, reason }: { refund: AdminCustomerRefund; reason: string }) => dismissCustomerRefund(r.id, reason),
    onSuccess: (_d, { refund: r }) => {
      void qc.invalidateQueries({ queryKey: [CUSTOMER_REFUNDS_QUERY_KEY] });
      setFlash({ tone: 'success', text: `Đã đánh dấu khoản ${formatVnd(r.amount)} (đơn ${r.orderCode}) không phải tiền dư. Khách không được báo.` });
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: [CUSTOMER_REFUNDS_QUERY_KEY] });
      setFlash({ tone: 'warning', text: overpaymentFailure(e) });
    },
  });
  const deciding = verify.isPending || dismiss.isPending;

  const onVerify = async (r: AdminCustomerRefund, amount: number | null) => {
    setFlash(null);
    const error = overpaidAmountError(amount, r.amount);
    if (error || amount == null) {
      setFlash({ tone: 'warning', text: error ?? overpaidAmountError(null, r.amount)! });
      return;
    }
    const ok = await confirm({
      title: 'Xác nhận tiền trả dư',
      message:
        `Sao kê có khoản khách chuyển dư ${formatVnd(amount)} cho đơn ${r.orderCode}?\n\n` +
        'Khoản chuyển sang "Chờ chuyển khoản" và khách được báo để chọn nhận về Ví Tubu (cộng ngay, rút được) hay tài khoản ' +
        'ngân hàng. Chỉ bấm khi sao kê có khoản này.',
      confirmLabel: 'Xác nhận tiền dư',
      cancelLabel: 'Đóng',
    });
    if (!ok || verify.isPending) return;
    verify.mutate({ refund: r, amount });
  };

  const onDismiss = async (r: AdminCustomerRefund) => {
    setFlash(null);
    const reason = await ask({
      title: 'Không phải tiền dư',
      message:
        `Đánh dấu khoản ${formatVnd(r.amount)} (đơn ${r.orderCode}) không phải tiền khách trả dư?\n\n` +
        'Khách sẽ không được báo và không nhận khoản này; Pancake báo lại cùng số không tạo việc mới. Lý do được lưu vào khoản và lịch sử đơn.',
      confirmLabel: 'Không phải tiền dư',
      cancelLabel: 'Đóng',
      tone: 'danger',
      input: { label: 'Lý do', placeholder: 'Vd: Cùng một lần chuyển, sao kê chỉ có một khoản', maxLength: 300, required: true },
    });
    if (reason === null) return;
    if (reason.length < DISMISS_REASON_MIN) {
      setFlash({ tone: 'warning', text: `Ghi lý do ít nhất ${DISMISS_REASON_MIN} ký tự rồi bấm lại.` });
      return;
    }
    if (dismiss.isPending) return;
    dismiss.mutate({ refund: r, reason });
  };

  const onDone = (r: AdminCustomerRefund, outcome: MarkPaidOutcome) => {
    setTarget(null);
    if (outcome.kind === 'claimed') {
      setFlash({
        tone: 'success',
        text: `Đã khoá nơi nhận khoản ${formatVnd(r.amount)} (đơn ${r.orderCode}). Chuyển khoản rồi bấm "Đã chuyển khoản" ở mục Đang chuyển khoản.`,
      });
      setFilter('PROCESSING');
      setPage(1);
    } else if (outcome.kind === 'paid') {
      setRecorded((prev) => new Set(prev).add(r.id));
      setFlash({
        tone: 'success',
        text: `Đã ghi nhận chuyển khoản ${formatVnd(r.amount)} cho ${r.recipientName || r.bankAccountName || r.phone || 'khách'} (đơn ${r.orderCode}).`,
      });
    } else {
      setFlash({ tone: 'warning', text: `${outcome.message} ${CUSTOMER_REFUND_STALE_HINT}` });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-stone-900">Hoàn tiền khách</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            aria-label="Lọc theo loại khoản hoàn"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as AdminCustomerRefundKind | '');
              setPage(1);
            }}
            className={`${FIELD_CLASS} ${TOUCH_H}`}
          >
            {CUSTOMER_REFUND_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Lọc theo trạng thái">
            {CUSTOMER_REFUND_FILTERS.map((f) => (
              <button
                key={f.status}
                type="button"
                role="tab"
                aria-selected={filter === f.status}
                onClick={() => {
                  setFilter(f.status);
                  setPage(1);
                }}
                className={chipClass(filter === f.status)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="text-xs text-stone-600">
        Bấm &quot;Bắt đầu chuyển khoản&quot; để khoá nơi nhận (khách không đổi sang Ví được nữa), chuyển khoản tay về tài khoản
        khách đã chọn (đơn CTV lên hộ: theo SĐT khách cuối), miễn phí và không giới hạn số tiền, rồi bấm &quot;Đã chuyển
        khoản&quot; kèm mã giao dịch. Màn này chỉ ghi sổ, không tự chuyển tiền. Khoản &quot;Chờ đối soát&quot; là tiền dư Pancake
        báo, khách chưa thấy: đối chiếu sao kê rồi xác nhận hoặc bỏ qua.
      </p>

      {flash && (
        <Notice tone={flash.tone} role={flash.tone === 'success' ? 'status' : 'alert'}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-words">{flash.text}</span>
            <button type="button" className={`${BTN_LINK} text-xs`} onClick={() => setFlash(null)}>
              Đóng
            </button>
          </div>
        </Notice>
      )}

      {q.isLoading && (
        <div role="status" aria-busy="true" aria-label="Đang tải danh sách hoàn tiền" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-card bg-stone-100" />
          ))}
        </div>
      )}
      {q.isError && (
        <Notice tone="danger" role="alert">
          <div className="flex flex-wrap items-center gap-2">
            <span>Không tải được danh sách hoàn tiền.</span>
            <button type="button" className={BTN_SECONDARY} disabled={q.isFetching} onClick={() => void q.refetch()}>
              Thử lại
            </button>
          </div>
        </Notice>
      )}

      <div className="space-y-2">
        {rows.map((r) => (
          <CustomerRefundRow
            key={r.id}
            refund={r}
            meId={meId}
            recorded={recorded.has(r.id)}
            releasing={release.isPending && release.variables?.refund.id === r.id}
            onAction={(mode) => {
              setFlash(null);
              setTarget({ refund: r, mode });
            }}
            onRelease={() => void onRelease(r)}
            deciding={deciding}
            onVerify={(amount) => void onVerify(r, amount)}
            onDismiss={() => void onDismiss(r)}
          />
        ))}
        {q.data && !outOfRange && rows.length === 0 && (
          <p className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center text-sm text-stone-500">
            {CUSTOMER_REFUND_EMPTY[filter]}
          </p>
        )}
      </div>

      {q.data && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 text-sm text-stone-600">
          <span>
            Tổng: <b className="text-stone-900">{total}</b> khoản
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className={BTN_SMALL}
              >
                ← Trước
              </button>
              <span className="text-xs">
                Trang {page}/{totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className={BTN_SMALL}
              >
                Sau →
              </button>
            </div>
          )}
        </div>
      )}

      {target && (
        <CustomerRefundPaidDialog
          refund={target.refund}
          mode={target.mode}
          takeOverFrom={target.mode === 'paid' ? takeOverFrom(target.refund, meId) : null}
          onClose={() => setTarget(null)}
          onDone={(outcome) => onDone(target.refund, outcome)}
        />
      )}
      {dialog}
    </div>
  );
}

export function CustomerRefundRow({
  refund: r,
  meId,
  recorded = false,
  releasing = false,
  onAction,
  onRelease,
  deciding = false,
  onVerify,
  onDismiss,
}: {
  refund: AdminCustomerRefund;
  meId?: string;
  recorded?: boolean;
  releasing?: boolean;
  onAction: (mode: RefundAction) => void;
  onRelease?: () => void;
  /** Đang gửi "Xác nhận tiền dư" / "Không phải tiền dư". */
  deciding?: boolean;
  onVerify?: (amount: number | null) => void;
  onDismiss?: () => void;
}) {
  const view = customerRefundView(r);
  const [overpaid, setOverpaid] = useState<number | null>(r.amount);
  const undecided = view === 'UNVERIFIED' || view === 'DISMISSED';
  const manual = r.method === 'MANUAL_TRANSFER';
  const from = takeOverFrom(r, meId);
  const takeOverTag = from ? ' (tiếp quản)' : '';

  return (
    <div data-refund-id={r.id} className="min-w-0 rounded-card border border-stone-200 bg-stone-0 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-stone-900">{formatVnd(r.amount)}</span>
            <span data-refund-status={view}>
              <ToneBadge tone={CUSTOMER_REFUND_VIEW_TONE[view]}>{CUSTOMER_REFUND_VIEW_LABEL[view]}</ToneBadge>
            </span>
            <ToneBadge tone="neutral">{r.kind && r.kind !== 'END_CUSTOMER' ? refundKindLabel(r.kind) : refundReasonLabel(r.reason)}</ToneBadge>
          </div>
          <div className="mt-1 text-sm text-stone-600">
            Đơn <span className="break-all font-mono text-xs font-medium text-stone-800">{r.orderCode}</span>
          </div>
        </div>
        <span className="text-xs text-stone-500">Tạo lúc: {fmtDate(r.createdAt)}</span>
      </div>

      <div className="mt-2 space-y-1 text-sm text-stone-600">
        {view === 'WALLET' || undecided ? null : needsBankAccount(r) ? (
          <BankAccountLines refund={r} />
        ) : (
          <>
            <div>
              Người nhận:{' '}
              {r.recipientName ? (
                <span className="break-words font-medium text-stone-800">{r.recipientName}</span>
              ) : (
                <span className="text-stone-500">Chưa có tên</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span>SĐT:</span>
              {r.phone ? (
                <>
                  <span className="font-medium text-stone-800">{r.phone}</span>
                  <CopyButton text={r.phone} label="Chép SĐT" />
                </>
              ) : (
                <span className="text-warning-fg">Chưa có SĐT</span>
              )}
            </div>
          </>
        )}
        {!undecided && <div>Phương thức: {manual ? 'Chuyển khoản thủ công' : 'Ví Tubu'}</div>}
      </div>

      {view === 'UNVERIFIED' && (
        <div className="mt-3 space-y-2 border-t border-stone-200 pt-3">
          <p className="text-xs text-warning-fg">
            Pancake báo khách đã trả nhiều hơn tổng đơn. Khách chưa thấy khoản này. Đối chiếu sao kê: đúng là khách chuyển dư thì
            xác nhận số dư thực nhận (khách được báo để chọn nhận về Ví hay ngân hàng); cùng một lần chuyển hoặc nhân viên sửa đơn
            trên Pancake thì bấm &quot;Không phải tiền dư&quot;.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex w-full items-center gap-1.5 text-xs text-stone-700 sm:w-auto">
              <span className="shrink-0">Số tiền dư thực nhận</span>
              <input
                type="text"
                name="overpaidAmount"
                inputMode="numeric"
                autoComplete="off"
                value={groupDigits(overpaid)}
                onChange={(e) => setOverpaid(parseVndInput(e.target.value))}
                disabled={deciding}
                className={`${FIELD_XS} w-36 text-right`}
              />
              <span className="shrink-0">đ</span>
            </label>
            <button type="button" className={BTN_WARNING} disabled={deciding} onClick={() => onVerify?.(overpaid)}>
              Xác nhận tiền dư
            </button>
            <button type="button" className={BTN_SECONDARY} disabled={deciding} onClick={onDismiss}>
              Không phải tiền dư
            </button>
          </div>
        </div>
      )}

      {view === 'DISMISSED' && (
        <div className="mt-2 space-y-0.5 border-t border-stone-200 pt-2 text-xs text-stone-500">
          {r.completedAt && <div>Bỏ qua lúc: {fmtDate(r.completedAt)}</div>}
          {r.adminNote && (
            <div>
              Lý do: <span className="break-words text-stone-700">{r.adminNote}</span>
            </div>
          )}
          {r.completedBy && (
            <div>
              Admin bỏ qua: <span className="break-words text-stone-700">{r.completedByName || r.completedBy}</span>
            </div>
          )}
        </div>
      )}

      {(view === 'PENDING' || view === 'PROCESSING') && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
          {recorded ? (
            <span className="text-xs text-stone-500">Đã ghi nhận, đang cập nhật danh sách…</span>
          ) : view === 'PENDING' && needsClaim(r) ? (
            <>
              <button type="button" className={BTN_WARNING} onClick={() => onAction('claim')}>
                Bắt đầu chuyển khoản
              </button>
              <span className="text-xs text-stone-500">Khoá nơi nhận trước khi chuyển tiền.</span>
            </>
          ) : (
            <>
              {view === 'PROCESSING' && r.claimedAt && (
                <span className="w-full text-xs text-stone-500">
                  Bắt đầu chuyển lúc {fmtDate(r.claimedAt)}
                  {claimHolderSuffix(r, meId)} — khách không đổi được nơi nhận.
                </span>
              )}
              {from && (
                <span className="w-full text-xs text-warning-fg">
                  Chỉ {from.holder} được xác nhận hoặc trả về hàng chờ. Chắc chắn {from.holder} không chuyển nữa thì tiếp quản
                  kèm lý do (lưu vào lịch sử đơn).
                </span>
              )}
              <button type="button" className={BTN_WARNING} onClick={() => onAction('paid')}>
                {`Đã chuyển khoản${takeOverTag}`}
              </button>
              {view === 'PROCESSING' && onRelease && (
                <button type="button" className={BTN_SECONDARY} disabled={releasing} onClick={onRelease}>
                  {releasing ? 'Đang trả…' : `Trả về hàng chờ${takeOverTag}`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {r.status === 'COMPLETED' && (
        <div className="mt-2 space-y-0.5 border-t border-stone-200 pt-2 text-xs text-stone-500">
          {r.completedAt && (
            <div>
              {manual ? 'Đã chuyển lúc' : 'Hoàn lúc'}: {fmtDate(r.completedAt)}
            </div>
          )}
          {r.bankRef && (
            <div>
              Mã tham chiếu: <span className="break-all font-medium text-stone-800">{r.bankRef}</span>
            </div>
          )}
          {r.adminNote && (
            <div>
              Ghi chú: <span className="break-words text-stone-700">{r.adminNote}</span>
            </div>
          )}
          {manual && r.completedBy && (
            <div>
              {r.completedByName ? (
                <>
                  Admin xác nhận: <span className="break-words text-stone-700">{r.completedByName}</span>
                </>
              ) : (
                <>
                  Admin xác nhận (mã): <span className="break-all text-stone-700">{r.completedBy}</span>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BankAccountLines({ refund: r }: { refund: AdminCustomerRefund }) {
  if (!r.bankAccountNo) {
    return (
      <div className="text-warning-fg">
        Khách chưa chọn nơi nhận. Khách tự chọn ở chi tiết đơn; nếu khách gửi tài khoản qua hỗ trợ, nhập khi bấm &quot;Bắt đầu chuyển khoản&quot;.
      </div>
    );
  }
  return (
    <>
      <div>
        Ngân hàng: <span className="break-words font-medium text-stone-800">{r.bankName || 'Chưa ghi tên ngân hàng'}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span>Số tài khoản:</span>
        <span className="break-all font-medium text-stone-800">{r.bankAccountNo}</span>
        <CopyButton text={r.bankAccountNo} label="Chép STK" />
      </div>
      <div>
        Chủ tài khoản: <span className="break-words font-medium text-stone-800">{r.bankAccountName || 'Chưa có tên'}</span>
      </div>
    </>
  );
}
