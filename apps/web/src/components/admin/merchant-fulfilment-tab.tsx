'use client';

import { useId, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelAdminMerchantPayout,
  createAdminMerchantPayout,
  getAdminMerchantStatement,
  getMerchantFulfilmentOverview,
  listAdminMerchantPayouts,
  markAdminMerchantPayoutPaid,
  updateAdminMerchantStoreTerms,
  type MerchantFulfilmentOverview,
  type MerchantPayout,
} from '@/lib/merchant-client';
import { formatVnd } from '@/lib/shop-client';
import { payoutStatus, payoutToTubu } from '@/lib/merchant-payout';
import { formatDate, formatDateTime } from '@/lib/format-date';
import { ORDER_STATUS_LABELS } from '@/lib/export-csv';
import { BTN_XS_DANGER, BTN_XS_PRIMARY, BTN_XS_SECONDARY, FIELD_XS, Notice, ScrollRegion, ToneBadge, chipClass, LoadError } from './ui';
import { ConsignmentExcludedList, SettlementTable, formatPct } from '@/components/settlement-table';
import { useNarrowScreen } from './side-drawer';
import { useConfirm } from './confirm-dialog';
import { mergeQueuePages, nextPageParam, setStorefrontPartner } from '@/lib/admin-client';

const SLA_LABEL = { CONFIRM_OVERDUE: 'Quá hạn xác nhận', SHIP_OVERDUE: 'Quá hạn gửi hàng', DELIVER_OVERDUE: 'Quá hạn giao' } as const;

/**
 * Đơn quá hạn xác nhận vẫn ở CONFIRMED (Tubu đã nhận đơn, gian hàng chưa nhận): nhãn trạng thái chung "Đã xác nhận" đứng cạnh
 * "Quá hạn xác nhận" nghe như tự mâu thuẫn và không chỉ ra đơn đang kẹt ở gian hàng.
 */
export function overdueStatusText(d: { status: string; sla: { state: string | null } }): string {
  return d.sla.state === 'CONFIRM_OVERDUE' ? 'Chờ gian hàng xác nhận' : (ORDER_STATUS_LABELS[d.status] ?? d.status);
}
const signed = (n: number) => (n < 0 ? `−${formatVnd(-n)}` : formatVnd(n));

type OverviewStore = MerchantFulfilmentOverview['stores'][number];

/** "Sàn 15% (mặc định) · Giao hộ 2% + 3.400đ/đơn" — mức phí đang áp cho gian hàng. */
export function storeFeesText(s: OverviewStore, defaultPct: number): string {
  const commission = s.commissionPct == null ? `Sàn ${formatPct(defaultPct)} (mặc định)` : `Sàn ${formatPct(s.commissionPct)}`;
  const pct = s.consignmentFeePct ?? 0;
  const fixed = s.consignmentFeeFixed ?? 0;
  const ops = [pct > 0 ? formatPct(pct) : null, fixed > 0 ? `${formatVnd(fixed)}/đơn` : null].filter(Boolean);
  return `${commission} · Giao hộ ${ops.length ? ops.join(' + ') : 'không phí'}`;
}

/** Ô phần trăm (2,5) → phân số 4 chữ số (0,025); ô trống → null. */
export function pctInputToFraction(v: string): number | null {
  const t = v.trim().replace(',', '.');
  if (t === '') return null;
  return Math.round(Number(t) * 100) / 10_000;
}

/**
 * "Đơn đối tác & đối soát": admin theo dõi gian hàng tự giao (đơn đang xử lý, quá hạn SLA), lập phiếu đối soát từ bảng kê (cả
 * hàng Tubu giao hộ), đánh dấu đã chuyển (kèm mã giao dịch) hoặc huỷ phiếu chưa chuyển, sửa phí sàn/phí giao hộ của gian hàng
 * (docs/2026-10-14-merchant-fulfilment-design.md mục 7, 8). Phiếu mặc định chỉ hiện phiếu chờ chuyển/thu (việc admin phải làm,
 * khớp số trên "Việc cần xử lý"); chip "Tất cả" xem cả phiếu đã xong. `onOpenConsignmentConfirm` mở màn xác nhận hàng ký gửi.
 */
