'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronRight, CircleCheck } from 'lucide-react';
import { getOpsInbox, type InboxKey } from '@/lib/admin-client';
import { formatDateTime } from '@/lib/format-date';

export const INBOX_LABELS: Record<InboxKey, { title: string; hint: string }> = {
  pancakeAttention: { title: 'Cần xử lý Pancake', hint: 'Pancake báo việc hệ thống không tự làm được' },
  pancakeUnsynced: { title: 'Đơn chưa lên Pancake', hint: 'Đơn còn ở kho mà kho Pancake chưa có' },
  gomdonAttention: { title: 'Cần xử lý thu gom', hint: 'Vận đơn Gomdon lỗi / hoàn / huỷ không được' },
  customerRefunds: { title: 'Hoàn tiền khách', hint: 'Khoản chờ đối soát hoặc chờ chuyển khoản' },
  returnsPending: { title: 'Yêu cầu đổi / trả chờ duyệt', hint: 'Khách gửi, chưa ai duyệt' },
  returnsToReceive: { title: 'Hàng trả chờ nhận về kho', hint: 'Đã duyệt, kho chưa bấm "Đã nhận hàng"' },
  merchantOverdue: { title: 'Đơn đối tác quá hạn giao', hint: 'Gian hàng tự giao quá hạn xác nhận / gửi / giao' },
  merchantProducts: { title: 'Sản phẩm đối tác chờ duyệt', hint: 'Gian hàng gửi sản phẩm mới hoặc sửa' },
  dealerApplications: { title: 'Hồ sơ đại lý chờ duyệt', hint: 'Đăng ký đại lý mới' },
  dealerClaims: { title: 'Thưởng đại lý chờ duyệt', hint: 'Đại lý đã đạt mốc, chờ xác nhận' },
  payouts: { title: 'Lệnh rút tiền chờ duyệt', hint: 'Hoa hồng CTV / Ví' },
  refillPending: { title: 'Đổi vỏ chai chờ duyệt', hint: 'Khách mang vỏ tới điểm nhận' },
};

/** Trang chủ quản trị: mỗi hàng đợi một thẻ có số việc đang chờ, bấm vào mở đúng tab/bộ lọc. */
export function OpsInboxTab({ onOpen }: { onOpen: (key: InboxKey) => void }) {
  const q = useQuery({ queryKey: ['admin-ops-inbox'], queryFn: getOpsInbox, refetchInterval: 60_000 });
  if (q.isLoading) return <p className="text-sm text-stone-500">Đang đếm việc cần xử lý…</p>;
  if (q.isError || !q.data) return <p className="text-sm text-danger-fg">Không tải được danh sách việc cần xử lý.</p>;
  const items = q.data.items;
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
