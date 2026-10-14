'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { BTN_XS_DANGER, BTN_XS_PRIMARY, BTN_XS_SECONDARY, FIELD_XS, Notice, ScrollRegion, ToneBadge, chipClass } from './ui';
import { ConsignmentExcludedList, SettlementTable, formatPct } from '@/components/settlement-table';
import { useNarrowScreen } from './side-drawer';

const SLA_LABEL = { CONFIRM_OVERDUE: 'Quá hạn xác nhận', SHIP_OVERDUE: 'Quá hạn gửi hàng', DELIVER_OVERDUE: 'Quá hạn giao' } as const;
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
export function MerchantFulfilmentTab({ onOpenConsignmentConfirm }: { onOpenConsignmentConfirm?: () => void }) {
  const qc = useQueryClient();
  const narrow = useNarrowScreen();
  const [slipFilter, setSlipFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const overviewQ = useQuery({ queryKey: ['admin-merchant-fulfilment'], queryFn: getMerchantFulfilmentOverview });
  const payoutsQ = useQuery({
    queryKey: ['admin-merchant-payouts', slipFilter],
    queryFn: () => listAdminMerchantPayouts(1, undefined, slipFilter === 'PENDING' ? 'PENDING' : undefined),
  });
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
          Hạn SLA: xác nhận {o.slaConfig.confirmHours} giờ, gửi hàng {o.slaConfig.shipHours} giờ, giao xong {o.slaConfig.deliverDays} ngày
          (sửa ở tab Cấu hình, nhóm merchant).
        </p>
      )}
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {overviewQ.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {overviewQ.isError && <p className="text-sm text-danger-fg">Không tải được tổng quan đơn đối tác.</p>}

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
                <StatementLines storefrontId={panelStore.storefrontId} title={panelStore.title} onOpenConsignmentConfirm={onOpenConsignmentConfirm} />
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
                <span className="text-stone-600">{ORDER_STATUS_LABELS[d.status] ?? d.status}</span>
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
        {payoutsQ.isError && <p className="text-sm text-danger-fg">Không tải được phiếu đối soát.</p>}
        {payoutsQ.data && payoutsQ.data.data.length === 0 && (
          <p className="rounded-card border border-stone-200 bg-stone-0 p-4 text-center text-xs text-stone-500">
            {slipFilter === 'PENDING' ? 'Không có phiếu nào đang chờ chuyển hoặc chờ thu.' : 'Chưa có phiếu nào.'}
          </p>
        )}
        <ul className="space-y-2">
          {payoutsQ.data?.data.map((p) => (
            <PayoutRow key={p.id} payout={p} onDone={refresh} onError={onError} />
          ))}
        </ul>
        {payoutsQ.data && payoutsQ.data.meta.total > payoutsQ.data.data.length && (
          <p className="text-xs text-stone-500">
            Đang hiện {payoutsQ.data.data.length} phiếu mới nhất, còn {payoutsQ.data.meta.total - payoutsQ.data.data.length} phiếu cũ hơn.
          </p>
        )}
      </section>
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
}

function StoreActions({ store: s, creating, open, onCreate, onToggle }: StoreRowProps) {
  return (
    <>
      <button type="button" disabled={s.settleableLines === 0 || creating} onClick={onCreate} className={BTN_XS_PRIMARY}>
        Lập phiếu đối soát
      </button>
      <button type="button" disabled={s.settleableLines === 0} aria-expanded={open === 'lines'} onClick={() => onToggle('lines')} className={BTN_XS_SECONDARY}>
        Xem khoản
      </button>
      <button type="button" aria-expanded={open === 'fees'} onClick={() => onToggle('fees')} className={BTN_XS_SECONDARY}>
        Sửa phí
      </button>
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
  if (q.isError || !q.data) return <p className="text-danger-fg">Không tải được bảng kê.</p>;
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

function PayoutRow({ payout: p, onDone, onError }: { payout: MerchantPayout; onDone: () => void; onError: (e: unknown) => void }) {
  const [bankRef, setBankRef] = useState('');
  const paidMut = useMutation({ mutationFn: () => markAdminMerchantPayoutPaid(p.id, bankRef.trim()), onSuccess: onDone, onError });
  const cancelMut = useMutation({ mutationFn: () => cancelAdminMerchantPayout(p.id), onSuccess: onDone, onError });
  const busy = paidMut.isPending || cancelMut.isPending;
  const bank = p.bankInfo;
  const toTubu = payoutToTubu(p);
  const status = payoutStatus(p, 'admin');
  return (
    <li className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3 text-xs shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-stone-900">{p.storefront?.title ?? p.storefrontId}</span>
        <span className="font-semibold">{signed(p.amount)}</span>
        <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
        <span className="text-stone-500">
          {p.lines.length} khoản · lập {formatDate(p.createdAt)}
          {p.bankRef ? ` · mã GD ${p.bankRef}` : ''}
        </span>
      </div>
      {p.lines.length > 0 && (
        <details>
          <summary className="flex min-h-[44px] cursor-pointer items-center font-medium text-forest-700 sm:min-h-6">Xem {p.lines.length} khoản</summary>
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
              : `Đối tác nộp ${formatVnd(-p.amount)} cho Tubu${p.transferMemo ? `, nội dung "${p.transferMemo}"` : ''}${p.dueAt ? `, hạn ${formatDate(p.dueAt)}` : ''}. Đối chiếu sao kê rồi bấm Đã thu.`}
          </p>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              paidMut.mutate();
            }}
          >
            <label className="text-stone-700">
              {toTubu ? 'Mã giao dịch đối tác nộp' : 'Mã giao dịch ngân hàng'}
              <input value={bankRef} onChange={(e) => setBankRef(e.target.value)} required maxLength={100} className={`mt-1 block w-48 ${FIELD_XS}`} />
            </label>
            <button type="submit" disabled={busy} className={BTN_XS_PRIMARY}>
              {toTubu ? 'Đã thu' : 'Đã chuyển'}
            </button>
            <button type="button" disabled={busy} onClick={() => cancelMut.mutate()} className={BTN_XS_DANGER}>
              Huỷ phiếu
            </button>
          </form>
        </>
      )}
    </li>
  );
}
