import { REMARKETING_NOTICES, type RemarketingAttributionDTO, type RemarketingAttributionRow, type RemarketingNotice } from '@tubutree/shared-types';
import { formatCount, formatPct, ratioPct } from '@/components/admin/launch-watch-format';
import { ScrollRegion } from '@/components/admin/ui';

export const REMARKETING_LABELS: Record<RemarketingNotice, string> = {
  abandoned_cart: 'Nhắc giỏ bỏ quên',
  winback: 'Mã mời quay lại',
  wishlist_price_drop: 'Giá món Yêu thích giảm',
  refill_21d: 'Nhắc Refill 21 ngày',
  payment_reminder: 'Nhắc chuyển khoản',
};

type Counts = Omit<RemarketingAttributionRow, 'notice'>;

export interface RemarketingTableRow extends Counts {
  key: RemarketingNotice | 'total';
  label: string;
  /** % tin ra đơn; null khi chưa gửi tin nào. */
  ratePct: number | null;
  /** Doanh thu chia số tin ZNS đã tới Zalo; null khi chưa có tin ZNS. */
  revenuePerZns: number | null;
}

const vnd = (n: number): string => `${formatCount(n)}đ`;

function tableRow(key: RemarketingTableRow['key'], label: string, r: Counts): RemarketingTableRow {
  return {
    key,
    label,
    sent: r.sent,
    znsSent: r.znsSent,
    znsCapped: r.znsCapped,
    orders: r.orders,
    revenue: r.revenue,
    ratePct: ratioPct(r.orders, r.sent),
    revenuePerZns: r.znsSent > 0 ? Math.round(r.revenue / r.znsSent) : null,
  };
}

/** Dòng theo thứ tự REMARKETING_NOTICES (loại API chưa trả là dòng 0) và dòng tổng; mỗi đơn chỉ gán một tin nên cộng được. */
export function remarketingTable(data: RemarketingAttributionDTO): { rows: RemarketingTableRow[]; total: RemarketingTableRow } {
  const byNotice = new Map(data.rows.map((r) => [r.notice, r]));
  const zero: Counts = { sent: 0, znsSent: 0, znsCapped: 0, orders: 0, revenue: 0 };
  const rows = REMARKETING_NOTICES.map((n) => tableRow(n, REMARKETING_LABELS[n], byNotice.get(n) ?? zero));
  const sum = rows.reduce<Counts>(
    (s, r) => ({ sent: s.sent + r.sent, znsSent: s.znsSent + r.znsSent, znsCapped: s.znsCapped + r.znsCapped, orders: s.orders + r.orders, revenue: s.revenue + r.revenue }),
    zero,
  );
  return { rows, total: tableRow('total', 'Tổng', sum) };
}

export function capLine(cap: RemarketingAttributionDTO['proactiveCap']): string {
  if (!cap) return 'Trần tin chủ động ngoài app đang tắt (Cấu hình: notify.proactive_cap_enabled).';
  return `Trần tin chủ động ngoài app: tối đa ${formatCount(cap.perDay)} tin/ngày và ${formatCount(cap.perWeek)} tin/7 ngày mỗi khách. Loại tin ra đơn tốt mà nhiều ZNS bị trần thì cân nhắc nới trần.`;
}

function Cells({ r }: { r: RemarketingTableRow }) {
  return (
    <>
      <td className="px-2 text-right">{formatCount(r.sent)}</td>
      <td className="px-2 text-right">
        {formatCount(r.znsSent)}
        {r.znsCapped > 0 && <span className="block text-xs font-normal text-stone-500">{formatCount(r.znsCapped)} bị trần</span>}
      </td>
      <td className="px-2 text-right">{formatCount(r.orders)}</td>
      <td className="px-2 text-right">{formatPct(r.ratePct)}</td>
      <td className="px-2 text-right">{vnd(r.revenue)}</td>
      <td className="pl-2 text-right">{r.revenuePerZns === null ? '—' : vnd(r.revenuePerZns)}</td>
    </>
  );
}

/** "Tin nào ra đơn": đơn và doanh thu gán cho từng loại tin nhắc chủ động trong kỳ, để chỉnh trần tin chủ động và xét ZNS trả phí có đáng không. */
export function RemarketingAttribution({ data }: { data: RemarketingAttributionDTO | null }) {
  const hours = data?.windowHours ?? 72;
  const table = data ? remarketingTable(data) : null;
  return (
    <section aria-labelledby="growth-remarketing" data-remarketing className="rounded-card border border-stone-200 p-3">
      <h3 id="growth-remarketing" className="text-sm font-semibold text-stone-900">Tin nào ra đơn</h3>
      <p className="mt-0.5 text-xs text-stone-600">
        Đơn thành công đặt trong {hours} giờ sau tin nhắc được gán cho tin gần nhất trước lúc đặt, mỗi đơn một tin. Nhắc chuyển khoản: đơn được trả tiền trong {hours} giờ sau tin.
      </p>
      {!data || !table ? (
        <p data-remarketing-error className="mt-2 text-sm text-stone-600">Chưa đọc được số liệu tin nhắc lần này. Các số khác trên trang vẫn đúng; tải lại sau ít phút.</p>
      ) : (
        <>
          <ScrollRegion label="Đơn theo loại tin nhắc">
            <table className="mt-2 w-full min-w-[640px] text-sm tabular-nums">
              <thead>
                <tr className="text-left text-stone-500">
                  <th scope="col" className="py-1 pr-2 font-medium">Loại tin</th>
                  <th scope="col" className="px-2 text-right font-medium">Đã gửi</th>
                  <th scope="col" className="px-2 text-right font-medium">Qua ZNS</th>
                  <th scope="col" className="px-2 text-right font-medium">Ra đơn</th>
                  <th scope="col" className="px-2 text-right font-medium">Tỷ lệ</th>
                  <th scope="col" className="px-2 text-right font-medium">Doanh thu</th>
                  <th scope="col" className="pl-2 text-right font-medium">Doanh thu / tin ZNS</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <tr key={r.key} data-remarketing-row={r.key} className="border-t border-stone-200 align-top">
                    <th scope="row" className="py-2 pr-2 text-left font-normal text-stone-900">{r.label}</th>
                    <Cells r={r} />
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr data-remarketing-row="total" className="border-t-2 border-stone-300 align-top font-semibold text-stone-900">
                  <th scope="row" className="py-2 pr-2 text-left">{table.total.label}</th>
                  <Cells r={table.total} />
                </tr>
              </tfoot>
            </table>
          </ScrollRegion>
          <p data-remarketing-cap className="mt-2 text-xs text-stone-600">{capLine(data.proactiveCap)}</p>
          <p className="mt-1 text-xs text-stone-600">
            Doanh thu tính như báo cáo Doanh thu, nên đơn COD chưa giao chưa vào số. &quot;Doanh thu / tin ZNS&quot; là mức trần vì khách có thể mua nhờ tin trong app; so với giá một tin ZNS để biết kênh trả phí có đáng không. Tin gửi trong {hours} giờ gần nhất chưa hết thời gian chờ nên tỷ lệ của kỳ còn tăng.
          </p>
        </>
      )}
    </section>
  );
}
