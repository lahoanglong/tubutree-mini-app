import { useId, useMemo, useState } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { flashSlotItemsQuery, flashSlotsQuery } from '@tubutree/app-core/queries/flash-sale';
import { initialSlotId, slotAfterEnd, slotCategoryChips, slotListView, slotTabs } from '@tubutree/app-core/commerce/flash-slots';
import { slotClock } from '@tubutree/app-core/merch/flash-next-slot';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { FlashSlotItem as FlashSlotItemData } from '@tubutree/app-core/api/flash-sale';
import { coreHttp } from '../services/core-http';
import { cartKey } from '../services/cart-key';
import { getErrorMessage, getLoadErrorMessage } from '../services/api';
import { addToCart, cancelFlashReminder, fetchUpcomingFlashSales, setFlashReminder, type UpcomingFlashItem } from '../services/shop-api';
import { useAuthStore } from '../store/auth';
import { useCategories } from '../hooks/use-categories';
import { useNotify } from '../hooks/use-notify';
import { rememberCheckoutSelection } from '../utils/checkout-selection';
import { haptic } from '../utils/haptic';
import { serverNow } from '../utils/server-clock';
import { Chip } from '../components/ui/chip';
import { Countdown } from '../components/ui/countdown';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { ProductTileSkeleton, Skeleton } from '../components/ui/skeleton';
import { SlotTabs, slotTabId } from '../components/ui/slot-tabs';
import { Text } from '../components/ui/text';
import { FlashSlotItem } from '../components/flash/flash-slot-item';

const UPCOMING_KEY = ['flash-sales', 'upcoming'] as const;
const SOLD_FOOTER_HEIGHT = 20;
/** Nhịp tải lại món của khung đang diễn ra: suất đã bán nhích lên, món hết suất xuống cuối. Phản hồi máy chủ được cache 3 giây. */
const LIVE_ITEMS_REFETCH_MS = 30_000;
const SLOTS_REFETCH_MS = 60_000;

