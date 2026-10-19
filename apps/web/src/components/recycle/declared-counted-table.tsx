import type { WasteRequestLineDTO } from '@tubutree/shared-types';
import { formatCount } from '@/lib/checkout-points';
import { SHORTFALL_LABELS } from './recycle-labels';

/** Bảng "đã khai / đã đếm" của yêu cầu, dùng ở trang theo dõi và trang kết quả. Chưa đếm thì cột đếm là "—". */
export function DeclaredCountedTable({ lines }: { lines: readonly WasteRequestLineDTO[] }) {
  return (
    <table aria-label="Đã khai và đã đếm" className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-stone-200">
          <th scope="col" className="px-1 py-2 text-xs font-normal text-stone-600">Món</th>
          <th scope="col" className="px-1 py-2 text-xs font-normal text-stone-600">Đã khai</th>
          <th scope="col" className="px-1 py-2 text-xs font-normal text-stone-600">Đã đếm</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.itemId} className="border-b border-stone-200 align-top">
            <td className="px-1 py-2 text-stone-900">{l.itemName}</td>
            <td className="px-1 py-2 text-stone-900">{`${formatCount(l.declaredQty)} ${l.unitLabel}`}</td>
            <td className="px-1 py-2 text-stone-900">
              {l.receivedQty == null ? '—' : `${formatCount(l.receivedQty)} ${l.unitLabel}`}
              {l.shortfallReason && <div className="text-xs text-stone-600">{SHORTFALL_LABELS[l.shortfallReason]}</div>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
