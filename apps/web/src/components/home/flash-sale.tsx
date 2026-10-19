'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2, Clock, Zap } from 'lucide-react';
import { cancelFlashReminder, setFlashReminder, type FlashSaleActiveItem, type UpcomingFlashItem } from '@tubutree/app-core/api/flash-sale';
import { flashActiveQuery, flashUpcomingQuery } from '@tubutree/app-core/queries/flash-sale';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { flashDisplay, soldPercent } from '@/lib/flash-display';
import { formatVnd } from '@/lib/format-vnd';
import { flashSaleText } from '@/lib/home-text';
import { useCountdown } from '@/lib/use-countdown';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { HomeBlockError } from './home-block-error';
import { useBlockQuery } from './use-block-query';

const CARD = 'flex w-36 flex-none flex-col overflow-hidden rounded-card border border-stone-200 bg-stone-0 shadow-card transition hover:shadow-raised sm:w-44';
const RAIL = 'flex gap-3 overflow-x-auto px-1 pb-3 pt-1';
const TITLE = 'flex items-center gap-1.5 font-display text-lg font-semibold text-promo-fg';

function Thumb({ src, name, pct }: { src: string | null; name: string; pct: number }) {
  return (
    <div className="relative aspect-square w-full bg-stone-100">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt={name} width={176} height={176} loading="lazy" className="h-full w-full object-cover" />}
      {pct > 0 && (
        <span className="absolute left-1.5 top-1.5">
          <Badge tone="promo" size="sm">
            -{pct}%
          </Badge>
        </span>
      )}
    </div>
  );
}

