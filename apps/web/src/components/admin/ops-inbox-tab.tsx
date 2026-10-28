'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, CircleCheck } from 'lucide-react';
import { getOpsInbox, getRetentionDaily, getTodaySummary, type AdminPayoutStatus, type DealerRewardClaimStatus, type InboxKey, type TodaySummary } from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import { summarizeNs1 } from './ns1-card';
import { formatDateTime } from '@/lib/format-date';
import { seedDealerClaimFilter } from './dealer-claims-tab';
import { seedPayoutFilter } from './payout-admin-tab';
import { LoadError } from './ui';

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
  dealerClaimsToPay: { title: 'Thưởng đại lý chờ chi', hint: 'Admin đã duyệt, chờ kế toán trao thưởng và bấm "Đã chi"' },
  payouts: { title: 'Lệnh rút ngân hàng cũ chờ duyệt', hint: 'Lệnh tạo trước khi bỏ rút tiền' },
  payoutsToPay: { title: 'Lệnh rút ngân hàng cũ chờ chi', hint: 'Admin đã duyệt, chờ kế toán chuyển khoản và bấm "Đã chi"' },
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
  supportChatUnforwarded: { title: 'Chat CSKH: tin chưa chuyển được vào Zalo', hint: 'Tin khách chuyển lỗi, không rõ kết quả hoặc chờ quá lâu' },
  zaloBridgeDown: { title: 'Cầu nối Zalo mất kết nối', hint: 'Cầu nối không ở trạng thái đang kết nối quá 10 phút, tin khách chưa vào nhóm Zalo' },
  bankTransferToConfirm: { title: 'Đơn chuyển khoản chờ xác nhận tiền', hint: 'Kiểm tra tiền đã về chưa rồi bấm "Đã nhận tiền". Để quá hạn thì đơn tự huỷ' },
  storefrontsPending: { title: 'Gian hàng chờ duyệt', hint: 'CTV được hẹn duyệt trong 1 ngày làm việc' },
  communityReports: { title: 'Báo cáo vi phạm cộng đồng', hint: 'Khách báo bài hoặc bình luận, chưa ai xem' },
  productsMissingImage: { title: 'Sản phẩm đang bán thiếu ảnh', hint: 'Khách không thấy hình, khó chốt đơn' },
  externalPoints: { title: 'Tích điểm đơn sàn cần xử lý', hint: 'Yêu cầu cần duyệt, mã chưa ghép được đơn, đơn đã cộng điểm bị hoàn một phần hoặc đã đóng' },
};

/** Hai thẻ lệnh rút cũ cùng mở tab "Thuế TNCN hoa hồng": mỗi thẻ phải mở đúng hàng nó đếm, ADMIN mặc định đứng ở hàng chờ duyệt. */
const PAYOUT_FILTER: Partial<Record<InboxKey, AdminPayoutStatus>> = { payouts: 'REQUESTED', payoutsToPay: 'APPROVED' };
const LEGACY_ONLY: ReadonlySet<InboxKey> = new Set<InboxKey>(['payouts', 'payoutsToPay']);
/** Cùng lý do với hai thẻ thưởng đại lý: thẻ chờ chi phải mở hàng đã duyệt, không phải hàng chờ duyệt. */
const CLAIM_FILTER: Partial<Record<InboxKey, DealerRewardClaimStatus>> = { dealerClaims: 'PENDING', dealerClaimsToPay: 'APPROVED' };

/**
 * Mục menu mà mỗi hàng đợi dẫn tới (cùng đích với `openInbox` của trang admin), để menu hiện số việc chờ cạnh từng mục.
 * `customerRefunds` đã có huy hiệu riêng nên không nằm ở đây.
 */
const INBOX_TAB: Partial<Record<InboxKey, string>> = {
  pancakeAttention: 'orders', pancakeUnsynced: 'orders', gomdonAttention: 'orders', invoicePending: 'orders', bankTransferToConfirm: 'orders',
  returnsPending: 'returns', returnsToReceive: 'returns',
  merchantOverdue: 'merchantFulfilment', merchantToSettle: 'merchantFulfilment', merchantPayoutsPending: 'merchantFulfilment',
  merchantProducts: 'merchantProducts', consignmentPending: 'merchantProducts',
  dealerApplications: 'dealers', dealerClaims: 'dealerClaims', dealerClaimsToPay: 'dealerClaims', payouts: 'payouts', payoutsToPay: 'payouts',
  communityPending: 'community', communityUnanswered: 'community', communityReports: 'community',
  externalPoints: 'externalClaims', supportChatUnforwarded: 'supportChat', zaloBridgeDown: 'supportChat',
  wasteToCount: 'waste', wasteUnmatched: 'waste', wasteBlockedPending: 'waste', wastePointsPending: 'waste', wastePerksPending: 'waste',
  wasteTransitOverdue: 'waste', wasteGiftOverdue: 'waste', wasteOrderMismatch: 'waste',
  storefrontsPending: 'storefronts', productsMissingImage: 'productCategories',
};

