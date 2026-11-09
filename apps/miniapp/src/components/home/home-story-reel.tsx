import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { markReelSeen, readReelSeen, reelDisabled, reelItems, reelNeighbor } from '@tubutree/app-core/commerce/story-reel';
import { QUICK_ADD_SOLD_OUT, quickAddPlan } from '@tubutree/app-core/quick-add';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useNotify } from '../../hooks/use-notify';
import { useAuthPhase } from '../../hooks/use-auth-phase';
import { useFlashAllowance } from '../../hooks/use-flash-allowance';
import { useLoginWithNotice } from '../../hooks/use-login-notice';
import { getErrorMessage } from '../../services/api';
import { cartKey, useCartKey } from '../../services/cart-key';
import { addToCart, fetchActiveFlashSales, fetchProduct, getCart, type ProductCard, type VariationDetail } from '../../services/shop-api';
import { useAuthStore } from '../../store/auth';
import { vi } from '../../i18n/vi';
import { cardAddTarget } from '../../utils/card-add-target';
import { formatVnd } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import { reelSeenStorage } from '../../utils/reel-seen-storage';
import { serverNow } from '../../utils/server-clock';
import { Icon } from '../ui/icon';
import { StoryReelStrip } from '../ui/story-reel-strip';
import { homeBestSellerQuery } from './home-best-seller-query';
import '../../css/story-reel.css';

// Khung Reel và bảng chọn phân loại chỉ dựng khi khách chạm một vòng: nạp lười để gói đầu của Trang chủ không gánh chúng.
const ProductStoryShowcase = lazy(() => import('../ui/product-story-showcase').then((m) => ({ default: m.ProductStoryShowcase })));
const VariationSheet = lazy(() => import('../variation-sheet').then((m) => ({ default: m.VariationSheet })));

/** Chi tiết món dùng chung khoá với trang chi tiết (`['product', slug]`): mở Reel rồi vào trang chi tiết không tải lại. */
const DETAIL_STALE_MS = 60_000;
const detailQuery = (slug: string) => ({ queryKey: ['product', slug] as const, queryFn: () => fetchProduct(slug), staleTime: DETAIL_STALE_MS });
const FLASH_STALE_MS = 30_000;
/** Cùng nhịp với Giỏ và Duyệt: khối này gắn sau khi kệ Bán chạy nhất đã tải xong, nên không có khoảng này nó sẽ tải lại ngay lúc gắn (một request thừa mỗi lần vào Trang chủ). */
const BEST_STALE_MS = 60_000;

/** Khung toàn màn tối giản trong lúc tải chi tiết món (hoặc nạp mã của khung Reel): vẫn có nút đóng đủ vùng chạm và khoá cuộn nền. */
function ReelWait({ onClose }: { onClose: () => void }) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    // Nhớ vòng đã chạm để trả focus khi khung chờ biến mất (Reel thật hoặc đóng): không có thì focus rơi về body và khung Reel thật nhớ nhầm body.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (opener && opener !== document.body && opener.isConnected) opener.focus();
    };
  }, []);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-busy="true" aria-label={fillCopy('story.title')} data-testid="reel-wait" className="tubu-reel-wait">
      <div className="tubu-reel-wait-head">
        <button ref={closeBtn} type="button" data-testid="reel-wait-close" aria-label={fillCopy('story.close')} className="tubu-reel-wait-close tubu-press tubu-hit-44-square" onClick={onClose}>
          <Icon icon={X} size="md" />
        </button>
      </div>
      <div className="tubu-reel-wait-body">
        <div className="tubu-skeleton tubu-reel-wait-stage" />
      </div>
    </div>,
    document.body,
  );
}

interface ReelOverlayProps {
  slug: string;
  cards: readonly ProductCard[];
  flash: Parameters<typeof cardAddTarget>[1];
  onShow: (slug: string) => void;
  onClose: () => void;
  onAdd: (card: ProductCard, variations: VariationDetail[]) => void | Promise<unknown>;
}

