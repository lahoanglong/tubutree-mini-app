'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMerchantSettlement, type MerchantPayout, type SettlementLine } from '@/lib/merchant-client';
import { formatVnd } from '@/lib/shop-client';
import { formatDate } from '@/lib/format-date';
import { Notice, ScrollRegion, ToneBadge } from '@/components/admin/ui';

const PAYOUT_STATUS: Record<MerchantPayout['status'], { label: string; tone: 'warning' | 'success' | 'neutral' }> = {
  PENDING: { label: 'Chờ chuyển', tone: 'warning' },
  PAID: { label: 'Đã chuyển', tone: 'success' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
};

/** Số tiền có dấu: dương Tubu trả gian hàng, âm gian hàng nộp lại Tubu. */
export function signedVnd(n: number): string {
  return n < 0 ? `−${formatVnd(-n)}` : formatVnd(Math.abs(n));
}

/** Dòng đảo của một lần khách trả một phần đơn đã quyết toán (khác dòng đảo cả đơn). */
export function isPartialReturnLine(l: Pick<SettlementLine, 'kind' | 'refKey'>): boolean {
  return l.kind === 'REVERSAL' && !!l.refKey?.startsWith('RETURN:');
}

export function SettlementTable<L extends SettlementLine>({ lines, label, dateHeader, dateOf }: {
  lines: L[];
  label: string;
  dateHeader: string;
  dateOf: (l: L) => string | null;
}) {
  return (
    <ScrollRegion label={label} className="rounded-card border border-stone-200 bg-stone-0 shadow-card">
      <table className="w-full text-left text-xs">
        <thead className="bg-stone-50 text-stone-500">
          <tr>
            <th className="px-3 py-2 font-medium">Đơn</th>
            <th className="px-3 py-2 font-medium">{dateHeader}</th>
            <th className="px-3 py-2 text-right font-medium">Tiền hàng</th>
            <th className="px-3 py-2 text-right font-medium">Phí giao</th>
            <th className="px-3 py-2 text-right font-medium">Phí sàn</th>
            <th className="px-3 py-2 text-right font-medium">COD bạn đã thu</th>
            <th className="px-3 py-2 text-right font-medium">Thực nhận</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {lines.map((l) => (
            <tr key={`${l.orderId}-${l.kind}-${l.refKey ?? ''}`}>
              <td className="px-3 py-2 font-medium text-stone-900">
                {l.orderCode}
                {l.kind === 'REVERSAL' && (
                  <span className="ml-1 text-danger-fg">{isPartialReturnLine(l) ? '(trả một phần)' : '(trả hàng)'}</span>
                )}
              </td>
              <td className="px-3 py-2 text-stone-600">{formatDate(dateOf(l))}</td>
              <td className="px-3 py-2 text-right">{signedVnd(l.goodsAmount)}</td>
              <td className="px-3 py-2 text-right">{signedVnd(l.shippingFee)}</td>
              <td className="px-3 py-2 text-right">{signedVnd(-l.commissionAmount)}</td>
              <td className="px-3 py-2 text-right">{signedVnd(-l.codCollected)}</td>
              <td className={`px-3 py-2 text-right font-semibold ${l.netAmount < 0 ? 'text-danger-fg' : 'text-forest-700'}`}>{signedVnd(l.netAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

/** "Đối soát" của gian hàng tự giao: đơn đã đủ hạn chờ lập phiếu, đơn sắp đủ hạn và các phiếu Tubu đã lập. */
export function SettlementTab() {
  const q = useQuery({ queryKey: ['merchant-settlement'], queryFn: getMerchantSettlement });
  if (q.isLoading) return <p className="text-sm text-stone-500">Đang tải bảng kê đối soát…</p>;
  if (q.isError || !q.data) return <p className="text-sm text-danger-fg">Không tải được bảng kê đối soát.</p>;
  const s = q.data;

  return (
    <div className="space-y-5">
      <Notice>
        Mỗi đơn bạn tự giao: thực nhận = tiền hàng + phí giao − phí sàn Tubu − tiền COD bạn đã tự thu của khách. Đơn được đưa vào
        bảng kê sau {s.holdDays} ngày kể từ khi giao (hết hạn đổi/trả). Tubu Tree lập phiếu và chuyển khoản vào tài khoản nhận đối
        soát của gian hàng; số âm là phần bạn nộp lại Tubu. Đơn bị trả: Tubu Tree hoàn tiền cho khách, bạn nhận hàng về và nộp
        lại phần đã nhận cho đơn đó; đơn COD là đúng số tiền mặt bạn đã thu. Khách trả một phần đơn đã đối soát: kỳ sau có
        dòng &quot;trả một phần&quot; trừ lại đúng phần hàng trả.
      </Notice>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display font-semibold text-stone-900">Chờ lập phiếu ({s.lines.length} khoản)</h2>
          <p className="text-sm text-stone-700">
            Tổng: <span className={`font-semibold ${s.total < 0 ? 'text-danger-fg' : 'text-forest-700'}`}>{signedVnd(s.total)}</span>
          </p>
        </div>
        {s.lines.length === 0 ? (
          <p className="rounded-card border border-stone-200 bg-stone-0 p-4 text-center text-xs text-stone-500">Chưa có đơn nào đủ hạn đối soát.</p>
        ) : (
          <SettlementTable lines={s.lines} label="Đơn chờ lập phiếu đối soát" dateHeader="Ngày giao" dateOf={(l) => l.deliveredAt} />
        )}
      </section>

      {s.upcoming.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display font-semibold text-stone-900">
            Sắp đủ hạn ({new Set(s.upcoming.map((l) => l.orderId)).size} đơn)
          </h2>
          <SettlementTable
            lines={s.upcoming}
            label="Đơn sắp đủ hạn đối soát"
            dateHeader="Đối soát từ"
            dateOf={(l) => l.availableAt}
          />
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-display font-semibold text-stone-900">Phiếu đối soát</h2>
        {s.payouts.length === 0 ? (
          <p className="rounded-card border border-stone-200 bg-stone-0 p-4 text-center text-xs text-stone-500">Tubu Tree chưa lập phiếu nào cho gian hàng.</p>
        ) : (
          <ul className="space-y-2">
            {s.payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-card border border-stone-200 bg-stone-0 p-3 text-sm shadow-card">
                <span className="font-semibold text-stone-900">{signedVnd(p.amount)}</span>
                <ToneBadge tone={PAYOUT_STATUS[p.status].tone}>{PAYOUT_STATUS[p.status].label}</ToneBadge>
                <span className="text-xs text-stone-500">
                  {p.lines.length} khoản · lập {formatDate(p.createdAt)}
                  {p.paidAt ? ` · chuyển ${formatDate(p.paidAt)}` : ''}
                  {p.bankRef ? ` · mã GD ${p.bankRef}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
