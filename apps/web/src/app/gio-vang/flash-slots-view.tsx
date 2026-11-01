'use client';

// Nguồn: apps/miniapp/src/pages/flash-sale.tsx
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelFlashReminder, setFlashReminder, type FlashSlotItem as FlashSlotItemData, type UpcomingFlashItem } from '@tubutree/app-core/api/flash-sale';
import { remindIntentAction } from '@tubutree/app-core/commerce/flash-remind-intent';
import { initialSlotId, slotAfterEnd, slotCategoryChips, slotListView, slotTabs } from '@tubutree/app-core/commerce/flash-slots';
import { slotClock } from '@tubutree/app-core/merch/flash-next-slot';
import { categoriesQuery } from '@tubutree/app-core/queries/catalog';
import { flashSlotItemsQuery, flashSlotsQuery, flashUpcomingQuery } from '@tubutree/app-core/queries/flash-sale';
import { serverNow } from '@tubutree/app-core/server-clock';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useAuthPhase } from '@/lib/auth-phase';
import { cartKey } from '@/lib/cart-key';
import { rememberCheckoutSelection } from '@/lib/checkout-selection';
import { coreHttp } from '@/lib/core-http';
import { actionErrorText, loadErrorText } from '@/lib/error-text';
import { PAGE_NARROW } from '@/lib/page-frame';
import { clearPendingRemind, rememberPendingRemind, takePendingRemind } from '@/lib/pending-remind';
import { loginHref } from '@/lib/return-to';
import { addToCart } from '@/lib/shop-client';
import { Chip, EmptyState, ProductTileSkeleton, Skeleton, SlotTabs, Text, slotTabId } from '@/components/mini';
import { Countdown } from '@/components/mini/countdown';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { FlashSlotItem } from '@/components/flash/flash-slot-item';

const SOLD_FOOTER_HEIGHT = 20;
/** Nhịp tải lại món của khung đang diễn ra: suất đã bán nhích lên, món hết suất xuống cuối. Phản hồi máy chủ được cache 3 giây. */
const LIVE_ITEMS_REFETCH_MS = 30_000;
const SLOTS_REFETCH_MS = 60_000;
const OFFLINE_TEXT = 'Chưa kết nối được tới Tubu Tree. Bạn kiểm tra mạng rồi bấm lại nhé.';

/** Dải ngang tràn hai mép màn điện thoại như Mini App (trang web có lề 16px); từ md nằm trong cột. */
const BLEED = 'max-md:mx-[calc(50%-50vw)]';
/**
 * Dải tab và đồng hồ dính khi cuộn (thiết kế §5), như `pages/flash-sale.tsx` của Mini App. Điện thoại: tràn hai mép, `.sticky-below-back` (globals.css) đặt `top`
 * dưới thanh đặc của nút lùi; từ md dưới thanh đầu trang của site (`--header-h`, z-40). z-index dưới cả hai và trên thẻ món.
 */
const STICKY_CLASS = `sticky-below-back sticky top-[var(--header-h)] z-10 ${BLEED}`;
const STICKY_STYLE: CSSProperties = { background: 'var(--color-bg-surface)', boxShadow: '0 1px 0 var(--color-border-subtle)' };
const STRIP: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  minHeight: 44,
  padding: '0 16px',
  boxSizing: 'border-box',
  background: 'var(--color-bg-surface)',
};

function ListSkeleton() {
  return (
    <div data-testid="flash-items-loading" aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 16px 0' }}>
      {[0, 1, 2, 3].map((i) => (
        <ProductTileSkeleton key={i} variant="line" note footerHeight={SOLD_FOOTER_HEIGHT} />
      ))}
    </div>
  );
}

/**
 * Trang Giờ vàng (bản web của `pages/flash-sale.tsx`): dải tab khung giờ (hôm nay và ngày mai), đồng hồ của khung đang xem, chip danh mục khi khung đủ
 * nhiều món, danh sách thẻ `line` với Mua ngay (khung đang diễn ra) hoặc Nhắc tôi (khung sắp diễn ra). Khách chưa đăng nhập xem được hết; chỉ Mua ngay và
 * Nhắc tôi đưa tới đăng nhập (quay lại đúng trang này). Dữ liệu tải ở client, không dựng sẵn: khung giờ và suất đổi theo từng giây còn HTML dựng sẵn thì cũ.
 * Web không có snackbar nên mọi báo cáo đi qua hai vùng chữ: `role="status"` (đã nhắc, khung đã kết thúc) và `role="alert"` (lỗi).
 */
