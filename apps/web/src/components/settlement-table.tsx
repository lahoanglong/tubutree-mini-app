import type { ConsignmentTerms, SettlementLine } from '@/lib/merchant-client';
import { formatVnd } from '@/lib/shop-client';
import { formatDate } from '@/lib/format-date';
import { ScrollRegion, ToneBadge } from '@/components/admin/ui';

/** Số tiền có dấu: dương Tubu trả gian hàng, âm gian hàng nộp lại Tubu. */
export function signedVnd(n: number): string {
  return n < 0 ? `−${formatVnd(-n)}` : formatVnd(Math.abs(n));
}

/** Dòng đảo của một lần khách trả một phần đơn đã quyết toán (khác dòng đảo cả đơn). */
export function isPartialReturnLine(l: Pick<SettlementLine, 'kind' | 'refKey'>): boolean {
  return l.kind === 'REVERSAL' && !!l.refKey?.startsWith('RETURN:');
}

/** Khoản của một dòng hàng "Tubu giao hộ" (kho Tubu giao, tiền khách về Tubu). */
export function isConsignmentLine(l: Pick<SettlementLine, 'orderItemId' | 'refKey'>): boolean {
  return !!l.orderItemId || !!l.refKey?.includes('ITEM:');
}

/** 0.1 → "10%", 0.025 → "2,5%". */
export function formatPct(fraction: number): string {
  return `${(fraction * 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`;
}

/** "phí sàn 10% − phí Tubu giao hộ 2% + 3.400đ mỗi đơn" — phần phí trong công thức của hàng giao hộ. */
export function consignmentFeesText(t: ConsignmentTerms): string {
  const ops = [t.feePct > 0 ? formatPct(t.feePct) : null, t.feeFixed > 0 ? `${formatVnd(t.feeFixed)} mỗi đơn` : null].filter(Boolean);
  return `phí sàn ${formatPct(t.commissionPct)}${ops.length ? ` − phí Tubu giao hộ ${ops.join(' + ')}` : ''}`;
}

const dash = <span className="text-stone-400">—</span>;

/**
 * Bảng các khoản đối soát (bảng kê, sắp đủ hạn, khoản của một phiếu). Khoản hàng "Tubu giao hộ" ghi nhãn, tên món và cột phí
 * giao hộ; phí giao và COD không áp cho hàng giao hộ nên để trống. `viewer` đổi cách gọi tiền COD theo người xem.
 */
export function SettlementTable<L extends SettlementLine>({
  lines,
  label,
  dateHeader,
  dateOf,
  viewer = 'merchant',
}: {
  lines: L[];
  label: string;
  dateHeader: string;
  dateOf: (l: L) => string | null | undefined;
  viewer?: 'merchant' | 'admin';
}) {
  const hasConsignment = lines.some(isConsignmentLine);
  return (
    <ScrollRegion label={label} className="rounded-card border border-stone-200 bg-stone-0 shadow-card">
      <table className={`w-full text-left text-xs ${hasConsignment ? 'min-w-[720px]' : ''}`}>
        <thead className="bg-stone-50 text-stone-500">
          <tr>
            <th className="px-3 py-2 font-medium">Đơn</th>
            <th className="px-3 py-2 font-medium">{dateHeader}</th>
            <th className="px-3 py-2 text-right font-medium">Tiền hàng</th>
            <th className="px-3 py-2 text-right font-medium">Phí giao</th>
            <th className="px-3 py-2 text-right font-medium">Phí sàn</th>
            {hasConsignment && <th className="px-3 py-2 text-right font-medium">Phí giao hộ</th>}
            <th className="px-3 py-2 text-right font-medium">{viewer === 'admin' ? 'COD gian hàng đã thu' : 'COD bạn đã thu'}</th>
            <th className="px-3 py-2 text-right font-medium">Thực nhận</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {lines.map((l) => {
            const consignment = isConsignmentLine(l);
            return (
              <tr key={`${l.orderId}-${l.kind}-${l.refKey ?? ''}`}>
                <td className="px-3 py-2 text-stone-900">
                  <span className="font-medium">{l.orderCode}</span>
                  {l.kind === 'REVERSAL' && (
                    <span className="ml-1 text-danger-fg">{isPartialReturnLine(l) ? '(trả một phần)' : '(trả hàng)'}</span>
                  )}
                  {consignment && (
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-stone-600">
                      <ToneBadge tone="info">Tubu giao hộ</ToneBadge>
                      {l.item && (
                        <span>
                          {l.item.productName}
                          {l.item.variationName ? ` (${l.item.variationName})` : ''} × {l.item.quantity}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-stone-600">{formatDate(dateOf(l) ?? null)}</td>
                <td className="px-3 py-2 text-right">{signedVnd(l.goodsAmount)}</td>
                <td className="px-3 py-2 text-right">{consignment ? dash : signedVnd(l.shippingFee)}</td>
                <td className="px-3 py-2 text-right">{signedVnd(-l.commissionAmount)}</td>
                {hasConsignment && <td className="px-3 py-2 text-right">{consignment ? signedVnd(-(l.opsFeeAmount ?? 0)) : dash}</td>}
                <td className="px-3 py-2 text-right">{consignment ? dash : signedVnd(-l.codCollected)}</td>
                <td className={`px-3 py-2 text-right font-semibold ${l.netAmount < 0 ? 'text-danger-fg' : 'text-forest-700'}`}>{signedVnd(l.netAmount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
