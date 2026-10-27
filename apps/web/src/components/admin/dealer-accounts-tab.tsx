'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEALER_ACCOUNTS_PAGE_SIZE,
  listDealerAccounts,
  listDealerTiersForEdit,
  type DealerAccountRow,
} from '@/lib/dealer-accounts-client';
import { formatVnd } from '@/lib/format-vnd';
import { DealerCreditPanel } from './dealer-credit-panel';
import { DealerTiersSection } from './dealer-tiers-section';
import { useDebounced } from './search-picker';
import { BTN_LINK, BTN_SMALL, FIELD_XS, ToneBadge, chipClass } from './ui';

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  return y && m ? `${m}/${y}` : ym;
};

/**
 * Danh sách đại lý đã duyệt: bậc, dư nợ so với hạn mức, doanh số tháng này, và chỗ ghi nhận tiền đại lý trả nợ.
 * Ghi nhận tiền dùng đúng API và khối `DealerCreditPanel` đã có ở chi tiết đơn đại lý (không có đường ghi tiền thứ hai).
 * Bên dưới là phần quản lý bậc đại lý (chỉ ADMIN sửa được; API là chốt chặn quyền).
 */
export function DealerAccountsTab({ isAdmin = true }: { isAdmin?: boolean } = {}) {
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 300);
  const [tierId, setTierId] = useState('');
  const [debtOnly, setDebtOnly] = useState(false);
  // Trang gắn với bộ lọc đã dùng để lấy nó: đổi bộ lọc thì tự về trang 1 mà không cần effect.
  const filterKey = `${search}|${tierId}|${debtOnly ? 1 : 0}`;
  const [pageAt, setPageAt] = useState({ key: filterKey, page: 1 });
  const page = pageAt.key === filterKey ? pageAt.page : 1;
  const filtered = !!search || !!tierId || debtOnly;

  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin-dealer-accounts', { page, search, tierId, debtOnly }],
    queryFn: () => listDealerAccounts({ page, search, tierId, debtOnly }),
    placeholderData: keepPreviousData,
  });
  const tiersQ = useQuery({ queryKey: ['admin-dealer-tiers', 'manage'], queryFn: listDealerTiersForEdit, enabled: isAdmin });
  const refetchList = () => void qc.invalidateQueries({ queryKey: ['admin-dealer-accounts'] });

  const total = q.data?.meta.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / DEALER_ACCOUNTS_PAGE_SIZE));
  const rows = q.data?.data ?? [];

  return (
    <div className="space-y-6">
      <section aria-label="Đại lý đã duyệt" data-dealer-accounts className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold text-stone-900">Đại lý đã duyệt</h2>
          {q.data && (
            <span className="text-xs text-stone-600">
              {q.data.summary.debtors} đại lý còn nợ · tổng dư nợ <b className="text-stone-900">{formatVnd(q.data.summary.totalDebt)}</b>
              <span className="text-stone-500"> · doanh số tháng {monthLabel(q.data.month)}</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Tìm đại lý theo tên hoặc SĐT"
            placeholder="Tìm theo tên hoặc SĐT"
            maxLength={64}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className={`${FIELD_XS} w-full sm:w-64`}
          />
          {isAdmin && (
            <select
              aria-label="Lọc đại lý theo bậc"
              value={tierId}
              onChange={(e) => setTierId(e.target.value)}
              className={`${FIELD_XS} w-full sm:w-auto`}
            >
              <option value="">Tất cả bậc</option>
              {tiersQ.data?.tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <button type="button" aria-pressed={debtOnly} onClick={() => setDebtOnly((v) => !v)} className={chipClass(debtOnly)}>
            Chỉ đại lý còn nợ
          </button>
        </div>

        {q.isLoading && <p className="text-sm text-stone-500">Đang tải danh sách đại lý…</p>}
        {q.isError && (
          <p role="alert" className="text-sm text-danger-fg">
            Không tải được danh sách đại lý.{' '}
            <button type="button" className={`${BTN_LINK} text-sm`} onClick={() => void q.refetch()}>
              Thử lại
            </button>
          </p>
        )}

        {q.isSuccess && rows.length === 0 && (
          <div data-dealer-accounts-empty className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center text-sm text-stone-600">
            {filtered ? (
              <>
                <p>Không có đại lý khớp bộ lọc.</p>
                <button
                  type="button"
                  className={`${BTN_SMALL} mt-2`}
                  onClick={() => {
                    setTyped('');
                    setTierId('');
                    setDebtOnly(false);
                  }}
                >
                  Xoá bộ lọc
                </button>
              </>
            ) : (
              <>
                <p className="font-medium text-stone-800">Chưa có đại lý nào được duyệt.</p>
                <p className="mt-1 text-xs text-stone-500">
                  Duyệt hồ sơ ở tab &quot;Đại lý&quot; (nhóm Đại lý và đối tác) thì đại lý sẽ hiện ở đây cùng bậc, dư nợ và doanh số tháng.
                </p>
              </>
            )}
          </div>
        )}

        <ul data-dealer-account-list className={`space-y-2 ${q.isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={q.isPlaceholderData}>
          {rows.map((r) => (
            <AccountRow key={r.userId} row={r} month={q.data ? monthLabel(q.data.month) : ''} onPaid={refetchList} />
          ))}
        </ul>

        {q.data && totalPages > 1 && (
          <div className="flex items-center justify-between px-1 text-sm text-stone-600">
            <span>
              Tổng: <b className="text-stone-900">{total}</b> đại lý
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPageAt({ key: filterKey, page: Math.max(1, page - 1) })}
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
                onClick={() => setPageAt({ key: filterKey, page: Math.min(totalPages, page + 1) })}
                disabled={page >= totalPages}
                className={BTN_SMALL}
              >
                Sau →
              </button>
            </div>
          </div>
        )}
      </section>

      {isAdmin && <DealerTiersSection />}
    </div>
  );
}

function AccountRow({ row: r, month, onPaid }: { row: DealerAccountRow; month: string; onPaid: () => void }) {
  const [open, setOpen] = useState(false);
  const owes = r.debt > 0;
  const debtTone = r.overLimit ? 'text-danger-fg' : owes ? 'text-warning-fg' : 'text-stone-700';

  return (
    <li data-dealer-account className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="break-words font-semibold text-stone-900">{r.fullName ?? 'Chưa có tên'}</div>
          <div className="text-xs text-stone-500">{r.phone ?? 'Chưa có SĐT'}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {r.overLimit && <ToneBadge tone="danger">Vượt hạn mức</ToneBadge>}
          <ToneBadge tone={r.tier ? 'info' : 'neutral'} wrap>
            {r.tier ? (r.tier.name ?? r.tier.id) : 'Chưa gán bậc'}
          </ToneBadge>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-stone-600 sm:grid-cols-2">
        <div>
          <dt className="inline">Dư nợ: </dt>
          <dd className="inline">
            <span className={`font-semibold ${debtTone}`}>{formatVnd(r.debt)}</span>
            <span className="text-stone-500"> / hạn mức {r.creditLimit > 0 ? formatVnd(r.creditLimit) : 'chưa có'}</span>
          </dd>
        </div>
        <div>
          <dt className="inline">Doanh số tháng {month}: </dt>
          <dd className="inline">
            <span className="font-semibold text-stone-900">{formatVnd(r.monthSales)}</span>
            <span className="text-stone-500">
              {' '}
              · {r.monthOrders} đơn{r.monthPending > 0 ? ` · chờ chốt ${formatVnd(r.monthPending)}` : ''}
            </span>
          </dd>
        </div>
      </dl>

      <div>
        <button
          type="button"
          aria-expanded={open}
          disabled={!owes && !open}
          title={owes || open ? undefined : 'Đại lý không còn nợ, không có khoản nào để ghi nhận.'}
          onClick={() => setOpen((v) => !v)}
          className={BTN_SMALL}
        >
          Ghi nhận thanh toán
        </button>
      </div>

      {open && <DealerCreditPanel order={{ type: 'DEALER', user: { id: r.userId, phone: r.phone, fullName: r.fullName } }} defaultOpen onPaid={onPaid} />}
    </li>
  );
}