/** Một Reel đang mở: tải chi tiết món, tải trước món kế, tự nhảy qua món Admin tắt câu chuyện, và vẽ khung toàn màn của `ProductStoryShowcase`. */
function ReelOverlay({ slug, cards, flash, onShow, onClose, onAdd }: ReelOverlayProps) {
  const queryClient = useQueryClient();
  const { notify } = useNotify();
  const detailQ = useQuery(detailQuery(slug));
  const slugs = useMemo(() => cards.map((c) => c.slug), [cards]);
  const next = reelNeighbor(slugs, slug, 1);
  const detail = detailQ.data;
  const skip = detail ? reelDisabled(detail) : false;
  const show = useRef(onShow);
  show.current = onShow;
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (next) void queryClient.prefetchQuery(detailQuery(next));
  }, [next, queryClient]);
  useEffect(() => {
    if (!skip) return;
    if (next) show.current(next);
    else close.current();
  }, [skip, next]);
  useEffect(() => {
    if (!detailQ.isError) return;
    notify({ text: fillCopy('reel.loadError'), type: 'error' });
    close.current();
  }, [detailQ.isError, notify]);

  const card = cards.find((c) => c.slug === slug);
  if (!detail || skip || !card) return <ReelWait onClose={onClose} />;
  const soldOut = quickAddPlan(detail.variations).kind === 'soldOut';
  return (
    <Suspense fallback={<ReelWait onClose={onClose} />}>
      <ProductStoryShowcase
        key={slug}
        fullscreen
        reel
        product={detail}
        buyDisabled={soldOut}
        addPrice={formatVnd(cardAddTarget(card, flash, serverNow()).price)}
        position={fillCopy('reel.position', { n: slugs.indexOf(slug) + 1, total: slugs.length })}
        onNext={next ? () => onShow(next) : undefined}
        // Đóng khung trước: nó nằm trên bảng chọn phân loại và thông báo (z-index cao hơn modal của zmp-ui).
        onAddToCart={() => onAdd(card, detail.variations)}
        onClose={onClose}
      />
    </Suspense>
  );
}

