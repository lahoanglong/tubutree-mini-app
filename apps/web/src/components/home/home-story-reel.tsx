'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BestSellersPage } from '@tubutree/app-core/api/browse';
import type { ProductCard, ProductDetail, VariationDetail } from '@tubutree/app-core/api/catalog';
import { markReelSeen, readReelSeen, reelDisabled, reelItems, reelNeighbor } from '@tubutree/app-core/commerce/story-reel';
import { productQuery } from '@tubutree/app-core/queries/catalog';
import { quickAddPlan } from '@tubutree/app-core/quick-add';
import { homeBestSellerQuery } from '@tubutree/app-core/queries/home';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useQuickAdd } from '@/app/tai-khoan/yeu-thich/quick-add';
import { ProductStoryShowcase, StoryReelStrip } from '@/components/mini';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { loginHref, rememberPendingAdd } from '@/lib/return-to';
import { useCardPricing } from '@/lib/use-card-pricing';
import { useBlockQuery } from './use-block-query';

const STALE = 60_000;
// Chi tiết món đã tải (khi chạm vòng, hoặc tải trước món kế) dùng lại trong chừng này: Reel mở ngay lần chạm thứ hai và khi bấm "Câu chuyện kế".
const DETAIL_STALE = 60_000;

function sessionStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const detailOf = (slug: string) => ({ ...productQuery(coreHttp, slug), staleTime: DETAIL_STALE });

/**
 * Khung chờ toàn màn trong lúc tải chi tiết món: cùng khung và nút đóng với Reel thật (nút đóng 44x44 dùng được ngay, Escape đóng), nên Reel hiện ra không chớp.
 * Chỉ một nút bấm được nên Tab không được rời khung.
 */
function ReelPending({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
      else if (e.key === 'Tab') e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (before && typeof before.focus === 'function') before.focus();
    };
  }, []);
  const title = fillCopy('story.title');
  return (
    <section role="dialog" aria-modal="true" aria-label={title} aria-busy="true" data-testid="reel-pending" className="tubu-story tubu-story-full">
      <header className="tubu-story-header">
        <h2 className="tubu-story-heading">{title}</h2>
        <button ref={closeRef} type="button" data-testid="story-close" aria-label={fillCopy('story.close')} className="tubu-story-close" onClick={() => onCloseRef.current()}>
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="tubu-story-scroll">
        <span aria-hidden="true" className="tubu-skeleton tubu-reel-pending-stage" />
      </div>
    </section>
  );
}

interface OverlayProps {
  slug: string;
  items: readonly ProductCard[];
  onGo: (slug: string) => void;
  onClose: () => void;
  onFail: () => void;
  onAdd: (card: ProductCard, variations: VariationDetail[]) => void | Promise<unknown>;
}

/** Reel của một món: tải chi tiết, tải trước món kế, tự nhảy qua món mà admin đã tắt câu chuyện, và dựng `ProductStoryShowcase` toàn màn kiểu Reel. */
function ReelOverlay({ slug, items, onGo, onClose, onFail, onAdd }: OverlayProps) {
  const qc = useQueryClient();
  const q = useQuery({ ...detailOf(slug), retry: false });
  const pricing = useCardPricing();
  const slugs = useMemo(() => items.map((c) => c.slug), [items]);
  const card = items.find((c) => c.slug === slug);
  const next = reelNeighbor(slugs, slug, 1);
  const detail: ProductDetail | undefined = q.data;
  const skip = !!detail && reelDisabled(detail);

  const failRef = useRef(onFail);
  failRef.current = onFail;
  useEffect(() => {
    if (q.isError) failRef.current();
  }, [q.isError]);

  const skipRef = useRef<() => void>(() => undefined);
  skipRef.current = () => (next ? onGo(next) : onClose());
  useEffect(() => {
    if (skip) skipRef.current();
  }, [skip, slug]);

  useEffect(() => {
    if (detail && next) void qc.prefetchQuery(detailOf(next));
  }, [qc, detail, next]);

  if (!detail || skip || !card) return <ReelPending onClose={onClose} />;
  const index = slugs.indexOf(slug);
  return (
    <ProductStoryShowcase
      key={slug}
      product={detail}
      fullscreen
      reel
      buyDisabled={!detail.variations.some((v) => v.stock > 0)}
      addPrice={formatVnd(pricing(card).price)}
      position={fillCopy('reel.position', { n: index + 1, total: slugs.length })}
      onNext={next ? () => onGo(next) : undefined}
      onClose={onClose}
      onAddToCart={() => onAdd(card, detail.variations)}
    />
  );
}