const QUALITY_KEYS: ReadonlySet<InboxKey> = new Set<InboxKey>(['productsMissingImage']);

/** Số việc chờ cạnh mục menu, lấy từ cùng truy vấn với trang "Hôm nay" (một request cho mọi mục). Mục `inbox` hiện tổng. */
export function InboxBadge({ tab, enabled = true }: { tab: string; enabled?: boolean }) {
  // Route hộp việc chỉ mở cho vài nhóm nhân viên; vai trò khác không gọi để khỏi nhận 403 mỗi phút.
  const q = useQuery({ queryKey: ['admin-ops-inbox'], queryFn: getOpsInbox, refetchInterval: 60_000, enabled });
  const items = (q.data?.items ?? []).filter((i) => i.key in INBOX_LABELS && !LEGACY_ONLY.has(i.key));
  // Hàng đợi chất lượng danh mục (hàng chục sản phẩm thiếu ảnh) hiện ở mục Sản phẩm, không cộng vào tổng để việc gấp trong ngày không bị chìm.
  const n = items.filter((i) => (tab === 'inbox' ? !QUALITY_KEYS.has(i.key) : INBOX_TAB[i.key] === tab)).reduce((sum, i) => sum + i.count, 0);
  if (n <= 0) return null;
  return (
    <span data-inbox-badge={tab} className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-warning-bg px-1.5 text-[11px] font-semibold leading-5 text-warning-fg">
      <span className="sr-only">, </span>
      {n > 99 ? '99+' : n}
      <span className="sr-only"> việc đang chờ</span>
    </span>
  );
}