const STRIP: React.CSSProperties = {
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
 * Trang Giờ vàng: dải tab khung giờ (hôm nay và ngày mai), đồng hồ của khung đang xem, chip danh mục khi khung đủ nhiều món, danh sách thẻ
 * `line` với Mua ngay (khung đang diễn ra) hoặc Nhắc tôi (khung sắp diễn ra). Khách chưa đăng nhập xem được hết; chỉ Mua ngay và Nhắc tôi
 * mở đăng nhập. Mốc giờ tính theo đồng hồ máy chủ (`serverNow`); `status` máy chủ trả chỉ dùng để nhận ra khung đã hết khi đồng hồ máy lệch.
 */
export default function FlashSalePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { notify } = useNotify();
  const panelId = useId();
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const { categories } = useCategories();

  const slotsQ = useQuery({ ...flashSlotsQuery(coreHttp), staleTime: 15_000, refetchInterval: SLOTS_REFETCH_MS });
  const upcomingQ = useQuery({ queryKey: UPCOMING_KEY, queryFn: fetchUpcomingFlashSales, staleTime: 30_000, enabled: authed });

  // `tick` buộc tính lại các mốc giờ khi một đồng hồ về 0 (khung vừa mở hoặc vừa hết); các lần render khác dùng giá trị đã nhớ.
  const [tick, setTick] = useState(0);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [endedNotice, setEndedNotice] = useState('');

  const slots = slotsQ.data?.slots;
  const { now, tabs } = useMemo(() => {
    const t = serverNow();
    return { now: t, tabs: slotTabs(slots ?? [], t) };
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

  const login = () => void useAuthStore.getState().login();

  const buyMut = useMutation({
    mutationFn: async (item: FlashSlotItemData) => ({ cart: await addToCart(item.variationId, 1, 'buy_now'), variationId: item.variationId }),
    onSuccess: ({ cart, variationId }) => {
      qc.setQueryData(cartKey(), cart);
      haptic('medium');
      // Chỉ thanh toán đúng dòng vừa Mua ngay: các món khác trong giỏ không bị tính theo.
      const line = cart.items.find((l) => l.variationId === variationId);
      const itemIds = line ? [line.id] : null;
      rememberCheckoutSelection(itemIds);
      navigate('/checkout', { state: { itemIds } });
    },
    onError: (e: unknown) => notify({ text: getErrorMessage(e), type: 'error' }),
  });

  const remindMut = useMutation({
    mutationFn: ({ itemId, reminded }: { itemId: string; reminded: boolean; startAt: string }) => (reminded ? cancelFlashReminder(itemId) : setFlashReminder(itemId)),
    onMutate: async ({ itemId, reminded }) => {
      await qc.cancelQueries({ queryKey: UPCOMING_KEY });
      const prev = qc.getQueryData<UpcomingFlashItem[]>(UPCOMING_KEY);
      qc.setQueryData<UpcomingFlashItem[]>(UPCOMING_KEY, (old) => old?.map((it) => (it.itemId === itemId ? { ...it, reminded: !reminded } : it)));
      return { prev };
    },
    onSuccess: (_d, { reminded, startAt }) =>
      notify({ text: reminded ? fillCopy('flash.unremindToast') : fillCopy('flash.remindedToast', { time: slotClock(startAt) }), type: 'success' }),
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(UPCOMING_KEY, ctx.prev);
      notify({ text: getErrorMessage(e), type: 'error' });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: UPCOMING_KEY }),
  });

  const reminded = useMemo(() => new Set((upcomingQ.data ?? []).filter((u) => u.reminded).map((u) => u.itemId)), [upcomingQ.data]);

  const pick = (id: string) => {
    setPickedId(id);
    setCategoryId(null);
    setEndedNotice('');
  };

  /** Đồng hồ khung đang diễn ra về 0: báo bằng chữ (vùng status), chuyển sang khung kế, tải lại danh sách khung. */
  const onSlotEnd = () => {
    if (!activeSlot) return;
    setEndedNotice(fillCopy('flash.slotEndedNotice', { time: slotClock(activeSlot.startAt) }));
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
    else navigate('/browse');
  };

  const onToggleRemind = (item: FlashSlotItemData) => {
    if (!authed) {
      login();
      return;
    }
    if (!activeSlot) return;
    remindMut.mutate({ itemId: item.itemId, reminded: reminded.has(item.itemId), startAt: activeSlot.startAt });
  };

  const onBuy = (item: FlashSlotItemData) => {
    if (!authed) {
      login();
      return;
    }
    if (buyMut.isPending) return;
    buyMut.mutate(item);
  };

  const empty = (
    <EmptyState art="sprout" heading={fillCopy('flash.emptyTitle')} body={fillCopy('flash.emptyBody')} ctaLabel={fillCopy('flash.emptyCta')} onCta={() => navigate('/browse')} />
  );

  let body: React.ReactNode;
  if (slotsQ.isPending) {
    body = (
      <div data-testid="flash-slots-loading" aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Skeleton height={56} radius="0" />
        <ListSkeleton />
      </div>
    );
  } else if (slotsQ.isError && !slotsQ.data) {
    body = <ErrorState message={getLoadErrorMessage(slotsQ.error)} onRetry={() => void slotsQ.refetch()} retrying={slotsQ.isFetching} />;
  } else if (tabs.length === 0 || activeId === null || activeTab === null || activeSlot === null) {
    body = empty;
  } else {
    const items = itemsQ.data?.items ?? [];
    const chips = slotCategoryChips(items, categories);
    const chosen = chips.some((c) => c.id === categoryId) ? categoryId : null;
    const rows = slotListView(items, chosen, categories);
    const serverEnded = itemsQ.data?.slot.status === 'ENDED';
    let list: React.ReactNode;
    if (itemsQ.isPending) list = <ListSkeleton />;
    else if (itemsQ.isError) list = <ErrorState variant="inline" message={getLoadErrorMessage(itemsQ.error)} onRetry={() => void itemsQ.refetch()} retrying={itemsQ.isFetching} />;
    else if (serverEnded)
      list = <EmptyState variant="inline" art="sprout" heading={fillCopy('flash.endedTitle')} ctaLabel={fillCopy('flash.endedCta')} onCta={goNextSlot} />;
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
        <SlotTabs tabs={tabs} value={activeId} onChange={pick} panelId={panelId} />
        <div role="tabpanel" id={panelId} aria-labelledby={slotTabId(activeId)}>
          <div style={STRIP}>
            {activeTab.status === 'LIVE' ? (
              <>
                <Text variant="body-sm" tone="secondary">
                  {fillCopy('flash.slotLive')}
                </Text>
                <Countdown key={activeId} endAt={activeSlot.endAt} mode="clock" onEnd={onSlotEnd} />
              </>
            ) : (
              <Countdown key={activeId} endAt={activeSlot.startAt} kind="starts" mode="text" onEnd={onSlotStart} />
            )}
          </div>
          {chips.length > 0 && (
            <div role="group" aria-label={fillCopy('flash.chipsLabel')} className="scroll-x" style={{ gap: 8, padding: '6px 16px', background: 'var(--color-bg-surface)' }}>
              <Chip
                selected={chosen === null}
                onPress={() => {
                  if (chosen !== null) haptic('light');
                  setCategoryId(null);
                }}
              >
                {fillCopy('browse.all')}
              </Chip>
              {chips.map((c) => (
                <Chip
                  key={c.id}
                  selected={chosen === c.id}
                  count={c.count}
                  onPress={() => {
                    if (chosen !== c.id) haptic('light');
                    setCategoryId(c.id);
                  }}
                >
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
    <Page className="page" style={{ background: 'var(--color-bg-canvas)', paddingBottom: 'calc(24px + var(--safe-bottom))' }}>
      <PageHeader title={fillCopy('flash.title')} />
      <div role="status" style={endedNotice ? { padding: '8px 16px', background: 'var(--color-status-info-bg)', color: 'var(--color-status-info-fg)', fontSize: 'var(--type-body-sm-size)' } : undefined}>
        {endedNotice}
      </div>
      {body}
    </Page>
  );
}