/**
 * Khối `stories` của Trang chủ: dải vòng Story từ kệ Bán chạy nhất (dữ liệu THÔ, không chống trùng với kệ khác nên không chiếm món của kệ nào), chạm một vòng mở Reel toàn màn của
 * món đó. Dùng đúng query của kệ Bán chạy nhất (cùng khoá, cùng dữ liệu dựng sẵn ở máy chủ) nên dải có ngay trong HTML đầu và không thêm request; "đã xem" chỉ đọc ghi ở
 * sessionStorage trong effect (máy chủ không có window). Dưới `REEL_MIN_ITEMS` món hoặc lỗi thì không vẽ gì.
 */
export function HomeStoryReel({ initialBestSellers }: { initialBestSellers?: BestSellersPage }) {
  const router = useRouter();
  const qc = useQueryClient();
  const phase = useAuthPhase();
  const best = useBlockQuery(useQuery({ ...homeBestSellerQuery(coreHttp), ...(initialBestSellers ? { initialData: initialBestSellers, staleTime: STALE } : {}) }));
  const items = useMemo(() => reelItems(best.data?.data), [best.data]);
  const pricing = useCardPricing();
  const { quickAdd, notify, feedback } = useQuickAdd();

  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    setSeen(readReelSeen(sessionStore()));
  }, []);
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  const open = (slug: string) => {
    setSeen((prev) => markReelSeen(sessionStore(), prev, slug));
    setOpenSlug(slug);
  };
  const warm = (slug: string) => void qc.prefetchQuery(detailOf(slug));
  const close = () => setOpenSlug(null);
  const fail = () => {
    setOpenSlug(null);
    notify({ ok: false, text: fillCopy('reel.loadError') });
  };
  // Reel có z-index cao hơn bảng chọn phân loại và thông báo: đóng Reel TRƯỚC khi mở chúng (như trang chi tiết).
  // `async` để nút của Reel nhận Promise: khoá của nút chỉ là lớp phòng thủ thêm (Reel đóng ngay dòng đầu nên khung bị gỡ cùng khoá); chặn bấm trùng thật sự là `inFlight` trong `useQuickAdd.run`.
  // Lỗi ném đồng bộ thành Promise bị từ chối, nút ném lại nên vẫn tới `unhandledrejection`.
  const add = async (card: ProductCard, variations: VariationDetail[]) => {
    setOpenSlug(null);
    if (phase === 'guest') {
      // Chỉ nhớ lượt thêm khi khách không phải chọn gì (đúng một phân loại còn hàng): nhiều phân loại thì trang sản phẩm sau đăng nhập để khách tự chọn, không thêm hộ.
      const plan = quickAddPlan(variations);
      if (plan.kind === 'add') rememberPendingAdd({ variationId: plan.variationId, quantity: 1 });
      router.push(loginHref(`/san-pham/${encodeURIComponent(card.slug)}`));
      return;
    }
    // Bảng chọn phân loại mở sẵn ở phân loại mang đúng giá trên nút Reel (Giờ vàng thắng thì phân loại của suất đó).
    await quickAdd(card, { initialId: pricing(card).variationId ?? null });
  };

  const loading = best.isLoading;
  return (
    <>
      {(loading || items.length > 0) && (
        <StoryReelStrip
          items={items.map((c) => ({ slug: c.slug, name: c.name, thumbnail: c.thumbnail, seen: seen.has(c.slug) }))}
          loading={loading && items.length === 0}
          onOpen={open}
          onWarm={warm}
        />
      )}
      {openSlug && (
        <ReelOverlay
          slug={openSlug}
          items={items}
          onGo={(slug) => {
            setSeen((prev) => markReelSeen(sessionStore(), prev, slug));
            setOpenSlug(slug);
          }}
          onClose={close}
          onFail={fail}
          onAdd={add}
        />
      )}
      {feedback}
    </>
  );
}