export function MerchantFulfilmentTab({ onOpenConsignmentConfirm, isAdmin = false }: { onOpenConsignmentConfirm?: () => void; isAdmin?: boolean }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const narrow = useNarrowScreen();
  const [slipFilter, setSlipFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const overviewQ = useQuery({ queryKey: ['admin-merchant-fulfilment'], queryFn: getMerchantFulfilmentOverview });
  const payoutsQ = useInfiniteQuery({
    queryKey: ['admin-merchant-payouts', slipFilter],
    queryFn: ({ pageParam }) => listAdminMerchantPayouts(pageParam, undefined, slipFilter === 'PENDING' ? 'PENDING' : undefined),
    initialPageParam: 1,
    getNextPageParam: (last) => nextPageParam(last.meta),
  });
  const slips = mergeQueuePages(payoutsQ.data?.pages, false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: ['admin-merchant-fulfilment'] });
    void qc.invalidateQueries({ queryKey: ['admin-merchant-payouts'] });
    void qc.invalidateQueries({ queryKey: ['admin-ops-inbox'] });
  };
  const onError = (e: unknown) => setError(e instanceof Error ? e.message : 'Không thực hiện được.');
  const createMut = useMutation({
    mutationFn: (s: { storefrontId: string; settleableAmount: number }) => createAdminMerchantPayout(s.storefrontId, s.settleableAmount),
    onSuccess: refresh,
    onError,
  });
  const partnerMut = useMutation({
    mutationFn: (v: { storefrontId: string; isPartner: boolean }) => setStorefrontPartner(v.storefrontId, v.isPartner),
    onSuccess: refresh,
    onError,
  });
  const onTogglePartner = async (s: OverviewStore) => {
    if (partnerMut.isPending) return;
    const next = !s.isPartner;
    const ok = await confirm({
      title: next ? 'Bật gian hàng đối tác' : 'Tắt gian hàng đối tác',
      message: next
        ? `Bật quyền đối tác cho "${s.title}"? Chủ gian hàng sẽ dùng được Cổng người bán (đăng sản phẩm, đơn tự giao, đối soát).`
        : `Tắt quyền đối tác của "${s.title}"? Hệ thống từ chối nếu gian hàng còn việc đối tác dở dang (đơn tự giao, khoản chờ đối soát, phiếu chưa chuyển, yêu cầu trả hàng, sản phẩm đang bán).`,
      confirmLabel: next ? 'Bật' : 'Tắt',
      cancelLabel: 'Đóng',
      tone: next ? 'default' : 'danger',
    });
    if (ok && !partnerMut.isPending) partnerMut.mutate({ storefrontId: s.storefrontId, isPartner: next });
  };
  const partnerToggle = isAdmin ? { onToggle: onTogglePartner, pending: partnerMut.isPending } : undefined;
  const [panel, setPanel] = useState<{ storefrontId: string; kind: 'lines' | 'fees' } | null>(null);
  const toggle = (storefrontId: string, kind: 'lines' | 'fees') =>
    setPanel((cur) => (cur?.storefrontId === storefrontId && cur.kind === kind ? null : { storefrontId, kind }));

  const o = overviewQ.data;
  const panelStore = panel ? o?.stores.find((s) => s.storefrontId === panel.storefrontId) : undefined;
  const defaultPct = o?.defaultCommissionPct ?? 0.15;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-stone-900">Đơn đối tác & đối soát</h2>
        <button type="button" onClick={refresh} className={BTN_XS_SECONDARY}>
          Làm mới
        </button>
      </div>
      {o && (
        <p className="text-xs text-stone-500">
          Thời hạn xử lý: xác nhận {o.slaConfig.confirmHours} giờ, gửi hàng {o.slaConfig.shipHours} giờ, giao xong {o.slaConfig.deliverDays} ngày
          (sửa ở tab Cấu hình, thẻ &quot;Hoa hồng cộng tác viên và hạn xử lý của đối tác&quot;).
        </p>
      )}
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {overviewQ.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {overviewQ.isError && <LoadError onRetry={() => void overviewQ.refetch()} retrying={overviewQ.isFetching}>Không tải được tổng quan đơn đối tác.</LoadError>}

      {o && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-stone-900">Gian hàng đối tác ({o.stores.length})</h3>
          {o.stores.length === 0 ? (
            <p className="rounded-card border border-stone-200 bg-stone-0 p-4 text-center text-xs text-stone-500">
              Chưa có gian hàng nào có đơn tự giao hoặc hàng Tubu giao hộ.
            </p>
          ) : (
            narrow ? (
              <ul aria-label="Gian hàng đối tác" className="space-y-2">
                {o.stores.map((s) => (
                  <StoreCard
                    key={s.storefrontId}
                    store={s}
                    defaultPct={defaultPct}
                    creating={createMut.isPending}
                    open={panel?.storefrontId === s.storefrontId ? panel.kind : null}
                    onCreate={() => createMut.mutate(s)}
                    onToggle={(kind) => toggle(s.storefrontId, kind)}
                    partner={partnerToggle}
                    canEditFees={isAdmin}
                  />
                ))}
              </ul>
            ) : (
              <ScrollRegion label="Gian hàng đối tác" className="rounded-card border border-stone-200 bg-stone-0 shadow-card">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="bg-stone-50 text-stone-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Gian hàng</th>
                      <th className="px-3 py-2 text-right font-medium">Đang xử lý</th>
                      <th className="px-3 py-2 text-right font-medium">Quá hạn</th>
                      <th className="px-3 py-2 text-right font-medium">Chờ đối soát</th>
                      <th className="px-3 py-2 font-medium">Phí</th>
                      <th className="px-3 py-2 text-right font-medium">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {o.stores.map((s) => (
                      <StoreRow
                        key={s.storefrontId}
                        store={s}
                        defaultPct={defaultPct}
                        creating={createMut.isPending}
                        open={panel?.storefrontId === s.storefrontId ? panel.kind : null}
                        onCreate={() => createMut.mutate(s)}
                        onToggle={(kind) => toggle(s.storefrontId, kind)}
                        partner={partnerToggle}
                        canEditFees={isAdmin}
                      />
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            )
          )}
          {panel && panelStore && (
            <div className="space-y-2 rounded-card border border-stone-200 bg-stone-50 p-3 text-xs">
              <h4 className="font-semibold text-stone-900">
                {panel.kind === 'lines' ? `Khoản chờ lập phiếu · ${panelStore.title}` : `Phí của ${panelStore.title}`}
              </h4>
              {panel.kind === 'lines' ? (
                <StatementLines
                  storefrontId={panelStore.storefrontId}
                  title={panelStore.title}
                  onOpenConsignmentConfirm={isAdmin ? onOpenConsignmentConfirm : undefined}
                />
              ) : (
                <StoreTermsForm
                  key={panelStore.storefrontId}
                  store={panelStore}
                  defaultPct={defaultPct}
                  onSaved={() => {
                    setPanel(null);
                    refresh();
                  }}
                  onError={onError}
                />
              )}
            </div>
          )}
        </section>
      )}

      {o && o.overdue.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-stone-900">Đơn quá hạn ({o.overdue.length})</h3>
          <ul className="space-y-2">
            {o.overdue.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-card border border-stone-200 bg-stone-0 p-3 text-xs shadow-card">
                <span className="font-semibold text-stone-900">{d.code}</span>
                {d.sla.state && <ToneBadge tone="danger">{SLA_LABEL[d.sla.state]}</ToneBadge>}
                <span className="text-stone-600">{overdueStatusText(d)}</span>
                <span className="text-stone-600">
                  {d.fulfillerStorefront?.title}
                  {d.fulfillerStorefront?.owner?.phone ? ` · ${d.fulfillerStorefront.owner.phone}` : ''}
                </span>
                <span className="ml-auto text-stone-500">Đặt {formatDateTime(d.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-stone-900">Phiếu đối soát</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={slipFilter === 'PENDING'} onClick={() => setSlipFilter('PENDING')} className={chipClass(slipFilter === 'PENDING')}>
            Chờ xử lý
          </button>
          <button type="button" aria-pressed={slipFilter === 'ALL'} onClick={() => setSlipFilter('ALL')} className={chipClass(slipFilter === 'ALL')}>
            Tất cả
          </button>
        </div>
        {payoutsQ.isError && <LoadError onRetry={() => void payoutsQ.refetch()} retrying={payoutsQ.isFetching}>Không tải được phiếu đối soát.</LoadError>}
        {payoutsQ.data && slips.items.length === 0 && (
          <p className="rounded-card border border-stone-200 bg-stone-0 p-4 text-center text-xs text-stone-500">
            {slipFilter === 'PENDING' ? 'Không có phiếu nào đang chờ chuyển hoặc chờ thu.' : 'Chưa có phiếu nào.'}
          </p>
        )}
        <ul className="space-y-2">
          {slips.items.map((p) => (
            <PayoutRow key={p.id} payout={p} onDone={refresh} onError={onError} canConfirmToTubu={isAdmin} />
          ))}
        </ul>
        {slips.hasMore && (
          <div className="text-center">
            <p className="mb-2 text-xs text-stone-500">
              Đang hiện {slips.items.length}/{slips.total} phiếu, còn {slips.total - slips.items.length} phiếu cũ hơn.
            </p>
            <button type="button" onClick={() => void payoutsQ.fetchNextPage()} disabled={payoutsQ.isFetchingNextPage} className={BTN_XS_SECONDARY}>
              {payoutsQ.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
            </button>
            {payoutsQ.isFetchNextPageError && <p className="mt-1 text-xs text-danger-fg">Không tải thêm được, thử lại.</p>}
          </div>
        )}
      </section>
      {dialog}
    </div>
  );
}

interface StoreRowProps {
  store: OverviewStore;
  defaultPct: number;
  creating: boolean;
  open: 'lines' | 'fees' | null;
  onCreate: () => void;
  onToggle: (kind: 'lines' | 'fees') => void;
  /** Chỉ ADMIN: nút bật/tắt cờ đối tác (chỉ gian hàng CTV, loại khác API từ chối). */
  partner?: { onToggle: (s: OverviewStore) => void; pending: boolean };
  /** Chỉ ADMIN: sửa phí sàn/phí giao hộ (PATCH terms). Kế toán đối soát được nhưng không đổi phí. */
  canEditFees?: boolean;
}

function StoreActions({ store: s, creating, open, onCreate, onToggle, partner, canEditFees }: StoreRowProps) {
  return (
    <>
      <button type="button" disabled={s.settleableLines === 0 || creating} onClick={onCreate} className={BTN_XS_PRIMARY}>
        Lập phiếu đối soát
      </button>
      <button type="button" disabled={s.settleableLines === 0} aria-expanded={open === 'lines'} onClick={() => onToggle('lines')} className={BTN_XS_SECONDARY}>
        Xem khoản
      </button>
      {canEditFees && (s.isPartner || s.type === 'MERCHANT') && (
        <button type="button" aria-expanded={open === 'fees'} onClick={() => onToggle('fees')} className={BTN_XS_SECONDARY}>
          Sửa phí
        </button>
      )}
      {partner && s.type === 'CTV' && (
        <button type="button" disabled={partner.pending} onClick={() => partner.onToggle(s)} className={s.isPartner ? BTN_XS_DANGER : BTN_XS_SECONDARY}>
          {s.isPartner ? 'Tắt đối tác' : 'Bật đối tác'}
        </button>
      )}
    </>
  );
}

function SettleableText({ store: s }: { store: OverviewStore }) {
  const consignment = s.consignmentLines ?? 0;
  return (
    <>
      {s.settleableLines > 0 ? `${s.settleableLines} khoản · ${signed(s.settleableAmount)}` : '—'}
      {consignment > 0 && <div className="text-stone-500">trong đó {consignment} khoản Tubu giao hộ</div>}
    </>
  );
}

function StoreRow(props: StoreRowProps) {
  const { store: s, defaultPct } = props;
  return (
    <tr>
      <td className="px-3 py-2">
        <div className="font-medium text-stone-900">{s.title}</div>
        <div className="text-stone-500">{[s.owner?.fullName, s.owner?.phone].filter(Boolean).join(' · ')}</div>
      </td>
      <td className="px-3 py-2 text-right">{s.activeOrders}</td>
      <td className={`px-3 py-2 text-right ${s.overdueOrders > 0 ? 'font-semibold text-danger-fg' : ''}`}>{s.overdueOrders}</td>
      <td className="px-3 py-2 text-right">
        <SettleableText store={s} />
      </td>
      <td className="px-3 py-2 text-stone-600">{storeFeesText(s, defaultPct)}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap justify-end gap-1">
          <StoreActions {...props} />
        </div>
      </td>
    </tr>
  );
}

/** Điện thoại: mỗi gian hàng một thẻ, nút "Lập phiếu đối soát" nằm ngay trong tầm nhìn thay vì ở cột cuối của bảng 760px. */
function StoreCard(props: StoreRowProps) {
  const { store: s, defaultPct } = props;
  return (
    <li className="rounded-card border border-stone-200 bg-stone-0 p-3 text-xs shadow-card">
      <div className="text-sm font-medium text-stone-900">{s.title}</div>
      <div className="text-stone-500">{[s.owner?.fullName, s.owner?.phone].filter(Boolean).join(' · ')}</div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-stone-500">Đang xử lý</dt>
        <dd>{s.activeOrders}</dd>
        <dt className="text-stone-500">Quá hạn</dt>
        <dd className={s.overdueOrders > 0 ? 'font-semibold text-danger-fg' : ''}>{s.overdueOrders}</dd>
        <dt className="text-stone-500">Chờ đối soát</dt>
        <dd>
          <SettleableText store={s} />
        </dd>
        <dt className="text-stone-500">Phí</dt>
        <dd className="text-stone-600">{storeFeesText(s, defaultPct)}</dd>
      </dl>
      <div className="mt-3 flex flex-wrap gap-1">
        <StoreActions {...props} />
      </div>
    </li>
  );
}

/** Bảng kê chờ lập phiếu của một gian hàng (đơn tự giao và từng món Tubu giao hộ) để admin xem trước khi lập phiếu. */
function StatementLines({
  storefrontId,
  title,
  onOpenConsignmentConfirm,
}: {
  storefrontId: string;
  title: string;
  onOpenConsignmentConfirm?: () => void;
}) {
  const q = useQuery({ queryKey: ['admin-merchant-statement', storefrontId], queryFn: () => getAdminMerchantStatement(storefrontId) });
  if (q.isLoading) return <p className="text-stone-500">Đang tải bảng kê…</p>;
  if (q.isError || !q.data) return <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>Không tải được bảng kê.</LoadError>;
  return (
    <div className="space-y-3">
      {q.data.lines.length === 0 ? (
        <p className="text-stone-500">Không còn khoản nào chờ lập phiếu.</p>
      ) : (
        <SettlementTable
          lines={q.data.lines}
          label={`Khoản chờ lập phiếu của ${title}`}
          dateHeader="Ngày giao"
          dateOf={(l) => l.deliveredAt}
          viewer="admin"
        />
      )}
      <ConsignmentExcludedList data={q.data.consignmentExcluded} viewer="admin" storeTitle={title} onOpenConfirm={onOpenConsignmentConfirm} />
    </div>
  );
}

/** Admin đặt phí sàn riêng và phí "Tubu giao hộ" (% theo tiền khách trả cho món, cố định mỗi đơn) của gian hàng. */
function StoreTermsForm({
  store: s,
  defaultPct,
  onSaved,
  onError,
}: {
  store: OverviewStore;
  defaultPct: number;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const asPct = (f: number | null | undefined) => (f == null ? '' : String(Math.round(f * 10_000) / 100));
  const [commission, setCommission] = useState(asPct(s.commissionPct));
  const [feePct, setFeePct] = useState(asPct(s.consignmentFeePct ?? 0));
  const [feeFixed, setFeeFixed] = useState(String(s.consignmentFeeFixed ?? 0));
  const mut = useMutation({
    mutationFn: () =>
      updateAdminMerchantStoreTerms(s.storefrontId, {
        commissionPct: pctInputToFraction(commission),
        consignmentFeePct: pctInputToFraction(feePct) ?? 0,
        consignmentFeeFixed: Number(feeFixed.trim() || 0),
      }),
    onSuccess: onSaved,
    onError,
  });
  const id = (k: string) => `terms-${s.storefrontId}-${k}`;
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        mut.mutate();
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={id('commission')} className="block text-stone-700">Phí sàn riêng (%)</label>
          <input
            id={id('commission')}
            type="number"
            inputMode="decimal"
            min={0}
            max={50}
            step={0.01}
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
            placeholder={`Mặc định ${formatPct(defaultPct)}`}
            className={`mt-1 block w-36 ${FIELD_XS}`}
          />
        </div>
        <div>
          <label htmlFor={id('fee-pct')} className="block text-stone-700">Phí Tubu giao hộ (%)</label>
          <input
            id={id('fee-pct')}
            type="number"
            inputMode="decimal"
            min={0}
            max={50}
            step={0.01}
            required
            value={feePct}
            onChange={(e) => setFeePct(e.target.value)}
            className={`mt-1 block w-28 ${FIELD_XS}`}
          />
        </div>
        <div>
          <label htmlFor={id('fee-fixed')} className="block text-stone-700">Phí Tubu giao hộ mỗi đơn (đ)</label>
          <input
            id={id('fee-fixed')}
            type="number"
            inputMode="numeric"
            min={0}
            max={1_000_000}
            step={100}
            required
            value={feeFixed}
            onChange={(e) => setFeeFixed(e.target.value)}
            className={`mt-1 block w-36 ${FIELD_XS}`}
          />
        </div>
        <button type="submit" disabled={mut.isPending} className={BTN_XS_PRIMARY}>
          Lưu phí
        </button>
      </div>
      <p className="text-stone-500">
        Phí sàn để trống là theo mức mặc định. Phí Tubu giao hộ trừ thêm trên mỗi món giao hộ (theo số tiền khách thực trả cho
        món), phí cố định chia cho các món giao hộ của gian hàng trong cùng đơn. Mức mới chỉ áp cho đơn đặt từ lúc lưu; đơn đã
        đặt giữ mức cũ, kể cả khi chưa vào phiếu.
      </p>
    </form>
  );
}

function PayoutRow({
  payout: p,
  onDone,
  onError,
  canConfirmToTubu,
}: {
  payout: MerchantPayout;
  onDone: () => void;
  onError: (e: unknown) => void;
  canConfirmToTubu: boolean;
}) {
  const [bankRef, setBankRef] = useState('');
  const [refMissing, setRefMissing] = useState(false);
  const refErrorId = useId();
  const paidMut = useMutation({ mutationFn: () => markAdminMerchantPayoutPaid(p.id, bankRef.trim()), onSuccess: onDone, onError });
  const cancelMut = useMutation({ mutationFn: (reason: string) => cancelAdminMerchantPayout(p.id, reason), onSuccess: onDone, onError });
  const { confirm, ask, dialog } = useConfirm();
  const busy = paidMut.isPending || cancelMut.isPending;
  const bank = p.bankInfo;
  const toTubu = payoutToTubu(p);
  const status = payoutStatus(p, 'admin');
  const cancelled = p.status === 'CANCELLED';
  const askCancel = async () => {
    const reason = await ask({
      title: 'Huỷ phiếu đối soát?',
      message: `Phiếu ${signed(p.amount)} của ${p.storefront?.title ?? 'gian hàng'} (${p.lines.length} khoản) sẽ bị huỷ và các khoản quay lại bảng kê để lập phiếu mới. Gian hàng đã được báo có phiếu sẽ nhận thông báo huỷ kèm lý do bên dưới.`,
      confirmLabel: 'Huỷ phiếu',
      tone: 'danger',
      input: { label: 'Lý do huỷ (gian hàng sẽ đọc được)', placeholder: 'Vd: sai tài khoản nhận, lập nhầm kỳ', maxLength: 300, required: true },
    });
    if (reason) cancelMut.mutate(reason);
  };
  // Ghi sổ đối soát là không rút lại được; Enter trong ô mã giao dịch cũng gửi form nên bước hỏi phải nằm ở đây, không ở nút.
  const askPaid = async () => {
    const ref = bankRef.trim();
    // `required` của trình duyệt cho qua ô toàn dấu cách, còn API từ chối mã rỗng.
    if (!ref) {
      setRefMissing(true);
      return;
    }
    const store = p.storefront?.title ?? 'gian hàng';
    const amount = formatVnd(Math.abs(p.amount));
    const target = !toTubu
      ? bank?.accountNo
        ? `Tài khoản nhận: ${bank.bankName ?? ''} ${bank.accountNo} (${bank.accountName ?? ''})`
        : 'Gian hàng chưa khai tài khoản nhận đối soát.'
      : '';
    const ok = await confirm({
      title: toTubu ? 'Xác nhận đã thu của đối tác?' : 'Xác nhận đã chuyển cho đối tác?',
      message: [
        toTubu ? `Đối tác ${store} đã nộp ${amount} cho Tubu.` : `Tubu đã chuyển ${amount} cho đối tác ${store}.`,
        target,
        `Mã giao dịch: ${ref}`,
        'Phiếu sẽ chuyển sang đã xong và không sửa lại được.',
      ]
        .filter(Boolean)
        .join('\n'),
      confirmLabel: toTubu ? 'Đã thu' : 'Đã chuyển',
      tone: 'danger',
    });
    if (ok) paidMut.mutate();
  };
  return (
    <li className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3 text-xs shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-stone-900">{p.storefront?.title ?? p.storefrontId}</span>
        <span className={`font-semibold ${cancelled ? 'text-stone-500 line-through' : ''}`}>{signed(p.amount)}</span>
        <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
        {p.status === 'PENDING' && toTubu && p.dueAt && new Date(p.dueAt).getTime() < Date.now() && <ToneBadge tone="danger">Quá hạn nộp</ToneBadge>}
        <span className="text-stone-500">
          {cancelled ? `${p.cancelledLineCount ?? p.lines.length} khoản lúc huỷ` : `${p.lines.length} khoản`} · lập {formatDate(p.createdAt)}
          {p.bankRef ? ` · mã GD ${p.bankRef}` : ''}
        </span>
      </div>
      {p.note && <p className="text-stone-600">Ghi chú lúc lập: {p.note}</p>}
      {cancelled && (
        <p className="rounded-control bg-stone-100 px-3 py-2 text-stone-700">
          Huỷ {p.cancelledAt ? formatDate(p.cancelledAt) : ''}
          {p.cancelledBy ? ` bởi ${p.cancelledBy}` : ''}: {p.cancelReason ?? 'không ghi lý do (phiếu huỷ trước khi có lý do)'}
        </p>
      )}
      {p.lines.length > 0 && (
        <details>
          <summary className="flex min-h-[44px] cursor-pointer items-center font-medium text-forest-700 sm:min-h-6">
            {cancelled ? `Xem ${p.lines.length} khoản lúc huỷ` : `Xem ${p.lines.length} khoản`}
          </summary>
          <div className="mt-2">
            <SettlementTable
              lines={p.lines}
              label={`Các khoản của phiếu ${p.storefront?.title ?? p.storefrontId} lập ${formatDate(p.createdAt)}`}
              dateHeader="Vào phiếu"
              dateOf={(l) => l.createdAt ?? l.deliveredAt}
              viewer="admin"
            />
          </div>
        </details>
      )}
      {p.status === 'PENDING' && (
        <>
          <p className="text-stone-600">
            {!toTubu
              ? bank?.accountNo
                ? `Chuyển vào ${bank.bankName ?? ''} ${bank.accountNo} (${bank.accountName ?? ''})`
                : 'Gian hàng chưa khai tài khoản nhận đối soát: nhắc đối tác khai trước khi chuyển.'
              : `Đối tác nộp ${formatVnd(-p.amount)} cho Tubu${p.transferMemo ? `, nội dung "${p.transferMemo}"` : ''}${p.dueAt ? `, hạn ${formatDate(p.dueAt)}` : ''}. ${canConfirmToTubu ? 'Đối chiếu sao kê rồi bấm Đã thu.' : 'Quản trị viên xác nhận "Đã thu" sau khi đối chiếu sao kê.'}`}
          </p>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void askPaid();
            }}
          >
            {(!toTubu || canConfirmToTubu) && (
              <>
                <div>
                  <label className="text-stone-700">
                    {toTubu ? 'Mã giao dịch đối tác nộp' : 'Mã giao dịch ngân hàng'}
                    <input
                      value={bankRef}
                      onChange={(e) => {
                        setBankRef(e.target.value);
                        setRefMissing(false);
                      }}
                      required
                      maxLength={100}
                      aria-invalid={refMissing ? true : undefined}
                      aria-describedby={refMissing ? refErrorId : undefined}
                      className={`mt-1 block w-48 ${FIELD_XS}`}
                    />
                  </label>
                  {refMissing && (
                    <p id={refErrorId} role="alert" className="mt-1 text-danger-fg">
                      Nhập mã giao dịch trước khi ghi sổ.
                    </p>
                  )}
                </div>
                <button type="submit" disabled={busy} className={BTN_XS_PRIMARY}>
                  {toTubu ? 'Đã thu' : 'Đã chuyển'}
                </button>
              </>
            )}
            <button type="button" disabled={busy} onClick={() => void askCancel()} className={BTN_XS_DANGER}>
              Huỷ phiếu
            </button>
          </form>
        </>
      )}
      {dialog}
    </li>
  );
}
