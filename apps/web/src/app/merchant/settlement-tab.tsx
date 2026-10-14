'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMerchantSettlement, type MerchantPayout, type MerchantSettlement, type SettlementLine, type TubuFulfilledSales } from '@/lib/merchant-client';
import { payoutStatus, payoutToTubu } from '@/lib/merchant-payout';
import { formatVnd } from '@/lib/shop-client';
import { formatDate } from '@/lib/format-date';
import { Notice, ScrollRegion, ToneBadge } from '@/components/admin/ui';

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
        bảng kê sau {s.holdDays} ngày kể từ khi giao (hết hạn đổi/trả). Phiếu dương: Tubu Tree chuyển khoản vào tài khoản nhận
        đối soát của gian hàng. Phiếu âm (hay gặp với đơn COD vì bạn đã giữ tiền mặt của khách): bạn nộp phần phí sàn cho Tubu
        trong {s.negativeDueDays ?? 7} ngày kể từ khi lập phiếu. Đơn bị trả: Tubu Tree hoàn tiền cho khách, bạn nhận hàng về và nộp
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
              <PayoutItem key={p.id} payout={p} tubuAccount={s.tubuAccount ?? null} />
            ))}
          </ul>
        )}
      </section>

      {s.tubuFulfilled && s.tubuFulfilled.lines.length > 0 && <TubuFulfilledSection sales={s.tubuFulfilled} />}
    </div>
  );
}

function PayoutItem({ payout: p, tubuAccount }: { payout: MerchantPayout; tubuAccount: MerchantSettlement['tubuAccount'] }) {
  const toTubu = payoutToTubu(p);
  const status = payoutStatus(p);
  const owe = toTubu && p.status === 'PENDING';
  const amount = toTubu
    ? `${p.status === 'PAID' ? 'Đã nộp' : 'Bạn cần nộp'} ${formatVnd(-p.amount)}`
    : `${p.status === 'PAID' ? 'Tubu đã chuyển' : 'Tubu sẽ chuyển'} ${formatVnd(p.amount)}`;
  return (
    <li
      aria-label={`Phiếu ${p.transferMemo ?? p.id}`}
      className={`space-y-2 rounded-card border bg-stone-0 p-3 text-sm shadow-card ${owe ? 'border-warning-fg' : 'border-stone-200'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`font-semibold ${toTubu ? 'text-danger-fg' : 'text-stone-900'}`}>{amount}</span>
        <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
        <span className="text-xs text-stone-500">
          lập {formatDate(p.createdAt)}
          {p.paidAt ? ` · ${toTubu ? 'thu' : 'chuyển'} ${formatDate(p.paidAt)}` : ''}
          {p.bankRef ? ` · mã GD ${p.bankRef}` : ''}
        </span>
      </div>
      {owe && (
        <div className="space-y-0.5 rounded-control bg-warning-bg px-3 py-2 text-xs text-warning-fg">
          <p>
            Chuyển vào tài khoản Tubu Tree:{' '}
            <span className="font-semibold">
              {tubuAccount ? `${tubuAccount.bankName} · ${tubuAccount.accountNo} · ${tubuAccount.accountName}` : 'liên hệ Tubu Tree để nhận số tài khoản'}
            </span>
          </p>
          {p.transferMemo && (
            <p>
              Nội dung chuyển khoản: <span className="font-semibold">{p.transferMemo}</span>
            </p>
          )}
          {p.dueAt && <p>Hạn nộp {formatDate(p.dueAt)}</p>}
        </div>
      )}
      {p.lines.length > 0 && (
        <details className="text-xs">
          <summary className="flex min-h-[44px] cursor-pointer items-center font-medium text-forest-700 sm:min-h-6">Xem {p.lines.length} khoản</summary>
          <div className="mt-2">
            <SettlementTable lines={p.lines} label={`Các khoản của phiếu lập ${formatDate(p.createdAt)}`} dateHeader="Vào phiếu" dateOf={(l) => l.createdAt ?? l.deliveredAt} />
          </div>
        </details>
      )}
    </li>
  );
}

/** Hàng "Tubu giao hộ" (R2-MERCHANT-2): kho Tubu giao và thu tiền, đối chiếu theo thoả thuận ký gửi chứ không qua phiếu. */
function TubuFulfilledSection({ sales }: { sales: TubuFulfilledSales }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display font-semibold text-stone-900">Hàng Tubu giao hộ đã bán (90 ngày)</h2>
        <p className="text-sm text-stone-700">
          Tiền hàng: <span className="font-semibold">{formatVnd(sales.goods)}</span>
        </p>
      </div>
      <p className="text-xs text-stone-500">
        Kho Tubu Tree giao và thu tiền nên các đơn này không vào phiếu đối soát. Tiền hàng được thanh toán theo thoả thuận ký gửi
        với Tubu Tree; bảng này để bạn đối chiếu.
      </p>
      <ScrollRegion label="Hàng Tubu giao hộ đã bán" className="rounded-card border border-stone-200 bg-stone-0 shadow-card">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="bg-stone-50 text-stone-500">
            <tr>
              <th className="px-3 py-2 font-medium">Đơn</th>
              <th className="px-3 py-2 font-medium">Ngày giao</th>
              <th className="px-3 py-2 font-medium">Sản phẩm</th>
              <th className="px-3 py-2 text-right font-medium">SL</th>
              <th className="px-3 py-2 text-right font-medium">Tiền hàng</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {sales.lines.map((l, i) => (
              <tr key={`${l.orderCode}-${i}`}>
                <td className="px-3 py-2 font-medium text-stone-900">{l.orderCode}</td>
                <td className="px-3 py-2 text-stone-600">{formatDate(l.deliveredAt)}</td>
                <td className="px-3 py-2 text-stone-700">
                  {l.productName}
                  {l.variationName ? ` (${l.variationName})` : ''}
                </td>
                <td className="px-3 py-2 text-right">{l.quantity}</td>
                <td className="px-3 py-2 text-right">{formatVnd(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </section>
  );
}