/** Trang chủ quản trị "Hôm nay": số bán hàng trong ngày (chỉ ADMIN), rồi các việc đang chờ; hàng đợi rỗng gom một dòng. */
export function OpsInboxTab({ onOpen: openTab, isAdmin = false }: { onOpen: (key: InboxKey) => void; isAdmin?: boolean }) {
  const onOpen = (key: InboxKey) => {
    seedPayoutFilter(PAYOUT_FILTER[key] ?? null);
    seedDealerClaimFilter(CLAIM_FILTER[key] ?? null);
    openTab(key);
  };
  const [showEmpty, setShowEmpty] = useState(false);
  const q = useQuery({ queryKey: ['admin-ops-inbox'], queryFn: getOpsInbox, refetchInterval: 60_000 });
  if (q.isLoading) return <InboxSkeleton isAdmin={isAdmin} />;
  if (q.isError || !q.data) return <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>Không tải được danh sách việc cần xử lý.</LoadError>;
  // API mới hơn web (đang triển khai dở) có thể trả khoá web chưa biết: bỏ qua thay vì làm sập cả trang chủ.
  const items = q.data.items.filter((i) => i.key in INBOX_LABELS);
  const open = items.filter((i) => i.count > 0);
  // Rút ngân hàng đã bỏ: hai thẻ lệnh rút cũ chỉ hiện khi còn lệnh đang mở, không nằm trong danh sách "Đang trống".
  const done = items.filter((i) => i.count === 0 && !LEGACY_ONLY.has(i.key));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-stone-900">Hôm nay</h2>
        <span className="text-xs text-stone-500">Cập nhật {formatDateTime(q.data.generatedAt)} · tự làm mới mỗi phút</span>
      </div>
      {isAdmin && <TodayStats />}
      <h3 className="text-sm font-semibold text-stone-900">Việc đang chờ{open.length > 0 ? ` (${open.length})` : ''}</h3>
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
              <InboxCard k={i.key} count={i.count} hoursLeft={i.hoursLeft} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={showEmpty}
            onClick={() => setShowEmpty((v) => !v)}
            className="flex min-h-[44px] items-center gap-1 text-sm text-stone-600 hover:text-stone-900 sm:min-h-[32px]"
          >
            <ChevronRight aria-hidden="true" className={`h-4 w-4 transition-transform ${showEmpty ? 'rotate-90' : ''}`} />
            {done.length} hàng đợi đang trống
          </button>
          {showEmpty && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {done.map((i) => (
                <li key={i.key}>
                  <button
                    type="button"
                    onClick={() => onOpen(i.key)}
                    className="min-h-[44px] rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-600 hover:bg-stone-200 sm:min-h-[32px]"
                  >
                    {INBOX_LABELS[i.key].title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const pulse = 'animate-pulse rounded-card bg-stone-100';
function InboxSkeleton({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="space-y-4" aria-busy="true" role="status" aria-label="Đang đếm việc cần xử lý">
      <div className="h-6 w-24 animate-pulse rounded bg-stone-100" />
      {isAdmin && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((n) => <div key={n} className={`${pulse} h-20`} />)}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((n) => <div key={n} className={`${pulse} h-[74px]`} />)}
      </div>
    </div>
  );
}

/** "+3 so với hôm qua": so số hôm nay với hôm qua; bằng nhau hoặc cả hai bằng 0 thì chỉ nói hôm qua. */
function vsYesterday(today: number, yesterday: number, fmt: (n: number) => string): string {
  if (today === yesterday) return `Bằng hôm qua (${fmt(yesterday)})`;
  return `${today > yesterday ? '+' : '−'}${fmt(Math.abs(today - yesterday))} so với hôm qua`;
}

function TodayStat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'up' | 'down' | 'flat' }) {
  return (
    <div role="group" aria-label={label} className="rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
      <div className="text-xs text-stone-600">{label}</div>
      <div className="mt-0.5 text-xl font-bold text-stone-900">{value}</div>
      <div className={`mt-0.5 text-[11px] ${tone === 'up' ? 'text-success-fg' : tone === 'down' ? 'text-danger-fg' : 'text-stone-500'}`}>{sub}</div>
    </div>
  );
}

const toneOf = (a: number, b: number) => (a > b ? 'up' : a < b ? 'down' : 'flat');

/** Bốn số của ngày: doanh thu đã thu, đơn, khách mới (tài khoản thật) và tỉ lệ khách mua lại trong 30 ngày (NS-1). Mỗi số lỗi thì chỉ nó vắng, không kéo sập cả trang. */
function TodayStats() {
  const today = useQuery({ queryKey: ['admin-today-summary'], queryFn: getTodaySummary, refetchInterval: 60_000 });
  const retention = useQuery({ queryKey: ['admin-analytics-retention'], queryFn: () => getRetentionDaily(30), staleTime: 5 * 60_000 });
  const t: TodaySummary | undefined = today.data;
  const ns1 = retention.data ? summarizeNs1(retention.data) : null;
  if (today.isLoading) return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">{[0, 1, 2, 3].map((n) => <div key={n} className={`${pulse} h-20`} />)}</div>;
  return (
    <section aria-label="Số bán hàng hôm nay" className="space-y-1">
      {today.isError && <LoadError onRetry={() => void today.refetch()} retrying={today.isFetching}>Không tải được số bán hàng hôm nay.</LoadError>}
      {t && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <TodayStat label="Doanh thu hôm nay" value={formatVnd(t.revenue.today)} sub={`${vsYesterday(t.revenue.today, t.revenue.yesterday, formatVnd)} · 7 ngày ${formatVnd(t.revenue.week)}`} tone={toneOf(t.revenue.today, t.revenue.yesterday)} />
          <TodayStat label="Đơn hôm nay" value={String(t.orders.today)} sub={`${vsYesterday(t.orders.today, t.orders.yesterday, String)} · 7 ngày ${t.orders.week}`} tone={toneOf(t.orders.today, t.orders.yesterday)} />
          <TodayStat label="Khách mới hôm nay" value={String(t.newUsers.today)} sub={`7 ngày: ${t.newUsers.week} khách mới`} tone={toneOf(t.newUsers.today, t.newUsers.yesterday)} />
          <TodayStat
            label="Khách mua lại (30 ngày)"
            value={ns1?.pct == null ? '—' : `${ns1.pct.toFixed(1).replace(/\.0$/, '').replace('.', ',')}%`}
            sub={ns1?.pct == null ? 'Chưa đủ nhóm khách 30 ngày' : `${ns1.repeat}/${ns1.cohort} khách mới có đơn thứ 2`}
          />
        </div>
      )}
    </section>
  );
}

function InboxCard({ k, count, hoursLeft, onOpen }: { k: InboxKey; count: number; hoursLeft?: number; onOpen: (key: InboxKey) => void }) {
  const l = INBOX_LABELS[k];
  const urgent = k === 'bankTransferToConfirm' && hoursLeft !== undefined;
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
        {urgent && (
          <span className="mt-0.5 block text-xs font-medium text-danger-fg">
            {hoursLeft === 0 ? 'Đơn cũ nhất đã quá hạn, sắp tự huỷ' : `Đơn cũ nhất còn ${hoursLeft} giờ trước khi tự huỷ`}
          </span>
        )}
      </span>
      <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-stone-500" />
    </button>
  );
}
