'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { markAllNotificationsRead, markNotificationRead, type NotificationDTO } from '@tubutree/app-core/api/account';
import { fetchPurchasedItems } from '@tubutree/app-core/api/orders';
import { notificationsQuery } from '@tubutree/app-core/queries/account';
import { notificationAction, notificationMeta, relativeTime } from '@/components/account/notification-view';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Sheet } from '@/components/ui/sheet';
import { LineItemSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { ReorderSheet } from '@/components/reorder/reorder-sheet';
import { pickReminderItem, reorderReminderAction } from '@/components/reorder/reorder-reminder';
import type { ReorderSummary } from '@/components/reorder/reorder-summary';
import { reorderText } from '@/lib/home-text';
import { itemReorderTarget, type ReorderTarget } from '@/components/reorder/reorder-types';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { formatDateTime } from '@/lib/format-date';
import { ui } from '@/lib/guest-ui';

const NOTICE_MS = 4000;

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

/** Thông báo (cùng nội dung với `notifications.tsx` của Mini App): danh sách, chấm chưa đọc, đọc một/đọc hết, chi tiết kèm nút hành động theo loại tin. */
export default function NotificationsPage() {
  const phase = useAuthPhase();
  const qc = useQueryClient();
  const router = useRouter();
  const [selected, setSelected] = useState<NotificationDTO | null>(null);
  // State ổn định (không dựng target trong JSX): ReorderSheet khởi tạo lại lựa chọn theo danh tính của target.
  const [reorderTarget, setReorderTarget] = useState<ReorderTarget | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  // Chặn chạm đúp đồng bộ (state chỉ cập nhật sau lần render kế tiếp).
  const reminderBusyRef = useRef(false);
  // Sheet đóng ngay khi thêm đủ nên báo kết quả ở trang (như snackbar "Xem giỏ" của Mini App), tự tắt sau vài giây.
  const [addedNotice, setAddedNotice] = useState<ReorderSummary | null>(null);
  useEffect(() => {
    if (!addedNotice) return;
    const t = setTimeout(() => setAddedNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [addedNotice]);
  const selectedIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  selectedIdRef.current = selected?.id ?? null;
  const notifQ = useQuery({ ...notificationsQuery(coreHttp), enabled: phase === 'authenticated' });

  // onSettled: đánh dấu đã đọc hỏng thì số chưa đọc sai mãi mà không có tín hiệu nào; nạp lại cả hai trường hợp, không báo lỗi vì là thao tác nền.
  const readMut = useMutation({
    mutationFn: (id: string) => markNotificationRead(coreHttp, id),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const readAllMut = useMutation({
    mutationFn: () => markAllNotificationsRead(coreHttp),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unreadCount = notifQ.data?.filter((n) => n.status !== 'READ').length ?? 0;

  const onTap = (n: NotificationDTO) => {
    if (n.status !== 'READ') readMut.mutate(n.id);
    setSelected(n);
  };

  // Tra đúng variation trong payload qua purchased-items (đơn đã giao của chính khách). Lỗi / API cũ 404 / hết hàng → điều hướng dự phòng.
  const openReorderReminder = async (n: NotificationDTO, fallbackTo: string) => {
    if (reminderBusyRef.current) return;
    reminderBusyRef.current = true;
    setAddedNotice(null);
    setReminderBusy(true);
    try {
      const variationId = n.payload.data?.variation_id;
      const item = variationId
        ? await fetchPurchasedItems(coreHttp, { variationId, limit: 1 })
            .then((p) => pickReminderItem(p.items, variationId))
            .catch(() => null)
        : null;
      // Khách đã đóng chi tiết / đổi sang thông báo khác / rời trang trong lúc tra cứu → không mở sheet hay điều hướng muộn.
      if (!mountedRef.current || selectedIdRef.current !== n.id) return;
      const next = reorderReminderAction(fallbackTo, item);
      setSelected(null);
      if (next.kind === 'sheet') setReorderTarget(itemReorderTarget(next.item));
      else router.push(next.to);
    } finally {
      reminderBusyRef.current = false;
      if (mountedRef.current) setReminderBusy(false);
    }
  };

  const shell = (body: ReactNode) => (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <PageHeader
        title="Thông báo"
        backHref="/tai-khoan"
        backLabel="Quay lại tài khoản"
        actions={
          phase === 'authenticated' && unreadCount > 0 ? (
            <button type="button" disabled={readAllMut.isPending} onClick={() => readAllMut.mutate()} className={`${ui.btnText} text-forest-700`}>
              {readAllMut.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
              Đọc tất cả
            </button>
          ) : undefined
        }
      />
      {body}
    </main>
  );

  if (phase === 'loading') return shell(<AuthLoading />);
  if (phase === 'unavailable') return shell(<SessionUnavailable />);
  if (phase === 'guest') return shell(<LoginRequired message="Đăng nhập để xem thông báo của bạn." returnTo="/tai-khoan/thong-bao" />);

  if (notifQ.isLoading) {
    return shell(
      <div className="mt-4 flex flex-col gap-2">
        <LineItemSkeleton />
        <LineItemSkeleton />
      </div>,
    );
  }
  if (notifQ.isError && !notifQ.data) {
    return shell(
      <div className="mt-4">
        <ErrorState message={errorText(notifQ.error)} onRetry={() => void notifQ.refetch()} />
      </div>,
    );
  }
  if (!notifQ.data || notifQ.data.length === 0) {
    return shell(<EmptyState title="Chưa có thông báo nào" body="Cập nhật đơn hàng và ưu đãi sẽ hiện ở đây." actionHref="/" actionLabel="Về trang chủ" />);
  }

  return shell(
    <>
      <div
        role="status"
        aria-live="polite"
        className="fixed inset-x-4 z-50 md:left-auto md:right-6 md:w-96"
        style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {addedNotice && (
          <p className="rounded-card border border-stone-200 bg-stone-0 p-3 text-sm font-medium text-success-fg shadow-card">
            {addedNotice.message}{' '}
            <Link href="/gio-hang" className="font-semibold text-forest-700 underline">
              {reorderText.viewCart}
            </Link>
          </p>
        )}
      </div>
      <ul className="mt-4 grid gap-2 md:grid-cols-2">
        {notifQ.data.map((n) => {
          const m = notificationMeta(n.templateCode);
          const unread = n.status !== 'READ';
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => onTap(n)}
                className={`flex min-h-11 w-full gap-3 rounded-card border p-3 text-left shadow-card transition active:scale-[0.99] ${
                  unread ? 'border-forest-200 bg-forest-50' : 'border-stone-200 bg-stone-0'
                }`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone-100 text-forest-600">
                  <m.Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-stone-900">{m.title}</span>
                    {unread && <span role="img" aria-label="chưa đọc" className="h-2 w-2 rounded-full bg-forest-600" />}
                  </span>
                  {n.payload.body && <span className="mt-0.5 block text-sm text-stone-700">{n.payload.body}</span>}
                  <span className="mt-1 block text-xs text-stone-600">{relativeTime(n.sentAt)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <Sheet open={selected !== null} onClose={() => setSelected(null)} title="Chi tiết thông báo">
        {selected && <Detail n={selected} busy={reminderBusy} onNavigate={() => setSelected(null)} onReorder={(to) => void openReorderReminder(selected, to)} />}
      </Sheet>
      <ReorderSheet target={reorderTarget} source="notification" onDone={setAddedNotice} onClose={() => setReorderTarget(null)} />
    </>,
  );
}

function Detail({ n, busy, onNavigate, onReorder }: { n: NotificationDTO; busy: boolean; onNavigate: () => void; onReorder: (fallbackTo: string) => void }) {
  const m = notificationMeta(n.templateCode);
  const action = notificationAction(n.templateCode, n.payload.data);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-stone-100 text-forest-600">
          <m.Icon className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-stone-900">{m.title}</p>
          <p className="mt-0.5 text-xs text-stone-600">
            {formatDateTime(n.sentAt)} ({relativeTime(n.sentAt)})
          </p>
        </div>
      </div>
      <hr className="border-stone-200" />
      <p className="whitespace-pre-line text-sm leading-relaxed text-stone-900">{n.payload.body || ''}</p>
      {action?.kind === 'reorder' && (
        <button type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => onReorder(action.to)} className={`${ui.btnPrimary} w-full`}>
          {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
          {action.label}
        </button>
      )}
      {action?.kind === 'link' && (
        <Link href={action.to} onClick={onNavigate} className={`${ui.btnPrimary} w-full`}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
