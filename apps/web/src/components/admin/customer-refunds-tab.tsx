'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listCustomerRefunds,
  releaseCustomerRefund,
  type AdminCustomerRefund,
  type AdminCustomerRefundKind,
  type AdminCustomerRefundStatus,
} from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import {
  CUSTOMER_REFUNDS_QUERY_KEY,
  CUSTOMER_REFUND_EMPTY,
  CUSTOMER_REFUND_FILTERS,
  CUSTOMER_REFUND_KINDS,
  CUSTOMER_REFUND_STALE_HINT,
  customerRefundView,
  markPaidFailure,
  needsBankAccount,
  needsClaim,
  refundKindLabel,
  refundReasonLabel,
  type CustomerRefundView,
  type RefundAction,
} from '@/lib/customer-refunds-admin';
import type { Tone } from '@/lib/recycling';
import { CopyButton } from '@/components/copy-button';
import { BTN_LINK, BTN_SECONDARY, BTN_SMALL, BTN_WARNING, FIELD_CLASS, Notice, TOUCH_H, ToneBadge, chipClass } from './ui';
import { CustomerRefundPaidDialog, type MarkPaidOutcome } from './customer-refund-paid-dialog';
import { formatDateTime } from '@/lib/format-date';

const PAGE_SIZE = 20;

const VIEW_TONE: Record<CustomerRefundView, Tone> = { PENDING: 'warning', PROCESSING: 'info', COMPLETED: 'success', WALLET: 'info' };
const VIEW_LABEL: Record<CustomerRefundView, string> = {
  PENDING: 'Chờ chuyển khoản',
  PROCESSING: 'Đang chuyển khoản',
  COMPLETED: 'Đã chuyển khoản',
  WALLET: 'Đã hoàn vào ví',
};

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
export function CustomerRefundsTab() {
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
  const release = useMutation({
    mutationFn: (r: AdminCustomerRefund) => releaseCustomerRefund(r.id),
    onSuccess: (_d, r) => {
      void qc.invalidateQueries({ queryKey: [CUSTOMER_REFUNDS_QUERY_KEY] });
      setFlash({ tone: 'success', text: `Đã trả khoản ${formatVnd(r.amount)} (đơn ${r.orderCode}) về hàng chờ. Khách lại đổi được nơi nhận.` });
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: [CUSTOMER_REFUNDS_QUERY_KEY] });
      setFlash({ tone: 'warning', text: markPaidFailure(e, 'claim').message });
    },
  });

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
        khoản&quot; kèm mã giao dịch. Màn này chỉ ghi sổ, không tự chuyển tiền.
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
            recorded={recorded.has(r.id)}
            releasing={release.isPending && release.variables?.id === r.id}
            onAction={(mode) => {
              setFlash(null);
              setTarget({ refund: r, mode });
            }}
            onRelease={() => {
              setFlash(null);
              release.mutate(r);
            }}
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
          onClose={() => setTarget(null)}
          onDone={(outcome) => onDone(target.refund, outcome)}
        />
      )}
    </div>
  );
}

export function CustomerRefundRow({
  refund: r,
  recorded = false,
  releasing = false,
  onAction,
  onRelease,
}: {
  refund: AdminCustomerRefund;
  recorded?: boolean;
  releasing?: boolean;
  onAction: (mode: RefundAction) => void;
  onRelease?: () => void;
}) {
  const view = customerRefundView(r);
  const manual = r.method === 'MANUAL_TRANSFER';

  return (
    <div data-refund-id={r.id} className="min-w-0 rounded-card border border-stone-200 bg-stone-0 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-stone-900">{formatVnd(r.amount)}</span>
            <span data-refund-status={view}>
              <ToneBadge tone={VIEW_TONE[view]}>{VIEW_LABEL[view]}</ToneBadge>
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
        {needsBankAccount(r) ? (
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
        <div>Phương thức: {manual ? 'Chuyển khoản thủ công' : 'Ví Tubu'}</div>
      </div>

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
                <span className="w-full text-xs text-stone-500">Bắt đầu chuyển lúc {fmtDate(r.claimedAt)} — khách không đổi được nơi nhận.</span>
              )}
              <button type="button" className={BTN_WARNING} onClick={() => onAction('paid')}>
                Đã chuyển khoản
              </button>
              {view === 'PROCESSING' && onRelease && (
                <button type="button" className={BTN_SECONDARY} disabled={releasing} onClick={onRelease}>
                  {releasing ? 'Đang trả…' : 'Trả về hàng chờ'}
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
              Admin xác nhận (mã): <span className="break-all text-stone-700">{r.completedBy}</span>
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
