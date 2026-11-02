'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Leaf, MessageCircle, Megaphone, Repeat, Ticket, Truck, Users } from 'lucide-react';
import { offerAmount, offerRows } from '@tubutree/app-core/commerce/voucher-picker';
import { stockText } from '@tubutree/app-core/commerce/stock-text';
import { serverNow } from '@tubutree/app-core/server-clock';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { createGroupBuy } from '@tubutree/app-core/api/groupbuy';
import { affiliateMeQuery } from '@tubutree/app-core/queries/affiliate';
import { couponsQuery } from '@tubutree/app-core/queries/loyalty';
import { autoCouponName } from '@/lib/coupon-name';
import { BottomSheet } from '@/components/mini/bottom-sheet';
import { FlashPriceBar } from '@/components/mini/flash-price-bar';
import { GameNoticeBar, useGameNotice } from '@/components/game/game-notice';
import { Icon } from '@/components/mini/icon';
import { ListRow } from '@/components/mini/list-row';
import { VoucherTicket } from '@/components/mini/voucher-ticket';
import { usePdpSelection } from '@/components/pdp-selection';
import { LOW_STOCK_NOTICE, useProductStock } from '@/components/pdp-stock';
import { tierEarnOf } from '@tubutree/app-core/points-earn-tier';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { useCartKey } from '@/lib/cart-key';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { soldPercent } from '@/lib/flash-display';
import { cardPricing, runningFlash, variationPricing } from '@/lib/flash-price';
import { pointsEarnPreview, pointsEarnText } from '@/lib/points-earn';
import { pointsEarnPopup, POINTS_EARN_POPUP } from '@tubutree/app-core/points-earn-popup';
import { percentLabel, pointsBoostOf } from '@/lib/points-boost';
import { pointsBoostText } from '@/lib/home-text';
import { loginHref } from '@/lib/return-to';
import { freeshipLine, groupBuyPitch, pdpCoupons, resolveFreeshipFrom } from '@/lib/pdp-logic';
import { platformBridge } from '@/lib/platform-bridge';
import { getCart } from '@/lib/shop-client';
import { useActiveFlashSales } from '@/lib/use-flash-sales';
import { useFlashListExpiry } from '@/lib/use-flash-expiry';
import { usePublicConfig } from '@/lib/use-public-config';
import { ui } from '@/lib/guest-ui';
import { mini } from '@/components/order-mobile/mobile-ui';
import { ContentKitSheet } from './content-kit-sheet';
import { SubscribeSheet } from './subscribe-sheet';
import { PointsEarnSheet } from './points-earn-sheet';
import { actionErrorText } from '@/lib/error-text';
import { phoneBand, phoneBrandLabel } from '@/lib/phone-ui';

type PointsEarnProduct = {
  slug: string;
  basePrice: number;
  salePrice?: number | null;
  variations: { id: string; retailPrice: number; salePrice?: number | null }[];
};

/** Tiền hàng của món đang xem: giá phân loại đang chọn (đã tính Giờ vàng) × số lượng; chưa chọn thì giá thẻ × 1. */
function usePdpPricing(product: PointsEarnProduct): { amount: number; isFlash: boolean; unit: number; quantity: number } {
  const flash = runningFlash(useActiveFlashSales());
  useFlashListExpiry(flash);
  const selection = usePdpSelection();
  const selected = product.variations.find((v) => v.id === selection?.selectedId);
  const { price: unit, isFlash } = selected ? variationPricing(selected, flash) : cardPricing(product, flash);
  const quantity = selection?.quantity ?? 1;
  return { amount: unit * quantity, isFlash, unit, quantity };
}
const usePdpAmount = (product: PointsEarnProduct): number => usePdpPricing(product).amount;

/**
 * Hệ số hạng của khách, hoặc null khi chưa biết. Khách chưa đăng nhập thì server tính hệ số 1; tài khoản có hạng lấy hệ số từ
 * bảng hạng trong config công khai theo `tierId` của chính họ (không gọi thêm API, không phụ thuộc tổng quan Điểm Xanh đã tải).
 */
function tierEarnFor(phase: string, tierId: string | null | undefined, loyalty: Parameters<typeof tierEarnOf>[0]) {
  if (phase === 'guest') return { multiplier: 1, tierName: null };
  if (phase !== 'authenticated') return null;
  return tierEarnOf(loyalty, tierId);
}

