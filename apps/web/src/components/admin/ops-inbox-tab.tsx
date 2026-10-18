'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronRight, CircleCheck } from 'lucide-react';
import { getOpsInbox, type InboxKey } from '@/lib/admin-client';
import { formatDateTime } from '@/lib/format-date';

export const INBOX_LABELS: Record<InboxKey, { title: string; hint: string }> = {
  pancakeAttention: { title: 'Cần xử lý Pancake', hint: 'Pancake báo việc hệ thống không tự làm được' },
  pancakeUnsynced: { title: 'Đơn chưa lên Pancake', hint: 'Đơn còn ở kho mà kho Pancake chưa có' },
  gomdonAttention: { title: 'Cần xử lý thu gom', hint: 'Vận đơn Gomdon lỗi / hoàn / huỷ không được' },
  customerRefunds: { title: 'Hoàn tiền khách', hint: 'Chờ đối soát, chờ chuyển khoản hoặc đang chuyển khoản' },
  returnsPending: { title: 'Yêu cầu đổi / trả chờ duyệt', hint: 'Khách gửi, chưa ai duyệt' },
  returnsToReceive: { title: 'Hàng trả chờ nhận về kho', hint: 'Đã duyệt, kho chưa bấm "Đã nhận hàng"' },
  merchantOverdue: { title: 'Đơn đối tác quá hạn giao', hint: 'Gian hàng tự giao quá hạn xác nhận / gửi / giao' },
  merchantProducts: { title: 'Sản phẩm đối tác chờ duyệt', hint: 'Gian hàng gửi sản phẩm mới hoặc sửa' },
  consignmentPending: { title: 'Liên kết ký gửi chờ xác nhận', hint: 'Đối tác nhận lại hàng Tubu đang bán: chưa xác nhận thì đơn không vào đối soát' },
  merchantToSettle: { title: 'Gian hàng có khoản chờ lập phiếu', hint: 'Đơn đối tác đã hết hạn giữ tiền, chờ lập phiếu đối soát' },
  merchantPayoutsPending: { title: 'Phiếu đối soát chờ chuyển / thu', hint: 'Chờ chuyển cho đối tác hoặc chờ đối tác nộp lại' },
  dealerApplications: { title: 'Hồ sơ đại lý chờ duyệt', hint: 'Đăng ký đại lý mới' },
  dealerClaims: { title: 'Thưởng đại lý chờ duyệt', hint: 'Đại lý đã đạt mốc, chờ xác nhận' },
  payouts: { title: 'Lệnh rút tiền chờ duyệt', hint: 'Hoa hồng CTV / Ví' },
  wasteToCount: { title: 'Kiện đổi rác chờ đếm', hint: 'Kiện gửi kho hoặc thu kèm đơn đã nhận, chưa đếm' },
  wasteUnmatched: { title: 'Kiện không rõ chủ', hint: 'Kiện về kho chưa khớp yêu cầu nào' },
  wasteBlockedPending: { title: 'Yêu cầu đổi rác của khách bị khoá', hint: 'Yêu cầu đang mở, đang gửi hoặc kho đã nhận của khách bị khoá' },
  wastePointsPending: { title: 'Điểm nhận chờ duyệt', hint: 'Đại lý đã đăng ký, chưa kích hoạt' },
  wastePerksPending: { title: 'Ưu đãi riêng chờ duyệt', hint: 'Chủ điểm gửi nội dung ưu đãi mới' },
  wasteTransitOverdue: { title: 'Kiện gửi kho quá hạn xem lại', hint: 'Đang trên đường quá số ngày cấu hình, chưa tự đóng' },
  wasteGiftOverdue: { title: 'Quà quá hạn nhận', hint: 'Quà chờ nhận đã quá hạn, chờ admin xử lý' },
  wasteOrderMismatch: { title: 'Thu kèm đơn lệch với đơn', hint: 'Yêu cầu thu kèm có trạng thái mâu thuẫn với đơn gắn kèm' },
  communityPending: { title: 'Bài cộng đồng chờ duyệt', hint: 'Khách vừa đăng, chưa ai duyệt' },
  communityUnanswered: { title: 'Câu hỏi cộng đồng chưa ai trả lời', hint: 'Đã chờ quá lâu mà chưa có câu trả lời' },
  invoicePending: { title: 'Hoá đơn VAT chờ xuất', hint: 'Khách yêu cầu xuất hoá đơn, chưa phát hành' },
  externalPoints: { title: 'Tích điểm đơn sàn cần xử lý', hint: 'Yêu cầu cần duyệt, mã chưa ghép được đơn, đơn đã cộng điểm bị hoàn một phần hoặc đã đóng' },
};

/** Trang chủ quản trị: mỗi hàng đợi một thẻ có số việc đang chờ, bấm vào mở đúng tab/bộ lọc. */
export function OpsInboxTab({ onOpen }: { onOpen: (key: InboxKey) => void }) {
  const q = useQuery({ queryKey: ['admin-ops-inbox'], queryFn: getOpsInbox, refetchInterval: 60_000 });
  if (q.isLoading) return <p className="text-sm text-stone-500">Đang đếm việc cần xử lý…</p>;
  if (q.isError || !q.data) return <p className="text-sm text-danger-fg">Không tải được danh sách việc cần xử lý.</p>;
  // API mới hơn web (đang triển khai dở) có thể trả khoá web chưa biết: bỏ qua thay vì làm sập cả trang chủ.
  const items = q.data.items.filter((i) => i.key in INBOX_LABELS);
  const open = items.filter((i) => i.count > 0);
  const done = items.filter((i) => i.count === 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-stone-900">Việc cần xử lý</h2>
        <span className="text-xs text-stone-500">Cập nhật {formatDateTime(q.data.generatedAt)} · tự làm mới mỗi phút</span>
      </div>
      {open.length === 0 && (
        <p className="flex items-center gap-2 rounded-card border border-success-fg bg-success-bg px-4 py-3 text-sm text-success-fg">
          <CircleCheck aria-hidden="true" className="h-4 w-4 shrink-0" />
          Không còn việc nào đang chờ.
        </p>
      )}
      {open.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {open.map((i) => (
            <li key={i.key}>
              <InboxCard k={i.key} count={i.count} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">Đang trống</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {done.map((i) => (
              <li key={i.key}>
                <button
                  type="button"
                  onClick={() => onOpen(i.key)}
                  className="min-h-[44px] rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-600 hover:bg-stone-200 sm:min-h-[32px]"
                >
                  {INBOX_LABELS[i.key].title} · 0
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function InboxCard({ k, count, onOpen }: { k: InboxKey; count: number; onOpen: (key: InboxKey) => void }) {
  const l = INBOX_LABELS[k];
  return (
    <button
      type="button"
      data-inbox={k}
      onClick={() => onOpen(k)}
      className="flex min-h-[44px] w-full items-center gap-3 rounded-card border border-warning-fg bg-stone-0 p-4 text-left shadow-card hover:bg-warning-bg"
    >
      <span className="min-w-[3ch] text-2xl font-bold text-warning-fg">{count}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-stone-900">{l.title}</span>
        <span className="block text-xs text-stone-500">{l.hint}</span>
      </span>
      <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-stone-500" />
    </button>
  );
}