/** Ưu đãi giờ vàng — flash sale thật từ backend. Countdown êm đến mốc kết thúc sớm nhất. */
export function FlashSale() {
  const q = useBlockQuery(useQuery({ ...flashActiveQuery(coreHttp), staleTime: 30_000, refetchInterval: 60_000 }));
  const items = q.data ?? [];

  // Chỉ tính suất còn giờ: suất sớm nhất có thể đã hết mà danh sách chưa kịp tải lại (poll 60s) trong khi các suất khác còn chạy.
  // `expiredTick` tính lại ngay khi suất đang đếm về 0 để đồng hồ chuyển sang suất kế tiếp thay vì biến mất.
  const [expiredTick, setExpiredTick] = useState(0);
  const soonestEndAt = useMemo(() => {
    const now = Date.now();
    const live = items.map((it) => new Date(it.endAt).getTime()).filter((ms) => ms > now);
    return live.length > 0 ? new Date(Math.min(...live)) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, expiredTick]);

  const timeLeft = useCountdown(soonestEndAt);
  useEffect(() => {
    if (soonestEndAt && timeLeft === '') setExpiredTick((n) => n + 1);
  }, [soonestEndAt, timeLeft]);

  if (q.isLoading) return null;
  if (items.length === 0) {
    return q.isError ? <HomeBlockError title={flashSaleText.sectionName} error={q.error} onRetry={q.refetch} retrying={q.isFetching} /> : null;
  }

  return (
    <section aria-label={flashSaleText.sectionName} className="py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className={TITLE}>
          <Zap className="h-4 w-4" aria-hidden="true" />
          {flashSaleText.sectionTitle}
        </h2>
        {/* Hết giờ mà danh sách chưa kịp tải lại (poll 60s): không hiện đồng hồ về 0. */}
        {timeLeft && (
          <span role="timer" aria-label={flashSaleText.endsIn(timeLeft)}>
            <Badge tone="promo" icon={Clock}>
              {flashSaleText.endsIn(timeLeft)}
            </Badge>
          </span>
        )}
      </div>
      <ul className={RAIL}>
        {items.map((item: FlashSaleActiveItem) => {
          const { price, was, pct } = flashDisplay(item);
          const sold = soldPercent(item.soldCount, item.quota);
          return (
            <li key={item.itemId}>
              <Link href={`/san-pham/${encodeURIComponent(item.productSlug)}`} className={CARD}>
                <Thumb src={item.thumbnail} name={item.productName} pct={pct} />
                <div className="p-2">
                  <p className="line-clamp-2 h-8 text-xs leading-4 text-stone-900">{item.productName}</p>
                  <p className="mt-0.5 text-sm font-bold text-promo-fg">{formatVnd(price)}</p>
                  {was > price && <p className="text-xs text-stone-500 line-through">{formatVnd(was)}</p>}
                  <div className="mt-1">
                    <ProgressBar value={sold} max={100} tone="flash" ariaLabel={flashSaleText.soldPct(sold)} />
                  </div>
                  <p className="mt-0.5 text-xs text-stone-600">{flashSaleText.soldPct(sold)}</p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 1 thẻ trong danh sách "Sắp diễn ra" — countdown riêng theo startAt của item. */
function UpcomingFlashCard({ item, pending, onToggleRemind }: { item: UpcomingFlashItem; pending: boolean; onToggleRemind: () => void }) {
  const startsIn = useCountdown(item.startAt);
  const { price, pct } = flashDisplay(item);
  return (
    <li className={CARD.replace('transition hover:shadow-raised ', '')}>
      <Link href={`/san-pham/${encodeURIComponent(item.productSlug)}`} className="block">
        <Thumb src={item.thumbnail} name={item.productName} pct={pct} />
        <div className="px-2 pt-2">
          <p className="line-clamp-2 h-8 text-xs leading-4 text-stone-900">{item.productName}</p>
          <p className="mt-0.5 text-sm font-bold text-promo-fg">{formatVnd(price)}</p>
          {/* Đã tới giờ mở bán mà danh sách chưa tải lại: không còn gì để nhắc, chạm thẻ là vào xem. */}
          <p className="mt-0.5 text-xs text-stone-600">{startsIn ? flashSaleText.startsIn(startsIn) : flashSaleText.live}</p>
        </div>
      </Link>
      {startsIn && (
        <div className="p-2">
          <button
            type="button"
            disabled={pending}
            onClick={onToggleRemind}
            className={`inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full text-xs font-semibold transition disabled:opacity-60 ${
              item.reminded ? 'bg-forest-50 text-forest-700' : 'bg-forest-600 text-stone-0 hover:bg-forest-700'
            }`}
          >
            {item.reminded ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Bell className="h-4 w-4" aria-hidden="true" />}
            {item.reminded ? flashSaleText.reminded : flashSaleText.remindMe}
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * "Sắp diễn ra" — flash sale đã lên lịch nhưng chưa mở bán, cho khách đặt nhắc. Cần đăng nhập (API lấy userId từ phiên để trả
 * trạng thái reminded) → chỉ chạy khi đã đăng nhập. Đặt/huỷ nhắc cập nhật ngay, lỗi thì hoàn lại.
 */
export function UpcomingFlashSales() {
  const qc = useQueryClient();
  const authed = useAuthPhase() === 'authenticated';
  const key = flashUpcomingQuery(coreHttp).queryKey;
  const q = useQuery({ ...flashUpcomingQuery(coreHttp), enabled: authed, staleTime: 30_000 });

  const remind = useMutation({
    mutationFn: ({ itemId, reminded }: { itemId: string; reminded: boolean }) =>
      reminded ? cancelFlashReminder(coreHttp, itemId) : setFlashReminder(coreHttp, itemId),
    onMutate: async ({ itemId, reminded }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<UpcomingFlashItem[]>(key);
      qc.setQueryData<UpcomingFlashItem[]>(key, (old) => old?.map((it) => (it.itemId === itemId ? { ...it, reminded: !reminded } : it)));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });

  const items = q.data ?? [];
  if (!authed || q.isLoading || items.length === 0) return null;

  return (
    <section aria-label={flashSaleText.upcomingTitle} className="py-2">
      <h2 className={`mb-2 ${TITLE}`}>
        <Bell className="h-4 w-4" aria-hidden="true" />
        {flashSaleText.upcomingTitle}
      </h2>
      <ul className={RAIL}>
        {items.map((item) => (
          <UpcomingFlashCard
            key={item.itemId}
            item={item}
            pending={remind.isPending && remind.variables?.itemId === item.itemId}
            onToggleRemind={() => remind.mutate({ itemId: item.itemId, reminded: item.reminded })}
          />
        ))}
      </ul>
    </section>
  );
}
