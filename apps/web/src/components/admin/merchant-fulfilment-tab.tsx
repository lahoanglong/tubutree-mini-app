'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelAdminMerchantPayout,
  createAdminMerchantPayout,
  getMerchantFulfilmentOverview,
  listAdminMerchantPayouts,
  markAdminMerchantPayoutPaid,
  type MerchantPayout,
} from '@/lib/merchant-client';
import { formatVnd } from '@/lib/shop-client';
import { formatDate, formatDateTime } from '@/lib/format-date';
import { ORDER_STATUS_LABELS } from '@/lib/export-csv';
import { BTN_XS_DANGER, BTN_XS_PRIMARY, BTN_XS_SECONDARY, FIELD_XS, Notice, ScrollRegion, ToneBadge } from './ui';

const SLA_LABEL = { CONFIRM_OVERDUE: 'Quá hạn xác nhận', SHIP_OVERDUE: 'Quá hạn gửi hàng', DELIVER_OVERDUE: 'Quá hạn giao' } as const;
const signed = (n: number) => (n < 0 ? `−${formatVnd(-n)}` : formatVnd(n));

/**
 * "Đơn đối tác tự giao": admin theo dõi gian hàng tự giao (đơn đang xử lý, quá hạn SLA), lập phiếu đối soát từ bảng kê, đánh
 * dấu đã chuyển (kèm mã giao dịch) hoặc huỷ phiếu chưa chuyển (docs/2026-10-14-merchant-fulfilment-design.md mục 7, 8).
 */
export function MerchantFulfilmentTab() {
  const qc = useQueryClient();
  const overviewQ = useQuery({ queryKey: ['admin-merchant-fulfilment'], queryFn: getMerchantFulfilmentOverview });
  const payoutsQ = useQuery({ queryKey: ['admin-merchant-payouts'], queryFn: () => listAdminMerchantPayouts(1) });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setError(null);
    void qc.invalidateQueries({ queryKey: ['admin-merchant-fulfilment'] });
    void qc.invalidateQueries({ queryKey: ['admin-merchant-payouts'] });
  };
  const onError = (e: unknown) => setError(e instanceof Error ? e.message : 'Không thực hiện được.');
  const createMut = useMutation({ mutationFn: (storefrontId: string) => createAdminMerchantPayout(storefrontId), onSuccess: refresh, onError });

  const o = overviewQ.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-stone-900">Đơn đối tác tự giao</h2>
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
          <h3 className="text-sm font-semibold text-stone-900">Gian hàng tự giao ({o.stores.length})</h3>
          {o.stores.length === 0 ? (
            <p className="rounded-card border border-stone-200 bg-stone-0 p-4 text-center text-xs text-stone-500">Chưa có gian hàng nào có đơn tự giao.</p>
          ) : (
            <ScrollRegion label="Gian hàng tự giao" className="rounded-card border border-stone-200 bg-stone-0 shadow-card">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 text-stone-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Gian hàng</th>
                    <th className="px-3 py-2 text-right font-medium">Đang xử lý</th>
                    <th className="px-3 py-2 text-right font-medium">Quá hạn</th>
                    <th className="px-3 py-2 text-right font-medium">Chờ đối soát</th>
                    <th className="px-3 py-2 text-right font-medium">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {o.stores.map((s) => (
                    <tr key={s.storefrontId}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-stone-900">{s.title}</div>
                        <div className="text-stone-500">{[s.owner?.fullName, s.owner?.phone].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="px-3 py-2 text-right">{s.activeOrders}</td>
                      <td className={`px-3 py-2 text-right ${s.overdueOrders > 0 ? 'font-semibold text-danger-fg' : ''}`}>{s.overdueOrders}</td>
                      <td className="px-3 py-2 text-right">
                        {s.settleableLines > 0 ? `${s.settleableLines} khoản · ${signed(s.settleableAmount)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          disabled={s.settleableLines === 0 || createMut.isPending}
                          onClick={() => createMut.mutate(s.storefrontId)}
                          className={BTN_XS_PRIMARY}
                        >
                          Lập phiếu đối soát
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
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
        {payoutsQ.isError && <p className="text-sm text-danger-fg">Không tải được phiếu đối soát.</p>}
        {payoutsQ.data && payoutsQ.data.data.length === 0 && (
          <p className="rounded-card border border-stone-200 bg-stone-0 p-4 text-center text-xs text-stone-500">Chưa có phiếu nào.</p>
        )}
        <ul className="space-y-2">
          {payoutsQ.data?.data.map((p) => (
            <PayoutRow key={p.id} payout={p} onDone={refresh} onError={onError} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function PayoutRow({ payout: p, onDone, onError }: { payout: MerchantPayout; onDone: () => void; onError: (e: unknown) => void }) {
  const [bankRef, setBankRef] = useState('');
  const paidMut = useMutation({ mutationFn: () => markAdminMerchantPayoutPaid(p.id, bankRef.trim()), onSuccess: onDone, onError });
  const cancelMut = useMutation({ mutationFn: () => cancelAdminMerchantPayout(p.id), onSuccess: onDone, onError });
  const busy = paidMut.isPending || cancelMut.isPending;
  const bank = p.bankInfo;
  return (
    <li className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3 text-xs shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-stone-900">{p.storefront?.title ?? p.storefrontId}</span>
        <span className="font-semibold">{signed(p.amount)}</span>
        <ToneBadge tone={p.status === 'PAID' ? 'success' : p.status === 'PENDING' ? 'warning' : 'neutral'}>
          {p.status === 'PAID' ? 'Đã chuyển' : p.status === 'PENDING' ? 'Chờ chuyển' : 'Đã huỷ'}
        </ToneBadge>
        <span className="text-stone-500">
          {p.lines.length} khoản · lập {formatDate(p.createdAt)}
          {p.bankRef ? ` · mã GD ${p.bankRef}` : ''}
        </span>
      </div>
      {p.status === 'PENDING' && (
        <>
          <p className="text-stone-600">
            {p.amount >= 0
              ? bank?.accountNo
                ? `Chuyển vào ${bank.bankName ?? ''} ${bank.accountNo} (${bank.accountName ?? ''})`
                : 'Gian hàng chưa khai tài khoản nhận đối soát: nhắc đối tác khai trước khi chuyển.'
              : 'Số âm: đối tác nộp lại Tubu khoản này.'}
          </p>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              paidMut.mutate();
            }}
          >
            <label className="text-stone-700">
              Mã giao dịch ngân hàng
              <input value={bankRef} onChange={(e) => setBankRef(e.target.value)} required maxLength={100} className={`mt-1 block w-48 ${FIELD_XS}`} />
            </label>
            <button type="submit" disabled={busy} className={BTN_XS_PRIMARY}>
              Đã chuyển
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