/** Bảng chọn phân loại khi phân loại đại diện của thẻ vừa hết hàng mà sản phẩm còn phân loại khác (cùng bảng với giỏ nhanh ở Yêu thích). */
function ReelVariationPicker({ card, variations, initialId, onClose, onConfirm }: { card: ProductCard; variations: VariationDetail[]; initialId: string | null; onClose: () => void; onConfirm: (id: string, qty: number) => Promise<void> }) {
  const phase = useAuthPhase();
  const flashQ = useQuery({ queryKey: ['flash-sales', 'active'], queryFn: fetchActiveFlashSales, staleTime: FLASH_STALE_MS });
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: phase === 'authenticated' });
  const flash = useFlashAllowance(flashQ.data, variations.map((v) => v.id));
  const [busy, setBusy] = useState(false);
  return (
    <Suspense fallback={null}>
      <VariationSheet
        open
        onClose={onClose}
        mode="add"
        productName={card.name}
        thumbnail={card.thumbnail}
        variations={variations}
        flash={flash}
        initialId={initialId}
        initialQty={1}
        busy={busy}
        cartLines={cartQ.data?.items}
        onConfirm={async (v, qty) => {
          setBusy(true);
          try {
            await onConfirm(v.id, qty);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Suspense>
  );
}

/**
 * Khối `stories` của Trang chủ: dải vòng Story lấy từ Bán chạy nhất THÔ (cùng khoá query với kệ Bán chạy nhất, không chống trùng, không chiếm món của kệ nào), chạm một vòng
 * mở Reel toàn màn của món đó. Chưa có dữ liệu thì khung chờ cao đúng khối thật; lỗi hoặc dưới `REEL_MIN_ITEMS` món thì không vẽ gì. "Đã xem" nhớ theo phiên.
 */
export function HomeStoryReel() {
  const queryClient = useQueryClient();
  const { notify } = useNotify();
  const loginWithNotice = useLoginWithNotice();
  const best = useQuery({ ...homeBestSellerQuery, staleTime: BEST_STALE_MS });
  const flashQ = useQuery({ queryKey: ['flash-sales', 'active'], queryFn: fetchActiveFlashSales, staleTime: FLASH_STALE_MS });
  const items = useMemo(() => reelItems(best.data?.data), [best.data]);
  const store = useMemo(() => reelSeenStorage(), []);
  const [seen, setSeen] = useState(() => readReelSeen(store));
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ card: ProductCard; variations: VariationDetail[]; initialId: string | null } | null>(null);
  const adding = useRef(new Set<string>());

  const warm = useCallback(
    (slug: string) => {
      void queryClient.prefetchQuery(detailQuery(slug));
    },
    [queryClient],
  );
  const show = useCallback(
    (slug: string) => {
      setSeen((prev) => markReelSeen(store, prev, slug));
      setOpenSlug(slug);
    },
    [store],
  );
  const stripItems = useMemo(() => items.map((c) => ({ slug: c.slug, name: c.name, thumbnail: c.thumbnail, seen: seen.has(c.slug) })), [items, seen]);

  const addLine = async (variationId: string, qty: number) => {
    try {
      const cart = await addToCart(variationId, qty);
      queryClient.setQueryData(cartKey(), cart);
      haptic('medium');
      notify({ text: vi.product.added, type: 'success', duration: 2000, position: 'top' });
    } catch (e) {
      notify({ text: getErrorMessage(e), type: 'error' });
    }
  };

  // Khoá đổi đồng bộ và theo từng món: hai cú chạm sát nhau chạy trước lần dựng lại kế tiếp nên vẫn thấy nút và bảng còn mở, còn món khác không bị chặn.
  const exclusive = async (slug: string, run: () => Promise<void>) => {
    if (adding.current.has(slug)) return;
    adding.current.add(slug);
    try {
      await run();
    } finally {
      adding.current.delete(slug);
    }
  };

  const addFromReelOnce = async (card: ProductCard, variations: VariationDetail[]) => {
    setOpenSlug(null);
    if (useAuthStore.getState().status !== 'authenticated') {
      await loginWithNotice();
      if (useAuthStore.getState().status !== 'authenticated') return;
    }
    const plan = quickAddPlan(variations);
    if (plan.kind === 'soldOut') {
      notify({ text: QUICK_ADD_SOLD_OUT, type: 'error' });
      return;
    }
    if (plan.kind === 'add') await addLine(plan.variationId, 1);
    // Bảng mở sẵn ở phân loại mang đúng giá trên nút Reel (Giờ vàng thắng thì phân loại của suất đó), không phải phân loại đại diện.
    else setPicker({ card, variations, initialId: cardAddTarget(card, flashQ.data ?? [], serverNow()).variationId });
  };

  const addFromReel = (card: ProductCard, variations: VariationDetail[]) => exclusive(card.slug, () => addFromReelOnce(card, variations));

  if (best.isLoading) return <StoryReelStrip items={[]} loading onOpen={show} />;
  if (items.length === 0) return null;
  return (
    <>
      <StoryReelStrip items={stripItems} onOpen={show} onWarm={warm} />
      {openSlug && <ReelOverlay slug={openSlug} cards={items} flash={flashQ.data ?? []} onShow={show} onClose={() => setOpenSlug(null)} onAdd={addFromReel} />}
      {picker && (
        <ReelVariationPicker
          card={picker.card}
          variations={picker.variations}
          initialId={picker.initialId}
          onClose={() => setPicker(null)}
          onConfirm={(id, qty) =>
            exclusive(picker.card.slug, async () => {
              await addLine(id, qty);
              setPicker(null);
            })
          }
        />
      )}
    </>
  );
}