/** Dòng "Nhận … Điểm Xanh" dưới giá, như `PointsEarnLine` của Mini App: giá phân loại đang chọn × số lượng. */
export function PdpPointsEarn({ product }: { product: PointsEarnProduct }) {
  const amount = usePdpAmount(product);
  const phase = useAuthPhase();
  const config = usePublicConfig();
  const { user } = useAuth();
  const tier = tierEarnFor(phase, user?.tierId, config.loyalty);
  const preview = pointsEarnPreview(amount, config.loyalty, tier?.multiplier ?? null);
  const [open, setOpen] = useState(false);
  if (preview === null) return null;
  const text = preview === 'generic' ? pointsEarnText.generic : pointsEarnText.line(preview.points);
  const boost = pointsBoostOf(config.isLoaded ? config.loyalty : undefined);
  const popup = pointsEarnPopup({
    tier,
    guest: phase === 'guest',
    generic: preview === 'generic',
    marketplace: boost?.kind === 'compare' ? pointsBoostText.sub(percentLabel(boost.marketplacePct), percentLabel(boost.appPct)) : null,
  });
  return (
    <>
      <button
        type="button"
        data-testid="pdp-points-earn"
        aria-label={`${text}. ${POINTS_EARN_POPUP.rowAria}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="-mt-[22px] flex min-h-11 items-end gap-1.5 text-left text-xs font-semibold text-[var(--color-text-brand)]"
      >
        <Leaf className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
        <span>{text}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </button>
      <PointsEarnSheet open={open} onClose={() => setOpen(false)} popup={popup} />
    </>
  );
}

/** Mở lại sheet Đặt định kỳ sau khi khách đăng nhập xong và quay về trang. */
const RESUME_PARAM = 'tiep';
const RESUME_SUBSCRIBE = 'dinh-ky';

const pagePath = (slug: string) => `/san-pham/${encodeURIComponent(slug)}`;

function offlineMessage(what: string): string {
  return `Chưa kết nối được tới Tubu Tree nên chưa ${what}. Bạn kiểm tra mạng rồi bấm lại nhé.`;
}

/** Dòng freeship: tín hiệu vận chuyển ngay chỗ quyết định mua. Hàng gian hàng tự giao không có freeship của Tubu nên trang cha ẩn đi. */
export function PdpFreeship() {
  const phase = useAuthPhase();
  const cfg = usePublicConfig();
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: phase === 'authenticated' });
  const from = resolveFreeshipFrom({
    phase,
    cartThreshold: cartQ.data?.freeshipThreshold,
    configThreshold: cfg.freeshipThreshold,
    configLoaded: cfg.isLoaded,
  });
  if (from == null) return null;
  return (
    <p data-testid="pdp-freeship" className={`text-sm font-medium text-forest-700 ${phoneBrandLabel}`}>
      {freeshipLine(from)}
    </p>
  );
}

/**
 * Dòng "Vận chuyển ›": ai giao và freeship, ngắn. Hàng Tubu bấm cuộn tới Cam kết Tubu; hàng gian hàng tự giao không có cam kết đó nên dòng chỉ
 * để đọc (không bấm, không "›"). Lưu ý dài và thông báo tạm nghỉ do trang cha dựng ngoài dòng. Nội dung nhận qua `children`.
 * Luôn là hàng thông tin cuối nên không kẻ đường dưới (sau nó là chip phân loại, Mini cũng không kẻ ở hàng cuối).
 */
export function PdpShippingRow({ children, pressable = true }: { children: ReactNode; pressable?: boolean }) {
  return (
    <ListRow
      icon={<Icon icon={Truck} size="md" tone="brand" />}
      title={fillCopy('pdp.shipping')}
      subtitle={<div className="flex flex-col gap-1 max-md:gap-0 md:flex-row md:flex-wrap md:items-baseline md:gap-x-3 md:gap-y-0">{children}</div>}
      trailing={pressable ? 'chevron' : undefined}
      onPress={pressable ? () => document.getElementById('pdp-promises')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) : undefined}
    />
  );
}

/**
 * Dòng "Ưu đãi ›" ghi số mã khách đang có và dùng được cho sản phẩm này; bấm mở hộp thoại mã, chép mã (áp ở bước thanh toán, một đơn một mã).
 * Khách chưa đăng nhập không có ví mã nên không hiện. `divider`: đường kẻ dưới hàng chỉ có khi sau nó còn hàng "Vận chuyển" (Mini kẻ giữa các hàng, hàng cuối không kẻ).
 */
export function PdpCoupons({ productId, product, divider = true }: { productId: string; product: PointsEarnProduct; divider?: boolean }) {
  const phase = useAuthPhase();
  const couponsQ = useQuery({ ...couponsQuery(coreHttp), enabled: phase === 'authenticated' });
  const pricing = usePdpPricing(product);
  const amount = offerAmount(pricing.unit, pricing.quantity, pricing.isFlash);
  const [open, setOpen] = useState(false);
  const { notice, notify } = useGameNotice();
  const list = pdpCoupons(couponsQ.data, productId);
  if (list.length === 0) return null;

  const onCopy = async (code: string) => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      ok = false;
    }
    // Thông báo nổi như snackbar của Mini App: một dòng trong hộp thoại sẽ làm hộp cao thêm mỗi lần chép.
    notify(fillCopy(ok ? 'coupon.copiedToast' : 'coupon.copyShowToast', { code }), ok ? 'success' : 'info');
  };

  const rows = offerRows(list, { amount, now: serverNow(), displayCode: autoCouponName });
  return (
    <>
      <ListRow
        icon={<Icon icon={Ticket} size="md" tone="brand" />}
        title={fillCopy('pdp.offers')}
        subtitle={fillCopy('pdp.offerCount', { n: list.length })}
        trailing="chevron"
        onPress={() => setOpen(true)}
        style={divider ? { boxShadow: 'inset 0 -1px 0 var(--color-border-subtle)' } : undefined}
      />
      <BottomSheet open={open} onClose={() => setOpen(false)} title={fillCopy('coupon.title')}>
        <div className="flex flex-col">
          {rows.map((r) => (
            <VoucherTicket
              key={r.coupon.code}
              variant="row"
              voucher={r.view}
              reason={r.reason ?? undefined}
              primary={{ label: fillCopy('coupon.copy'), onClick: () => void onCopy(r.coupon.code) }}
            />
          ))}
        </div>
        <p className="mt-3 text-caption text-[color:var(--color-text-tertiary)]">{fillCopy('coupon.oneCodeHint')}</p>
        {/* Vùng đọc cố định, luôn có mặt và trống lúc mở sheet: thông báo nổi nằm ngoài hộp thoại aria-modal nên trình đọc màn hình không nghe được; sr-only không làm sheet cao thêm. */}
        <p role="status" aria-live="polite" data-testid="pdp-coupon-live" className="sr-only">
          {/* Khoá theo lần bấm: chép cùng mã hai lần trong 4 giây thì chữ y hệt, React không đổi DOM và trình đọc im lần hai; nút con gắn lại thì lần nào cũng nghe. */}
          {notice && <span key={notice.id}>{notice.text}</span>}
        </p>
      </BottomSheet>
      <GameNoticeBar notice={notice} overSheet visualOnly />
    </>
  );
}

/**
 * Thanh Giờ vàng dưới ảnh: giá deal, -%, "Kết thúc sau …", đã bán % của đợt gắn đúng phân loại đang chọn. Danh sách đợt tự làm mới mỗi
 * 60 giây (`useActiveFlashSales`); hết giờ khi khách đang xem thì thanh biến mất đúng mốc, trang quay về giá thường không cần tải lại.
 */
export function PdpFlashBar({ product }: { product: { variations: { id: string; retailPrice: number; salePrice?: number | null }[] } }) {
  const flash = runningFlash(useActiveFlashSales());
  useFlashListExpiry(flash);
  const selectedId = usePdpSelection()?.selectedId;
  const item = flash.find((f) => f.variationId === selectedId);
  const selected = product.variations.find((v) => v.id === selectedId);
  if (!item || !selected) return null;
  const pricing = variationPricing(selected, flash);
  if (!pricing.isFlash) return null;
  return (
    <FlashPriceBar
      price={pricing.price}
      compareAt={pricing.hasSale ? pricing.originalPrice : null}
      pct={pricing.salePct}
      endAt={item.endAt}
      soldPct={soldPercent(item.soldCount, item.quota)}
      soldOut={item.soldCount >= item.quota}
      perUserLimit={item.perUserLimit}
      // Máy tính: dải bo góc như ảnh và cách ảnh một nhịp; giá deal đã ở cột thông tin (PdpPrice) nên dòng giá của dải ẩn từ lg.
      className="md:mt-3 md:rounded-sheet"
      priceRowClassName="lg:hidden"
    />
  );
}

/**
 * "Đã bán 1,2k+" nằm bên phải dòng giá. Phân loại đang Giờ vàng thì dòng giá trống (giá lên thanh Giờ vàng dưới ảnh), nên số này dời lên
 * dòng đánh giá thay vì để một dòng gần như trống chiếm chỗ (khung 1280×800 rất sát). Server chưa biết Giờ vàng nên HTML đầu vẫn ở dòng giá.
 */
export function PdpSold({ text, product, slot }: { text: string; product: { variations: { id: string; retailPrice: number; salePrice?: number | null }[] }; slot: 'price' | 'rating' }) {
  const flash = runningFlash(useActiveFlashSales());
  useFlashListExpiry(flash);
  const selectedId = usePdpSelection()?.selectedId;
  const selected = product.variations.find((v) => v.id === selectedId);
  const isFlash = selected ? variationPricing(selected, flash).isFlash : false;
  if ((slot === 'rating') !== isFlash) return null;
  return <span className={slot === 'price' ? 'mt-2 text-sm text-stone-500 max-md:ml-auto max-md:text-xs' : 'text-sm text-stone-500 max-md:text-xs'}>{text}</span>;
}

interface PdpVariation {
  id: string;
  stock: number;
}

/**
 * "Còn N sản phẩm" của phân loại đang chọn, dưới dòng Điểm Xanh, đúng chữ của Mini App (`vi.product.lowStock`, D2 chốt "Còn {n} sản phẩm").
 * Máy tính có dòng cùng chữ trong khối mua (`AddToCart`, ngay dưới chip), nên bản này ẩn từ md.
 * Cùng ngưỡng và cùng tồn kho thật với bản trong khối mua.
 */
export function PdpLowStock({ slug, variations }: { slug: string; variations: { id: string; stock: number }[] }) {
  const sel = usePdpSelection();
  const stockQ = useProductStock(slug);
  const selected = variations.find((v) => v.id === sel?.selectedId);
  const stock = selected ? (stockQ.data?.[selected.id] ?? selected.stock) : 0;
  if (stock <= 0 || stock > LOW_STOCK_NOTICE) return null;
  return (
    <p data-testid="pdp-low-stock" className="mt-1 text-xs font-medium text-warning-fg md:hidden">
      {stockText(stock)}
    </p>
  );
}

/** Dòng "Đặt định kỳ" mở sheet tạo gói; chỉ có với hàng Tubu còn hàng ở phân loại đang chọn. */
export function PdpSubscribeRow({ slug, variations }: { slug: string; variations: PdpVariation[] }) {
  const router = useRouter();
  const phase = useAuthPhase();
  const cfg = usePublicConfig();
  const sel = usePdpSelection();
  const stockQ = useProductStock(slug);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = variations.find((v) => v.id === sel?.selectedId);
  const stock = selected ? (stockQ.data?.[selected.id] ?? selected.stock) : 0;

  useEffect(() => {
    if (phase !== 'authenticated') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get(RESUME_PARAM) !== RESUME_SUBSCRIBE) return;
    url.searchParams.delete(RESUME_PARAM);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    setOpen(true);
  }, [phase]);

  if (!selected || stock <= 0) return null;

  const onClick = () => {
    setNotice(null);
    setError(null);
    if (phase === 'loading') return;
    if (phase === 'unavailable') {
      setError(offlineMessage('đặt định kỳ được'));
      return;
    }
    if (phase === 'guest') {
      router.push(loginHref(`${pagePath(slug)}?${RESUME_PARAM}=${RESUME_SUBSCRIBE}`));
      return;
    }
    setOpen(true);
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-11 w-full items-center gap-2 rounded-control border border-dashed border-forest-600 bg-forest-50 px-3 py-2.5 text-left"
      >
        <Repeat className="h-[18px] w-[18px] shrink-0 text-forest-700" aria-hidden="true" />
        <span className="flex-1 text-sm font-semibold text-forest-700">Đặt định kỳ — tiết kiệm {Math.round(cfg.subscribeDiscountPct * 100)}%</span>
        <ChevronRight className="h-[18px] w-[18px] shrink-0 text-forest-700" aria-hidden="true" />
      </button>
      {notice && (
        <p role="status" className="mt-1 text-sm text-success-fg">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className={`mt-1 ${ui.error}`}>
          {error}
        </p>
      )}
      <SubscribeSheet
        visible={open}
        onClose={() => setOpen(false)}
        onNotice={setNotice}
        variationId={selected.id}
        quantity={Math.min(sel?.quantity ?? 1, Math.max(1, stock))}
      />
    </div>
  );
}

/**
 * Hàng bấm cuối khối mua (nhóm mua chung, nội dung bán hàng). Máy tính: ô viền bo; điện thoại: dải trắng riêng cách dải trên 8px,
 * hàng bấm không viền như Box p=4 của Mini App.
 */
const bandRow = `mt-3 ${phoneBand}`;
const rowButton =
  'flex min-h-11 w-full items-center gap-3 rounded-control border border-stone-200 bg-stone-0 px-3 py-2.5 text-left max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0';

/** "Mở nhóm mua chung": tạo nhóm rồi sang trang nhóm để rủ bạn. Chưa đăng nhập thì sang đăng nhập và quay lại trang này. */
export function PdpGroupBuyRow({ productId, slug }: { productId: string; slug: string }) {
  const router = useRouter();
  const phase = useAuthPhase();
  const cfg = usePublicConfig();
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => createGroupBuy(coreHttp, productId),
    onSuccess: (group) => router.push(`/mua-chung/${encodeURIComponent(group.id)}?moi=1`),
    onError: (e: unknown) => setError(actionErrorText(e)),
  });

  const onClick = () => {
    if (create.isPending || phase === 'loading') return;
    setError(null);
    if (phase === 'unavailable') {
      setError(offlineMessage('mở nhóm mua chung được'));
      return;
    }
    if (phase === 'guest') {
      router.push(loginHref(pagePath(slug)));
      return;
    }
    create.mutate();
  };

  return (
    <div className={bandRow}>
      <button
        type="button"
        onClick={onClick}
        disabled={create.isPending}
        className={`${rowButton} disabled:opacity-60`}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-forest-50">
          <Users className="h-5 w-5 text-forest-700" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-forest-700">
            {create.isPending ? 'Đang mở nhóm…' : 'Mở nhóm mua chung — nhận mã giảm giá khi đủ người'}
          </span>
          <span className="block text-xs text-stone-600">{groupBuyPitch(cfg.groupBuy)}</span>
        </span>
        <ChevronRight className="h-[18px] w-[18px] shrink-0 text-forest-700" aria-hidden="true" />
      </button>
      {error && (
        <p role="alert" className={`mt-1 ${ui.error}`}>
          {error}
        </p>
      )}
    </div>
  );
}

/** "Nội dung bán hàng" cho cộng tác viên đang xem sản phẩm để đi đăng bài; người khác không thấy. */
export function PdpContentKitRow({ slug }: { slug: string }) {
  const phase = useAuthPhase();
  const [open, setOpen] = useState(false);
  const meQ = useQuery({ ...affiliateMeQuery(coreHttp), enabled: phase === 'authenticated', staleTime: 5 * 60_000 });
  if (meQ.data?.isAffiliate !== true) return null;
  return (
    <div className={bandRow}>
      <button type="button" onClick={() => setOpen(true)} className={rowButton}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-forest-50">
          <Megaphone className="h-5 w-5 text-forest-700" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-forest-700">Nội dung bán hàng</span>
          <span className="block text-xs text-stone-600">Bài mẫu đã gắn sẵn link giới thiệu của bạn — chép là đăng được</span>
        </span>
        <ChevronRight className="h-[18px] w-[18px] shrink-0 text-forest-700" aria-hidden="true" />
      </button>
      <ContentKitSheet visible={open} onClose={() => setOpen(false)} productSlug={slug} />
    </div>
  );
}

/**
 * Chat với Tubu Tree. Chat bật và đã đăng nhập: vào màn chat kèm sản phẩm; chưa đăng nhập: giữ nút OA và mời đăng nhập;
 * đang khôi phục phiên: chỉ nút OA. Chat tắt: như trước, chỉ Zalo OA (web chỉ mở trang OA, không gắn sẵn nội dung tin nhắn).
 */
export function PdpChatButton({ productName, productSlug }: { productName: string; productSlug: string }) {
  const phase = useAuthPhase();
  const chatOn = usePublicConfig().chat?.enabled === true;
  const chatReady = chatOn && phase === 'authenticated';
  const oa = platformBridge.oa.available;
  if (chatReady) {
    return (
      <Link href={`/ho-tro/chat?product=${encodeURIComponent(productSlug)}`} className={`${ui.btnSecondary} ${mini.secondary} mt-3 gap-2`}>
        <MessageCircle className="h-4 w-4" aria-hidden="true" />
        Chat với Tubu Tree
      </Link>
    );
  }
  const invite = chatOn && phase === 'guest';
  if (!oa && !invite) return null;
  return (
    <>
      {oa && (
        <button
          type="button"
          onClick={() => void platformBridge.oa.openChat(`Mình muốn hỏi về sản phẩm: ${productName}`)}
          className={`${ui.btnSecondary} ${mini.secondary} mt-3 gap-2`}
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          Chat với Tubu Tree
        </button>
      )}
      {invite && (
        <Link href={loginHref(`/ho-tro/chat?product=${encodeURIComponent(productSlug)}`)} className={`${ui.btnSecondary} ${mini.secondary} mt-3 gap-2`}>
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          Đăng nhập để chat với Tubu Tree
        </Link>
      )}
    </>
  );
}