export default function FlashSlotsView() {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const panelId = useId();
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';

  const slotsQ = useQuery({ ...flashSlotsQuery(coreHttp), staleTime: 15_000, refetchInterval: SLOTS_REFETCH_MS });
  const categoriesQ = useQuery({ ...categoriesQuery(coreHttp), staleTime: 60_000, retry: false });
  const upcomingKey = flashUpcomingQuery(coreHttp).queryKey;
  const upcomingQ = useQuery({ ...flashUpcomingQuery(coreHttp), staleTime: 30_000, enabled: authed });

  // `tick` buộc tính lại các mốc giờ khi một đồng hồ về 0 (khung vừa mở hoặc vừa hết); các lần render khác dùng giá trị đã nhớ.
  const [tick, setTick] = useState(0);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const slots = slotsQ.data?.slots;
  const categories = categoriesQ.data ?? [];
  const { now, tabs } = useMemo(() => {
    const t = serverNow();
    return { now: t, tabs: slotTabs(slots ?? [], t) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` chỉ để buộc tính lại khi một đồng hồ về 0
  }, [slots, tick]);
  const activeId = pickedId !== null && tabs.some((t) => t.id === pickedId) ? pickedId : initialSlotId(slots ?? [], now);
  const activeTab = tabs.find((t) => t.id === activeId) ?? null;
  const activeSlot = slots?.find((s) => s.id === activeId) ?? null;

  const itemsQ = useQuery({
    ...flashSlotItemsQuery(coreHttp, activeId ?? ''),
    enabled: activeId !== null,
    staleTime: 10_000,
    refetchInterval: activeTab?.status === 'LIVE' ? LIVE_ITEMS_REFETCH_MS : false,
  });

  const reminded = useMemo(() => new Set((upcomingQ.data ?? []).filter((u) => u.reminded).map((u) => u.itemId)), [upcomingQ.data]);

  const buyMut = useMutation({
    mutationFn: async (item: FlashSlotItemData) => ({ cart: await addToCart(item.variationId, 1), variationId: item.variationId }),
    onSuccess: ({ cart, variationId }) => {
      qc.setQueryData(cartKey(), cart);
      // Chỉ thanh toán đúng dòng vừa Mua ngay: các món khác trong giỏ không bị tính theo. Không thấy dòng (API trả giỏ thiếu) thì null = cả giỏ.
      const bought = (cart.items ?? []).filter((l) => l.variationId === variationId).map((l) => l.id);
      rememberCheckoutSelection(bought.length > 0 ? bought : null);
      router.push('/thanh-toan');
    },
    onError: (e: unknown) => setError(actionErrorText(e)),
  });

  const remindMut = useMutation({
    mutationFn: ({ itemId, reminded: on }: { itemId: string; reminded: boolean; startAt: string }) => (on ? cancelFlashReminder(coreHttp, itemId) : setFlashReminder(coreHttp, itemId)),
    onMutate: async ({ itemId, reminded: on }) => {
      await qc.cancelQueries({ queryKey: upcomingKey });
      const prev = qc.getQueryData<UpcomingFlashItem[]>(upcomingKey);
      qc.setQueryData<UpcomingFlashItem[]>(upcomingKey, (old) => old?.map((it) => (it.itemId === itemId ? { ...it, reminded: !on } : it)));
      return { prev };
    },
    onSuccess: (_d, { reminded: on, startAt }) => setNotice(on ? fillCopy('flash.unremindToast') : fillCopy('flash.remindedToast', { time: slotClock(startAt) })),
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(upcomingKey, ctx.prev);
      setError(actionErrorText(e));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: upcomingKey }),
  });

  // Khách bấm "Nhắc tôi" lúc chưa đăng nhập đã được đưa đi đăng nhập (suất nằm ở sessionStorage, xem lib/pending-remind.ts). Quay về với phiên và danh sách
  // nhắc đã tải thì đặt nhắc, đúng một lần; quay về mà vẫn là khách (bỏ dở đăng nhập) thì xoá, để lần đăng nhập sau không tự đặt một nhắc đã bị lãng quên.
  const intentHandled = useRef(false);
  const upcomingList = upcomingQ.isSuccess ? upcomingQ.data : null;
  useEffect(() => {
    if (phase === 'guest') {
      clearPendingRemind();
      return;
    }
    if (!authed || !upcomingList || intentHandled.current) return;
    intentHandled.current = true;
    const intent = takePendingRemind();
    if (intent && remindIntentAction(intent, upcomingList) === 'remind') {
      remindMut.mutate({ itemId: intent.itemId, reminded: false, startAt: intent.startAt });
    }
    // `remindMut` đổi tham chiếu mỗi lần render nên không đưa vào phụ thuộc: chạy lại theo phiên và danh sách nhắc là đủ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, authed, upcomingList]);

  const clearMessages = () => {
    setNotice('');
    setError('');
  };

  const pick = (id: string) => {
    setPickedId(id);
    setCategoryId(null);
    clearMessages();
  };

  /** Đồng hồ khung đang diễn ra về 0: báo bằng chữ (vùng status), chuyển sang khung kế, tải lại danh sách khung. */
  const onSlotEnd = () => {
    if (!activeSlot) return;
    setError('');
    setNotice(fillCopy('flash.slotEndedNotice', { time: slotClock(activeSlot.startAt) }));
    setPickedId(slotAfterEnd(slots ?? [], activeSlot.id, serverNow()));
    setCategoryId(null);
    setTick((n) => n + 1);
    void qc.invalidateQueries({ queryKey: ['flash-sales', 'slots'] });
  };

  /** Đồng hồ khung sắp diễn ra về 0: khung thành đang diễn ra ngay, danh sách tải lại để nút Nhắc tôi đổi thành Mua ngay. */
  const onSlotStart = () => {
    setTick((n) => n + 1);
    void qc.invalidateQueries({ queryKey: ['flash-sales', 'slots'] });
  };

  const goNextSlot = () => {
    if (!activeSlot) return;
    const next = slotAfterEnd(slots ?? [], activeSlot.id, now);
    if (next) pick(next);
    else router.push('/san-pham');
  };

  /** Mua ngay và Nhắc tôi cần phiên: khách đi đăng nhập rồi quay lại trang này; phiên đang khôi phục thì chờ, mất kết nối thì nói rõ. */
  const needSession = (): boolean => {
    if (authed) return false;
    if (phase === 'guest') router.push(loginHref(pathname || '/gio-vang'));
    else if (phase === 'unavailable') setError(OFFLINE_TEXT);
    return true;
  };

  const onToggleRemind = (item: FlashSlotItemData) => {
    if (phase === 'guest' && activeSlot) rememberPendingRemind({ itemId: item.itemId, startAt: activeSlot.startAt });
    if (needSession() || !activeSlot) return;
    clearMessages();
    remindMut.mutate({ itemId: item.itemId, reminded: reminded.has(item.itemId), startAt: activeSlot.startAt });
  };

  const onBuy = (item: FlashSlotItemData) => {
    if (needSession() || buyMut.isPending) return;
    clearMessages();
    buyMut.mutate(item);
  };

  let body: ReactNode;
  if (slotsQ.isPending) {
    body = (
      <div data-testid="flash-slots-loading" aria-hidden="true" className={BLEED} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Skeleton height={56} radius="0" />
        <ListSkeleton />
      </div>
    );
  } else if (slotsQ.isError && !slotsQ.data) {
    body = <ErrorState message={loadErrorText(slotsQ.error)} onRetry={() => void slotsQ.refetch()} />;
  } else if (tabs.length === 0 || activeId === null || activeTab === null || activeSlot === null) {
    body = (
      <EmptyState art="sprout" heading={fillCopy('flash.emptyTitle')} body={fillCopy('flash.emptyBody')} ctaLabel={fillCopy('flash.emptyCta')} onCta={() => router.push('/san-pham')} />
    );
  } else {
    const items = itemsQ.data?.items ?? [];
    const chips = slotCategoryChips(items, categories);
    const chosen = chips.some((c) => c.id === categoryId) ? categoryId : null;
    const rows = slotListView(items, chosen, categories);
    const serverEnded = itemsQ.data?.slot.status === 'ENDED';
    let list: ReactNode;
    if (itemsQ.isPending) list = <ListSkeleton />;
    else if (itemsQ.isError) list = <ErrorState variant="inline" message={loadErrorText(itemsQ.error)} onRetry={() => void itemsQ.refetch()} />;
    else if (serverEnded) list = <EmptyState variant="inline" art="sprout" heading={fillCopy('flash.endedTitle')} ctaLabel={fillCopy('flash.endedCta')} onCta={goNextSlot} />;
    else if (rows.length === 0) list = <EmptyState variant="inline" art="box" heading={fillCopy('flash.slotEmpty')} />;
    else
      list = (
        <ul style={{ listStyle: 'none', margin: 0, padding: '8px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((item) => (
            <li key={item.itemId}>
              <FlashSlotItem
                item={item}
                slotStatus={activeTab.status}
                reminded={reminded.has(item.itemId)}
                remindPending={remindMut.isPending && remindMut.variables?.itemId === item.itemId}
                onBuy={() => onBuy(item)}
                onToggleRemind={() => onToggleRemind(item)}
              />
            </li>
          ))}
        </ul>
      );
    body = (
      <>
        <div data-testid="flash-sticky" className={STICKY_CLASS} style={STICKY_STYLE}>
          <SlotTabs tabs={tabs} value={activeId} onChange={pick} panelId={panelId} />
          <div style={STRIP}>
            {activeTab.status === 'LIVE' ? (
              <>
                {/* Chữ nhìn thấy ẩn với trình đọc: tên đọc của đồng hồ (role="timer") đã là "Kết thúc sau ...". */}
                <span aria-hidden="true">
                  <Text variant="body-sm" tone="secondary">
                    {fillCopy('flash.endsLabel')}
                  </Text>
                </span>
                <Countdown key={activeId} endAt={activeSlot.endAt} mode="clock" onEnd={onSlotEnd} />
              </>
            ) : (
              <Countdown key={activeId} endAt={activeSlot.startAt} kind="starts" mode="text" onEnd={onSlotStart} />
            )}
          </div>
        </div>
        <div role="tabpanel" id={panelId} aria-labelledby={slotTabId(activeId)} className={BLEED}>
          {chips.length > 0 && (
            <div role="group" aria-label={fillCopy('flash.chipsLabel')} className="scroll-x" style={{ gap: 8, padding: '6px 16px', background: 'var(--color-bg-surface)' }}>
              <Chip selected={chosen === null} onPress={() => setCategoryId(null)}>
                {fillCopy('browse.all')}
              </Chip>
              {chips.map((c) => (
                <Chip key={c.id} selected={chosen === c.id} count={c.count} onPress={() => setCategoryId(c.id)}>
                  {c.name}
                </Chip>
              ))}
            </div>
          )}
          {list}
        </div>
      </>
    );
  }

  return (
    <main className={`${PAGE_NARROW} py-6 max-md:pt-0`}>
      <PageHeader title={fillCopy('flash.title')} parentHref="/" />
      <div
        role="status"
        className="text-sm"
        style={notice ? { margin: '8px 0', padding: '8px 12px', borderRadius: 'var(--radius-control)', background: 'var(--color-status-info-bg)', color: 'var(--color-status-info-fg)' } : undefined}
      >
        {notice}
      </div>
      {error && (
        <div role="alert" className="text-sm" style={{ margin: '8px 0', padding: '8px 12px', borderRadius: 'var(--radius-control)', background: 'var(--color-status-danger-bg)', color: 'var(--color-status-danger-fg)' }}>
          {error}
        </div>
      )}
      {body}
    </main>
  );
}
