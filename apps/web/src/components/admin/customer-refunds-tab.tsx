'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listCustomerRefunds, type AdminCustomerRefund, type AdminCustomerRefundStatus } from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import {
  CUSTOMER_REFUND_EMPTY,
  CUSTOMER_REFUND_FILTERS,
  customerRefundView,
  refundReasonLabel,
  type CustomerRefundView,
} from '@/lib/customer-refunds-admin';
import type { Tone } from '@/lib/recycling';
import { CopyButton } from '@/components/copy-button';
import { BTN_SECONDARY, BTN_SMALL, Notice, ToneBadge, chipClass } from './ui';

export const CUSTOMER_REFUNDS_QUERY_KEY = 'admin-customer-refunds';
const PAGE_SIZE = 20;

const VIEW_TONE: Record<CustomerRefundView, Tone> = { PENDING: 'warning', COMPLETED: 'success', WALLET: 'info' };
const VIEW_LABEL: Record<CustomerRefundView, string> = {
  PENDING: 'Chờ chuyển khoản',
  COMPLETED: 'Đã chuyển khoản',
  WALLET: 'Đã hoàn vào ví',
};

const fmtDate = (iso: string) => new Date(iso).toLocaleString('vi-VN');

/**
 * Hàng đợi hoàn tiền thủ công cho khách cuối của đơn CTV lên hộ (PA-1 / Q-01). Khi đơn bị huỷ/trả mà khách không
 * có tài khoản dùng được, tiền không vào ví nào: BE ghi một dòng MANUAL_TRANSFER PENDING = Tubu đang nợ khách, admin
 * chuyển khoản tay theo SĐT rồi xác nhận để sổ khớp. Màn này chỉ ghi nhận việc đã chuyển, không chuyển tiền thật.
 */
export function CustomerRefundsTab() {
  const [filter, setFilter] = useState<AdminCustomerRefundStatus>('PENDING');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: [CUSTOMER_REFUNDS_QUERY_KEY, filter, page],
    queryFn: () => listCustomerRefunds(filter, page, PAGE_SIZE),
  });

  const total = q.data?.meta.total ?? 0;
  const totalPages = q.data ? Math.max(1, Math.ceil(total / (q.data.meta.limit || PAGE_SIZE))) : 1;
  // Xử lý xong dòng cuối của trang cuối thì trang đó rỗng: lùi về trang cuối còn dữ liệu thay vì kẹt ở màn rỗng.
  const outOfRange = !!q.data && page > totalPages;
  useEffect(() => {
    if (outOfRange) setPage(totalPages);
  }, [outOfRange, totalPages]);

  const rows = outOfRange ? [] : (q.data?.data ?? []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-stone-900">Hoàn tiền khách (đơn CTV lên hộ)</h2>
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
      <p className="text-xs text-stone-600">
        Khách chưa có tài khoản nhận tiền: chuyển khoản tay theo SĐT dưới đây. Màn này chỉ ghi sổ, không tự chuyển tiền.
      </p>

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
          <CustomerRefundRow key={r.id} refund={r} />
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
    </div>
  );
}

export function CustomerRefundRow({ refund: r }: { refund: AdminCustomerRefund }) {
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
            <ToneBadge tone="neutral">{refundReasonLabel(r.reason)}</ToneBadge>
          </div>
          <div className="mt-1 text-sm text-stone-600">
            Đơn <span className="break-all font-mono text-xs font-medium text-stone-800">{r.orderCode}</span>
          </div>
        </div>
        <span className="text-xs text-stone-500">Tạo lúc: {fmtDate(r.createdAt)}</span>
      </div>

      <div className="mt-2 space-y-1 text-sm text-stone-600">
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
        <div>Phương thức: {manual ? 'Chuyển khoản thủ công' : 'Ví Tubu'}</div>
      </div>

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
