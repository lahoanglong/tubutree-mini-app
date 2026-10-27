'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Clock, Leaf, MessageCircle, Megaphone, Repeat, Truck, Users } from 'lucide-react';
import { createGroupBuy } from '@tubutree/app-core/api/groupbuy';
import { affiliateMeQuery } from '@tubutree/app-core/queries/affiliate';
import type { LoyaltyOverview } from '@tubutree/app-core/api/loyalty';
import { couponsQuery, loyaltyQuery } from '@tubutree/app-core/queries/loyalty';
import { Badge } from '@/components/ui/badge';
import { usePdpSelection } from '@/components/pdp-selection';
import { useAuthPhase } from '@/lib/auth-phase';
import { useCartKey } from '@/lib/cart-key';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { soldPercent } from '@/lib/flash-display';
import { cardPricing, variationPricing } from '@/lib/flash-price';
import { pointsEarnPreview, pointsEarnText } from '@/lib/points-earn';
import { loginHref } from '@/lib/return-to';
import { couponLabel, freeshipLine, groupBuyPitch, pdpCoupons, resolveFreeshipFrom } from '@/lib/pdp-logic';
import { platformBridge } from '@/lib/platform-bridge';
import { getCart, getProductStock } from '@/lib/shop-client';
import { useActiveFlashSales } from '@/lib/use-flash-sales';
import { useCountdown } from '@/lib/use-countdown';
import { usePublicConfig } from '@/lib/use-public-config';
import { ui } from '@/lib/guest-ui';
import { ContentKitSheet } from './content-kit-sheet';
import { SubscribeSheet } from './subscribe-sheet';
import { actionErrorText } from '@/lib/error-text';

type PointsEarnProduct = {
  slug: string;
  basePrice: number;
  salePrice?: number | null;
  variations: { id: string; retailPrice: number; salePrice?: number | null }[];
};

/**
 * Hệ số hạng của khách, hoặc null khi chưa biết. Khách chưa đăng nhập thì server tính hệ số 1; tài khoản có hạng chỉ biết được từ
 * tổng quan Điểm Xanh đã tải ở màn khác (không gọi thêm API ở trang đông khách nhất): chưa có thì nói chung thay vì đoán.
 */
function tierMultiplierOf(phase: string, overview: LoyaltyOverview | undefined): number | null {
  if (phase === 'guest') return 1;
  if (phase !== 'authenticated' || !overview) return null;
  return overview.earnMultiplier ?? overview.tier?.multiplier ?? 1;
}

/** Dòng "Nhận … Điểm Xanh" dưới giá, như `PointsEarnLine` của Mini App: giá phân loại đang chọn × số lượng. */
export function PdpPointsEarn({ product }: { product: PointsEarnProduct }) {
  const flash = useActiveFlashSales();
  const selection = usePdpSelection();
  const phase = useAuthPhase();
  const config = usePublicConfig();
  const overview = useQueryClient().getQueryData<LoyaltyOverview>(loyaltyQuery(coreHttp).queryKey);
  const selected = product.variations.find((v) => v.id === selection?.selectedId);
  const unit = selected ? variationPricing(selected, flash).price : cardPricing(product, flash).price;
  const preview = pointsEarnPreview(unit * (selection?.quantity ?? 1), config.loyalty, tierMultiplierOf(phase, overview));
  if (preview === null) return null;
  return (
    <p data-testid="pdp-points-earn" className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-brand)]">
      <Leaf className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
      <span>{preview === 'generic' ? pointsEarnText.generic : pointsEarnText.line(preview.points, preview.valueVnd)}</span>
    </p>
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
    <p data-testid="pdp-freeship" className="mt-2 flex items-start gap-1.5 text-sm font-medium text-forest-700">
      <Truck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{freeshipLine(from)}</span>
    </p>
  );
}

/** Mã giảm giá khách đang có và dùng được cho sản phẩm này; chạm để chép mã (áp ở bước thanh toán). Khách chưa đăng nhập không có ví mã nên không hiện. */
export function PdpCoupons({ productId }: { productId: string }) {
  const phase = useAuthPhase();
  const couponsQ = useQuery({ ...couponsQuery(coreHttp), enabled: phase === 'authenticated' });
  const [note, setNote] = useState<string | null>(null);
  const list = pdpCoupons(couponsQ.data, productId).slice(0, 6);
  if (list.length === 0) return null;

  const onCopy = async (code: string) => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      ok = false;
    }
    setNote(ok ? `Đã chép mã ${code} — mã đã có sẵn trong ví, chọn ở bước thanh toán` : `Mã của bạn: ${code} — chọn ở bước thanh toán`);
  };

  return (
    <div className="mt-3">
      <ul aria-label="Mã giảm giá có thể dùng" className="flex gap-2 pb-1 max-md:flex-col md:grid md:grid-cols-2">
        {list.map((c) => (
          <li key={c.code} className="shrink-0 max-md:min-w-0 max-md:shrink md:min-w-0">
            <button
              type="button"
              aria-label={`Sao chép mã ${c.code}`}
              onClick={() => void onCopy(c.code)}
              className="flex min-h-11 flex-col items-start justify-center gap-0.5 rounded-control border border-dashed border-promo-fg bg-promo-bg px-3 py-1.5 text-left max-md:w-full md:w-full"
            >
              <span className="text-xs font-bold text-promo-fg">
                {c.code} · {couponLabel(c)}
              </span>
              {c.minOrder ? <span className="text-xs text-stone-600">Đơn từ {formatVnd(c.minOrder)}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {note && (
        <p role="status" className="mt-1 text-sm text-success-fg">
          {note}
        </p>
      )}
    </div>
  );
}

/** Đếm ngược và tỉ lệ đã bán của đợt Giờ vàng gắn đúng phân loại đang chọn. Danh sách đợt tự làm mới mỗi 60 giây (`useActiveFlashSales`). */
export function PdpFlashMeta() {
  const flash = useActiveFlashSales();
  const selectedId = usePdpSelection()?.selectedId;
  const item = flash.find((f) => f.variationId === selectedId);
  const left = useCountdown(item?.endAt ?? null);
  if (!item) return null;
  return (
    <p data-testid="pdp-flash-meta" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-stone-600">
      {left && (
        <Badge tone="promo" size="sm" icon={Clock}>
          Còn {left}
        </Badge>
      )}
      {soldPercent(item.soldCount, item.quota) > 0 && <span>Đã bán {soldPercent(item.soldCount, item.quota)}%</span>}
    </p>
  );
}

interface PdpVariation {
  id: string;
  stock: number;
}

/** Dòng "Đặt định kỳ" mở sheet tạo gói; chỉ có với hàng Tubu còn hàng ở phân loại đang chọn. */
export function PdpSubscribeRow({ slug, variations }: { slug: string; variations: PdpVariation[] }) {
  const router = useRouter();
  const phase = useAuthPhase();
  const cfg = usePublicConfig();
  const sel = usePdpSelection();
  const stockQ = useQuery({ queryKey: ['product-stock', slug], queryFn: () => getProductStock(slug), staleTime: 30_000, retry: 0 });
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
    <div className="mt-3">
      <button
        type="button"
        onClick={onClick}
        disabled={create.isPending}
        className="flex min-h-11 w-full items-center gap-3 rounded-control border border-stone-200 bg-stone-0 px-3 py-2.5 text-left disabled:opacity-60"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-forest-50">
          <Users className="h-5 w-5 text-forest-700" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-forest-700">
            {create.isPending ? 'Đang mở nhóm…' : 'Mở nhóm mua chung — nhận mã giảm khi đủ người'}
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
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center gap-3 rounded-control border border-stone-200 bg-stone-0 px-3 py-2.5 text-left"
      >
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
      <Link href={`/ho-tro/chat?product=${encodeURIComponent(productSlug)}`} className={`${ui.btnSecondary} mt-3 gap-2`}>
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
          className={`${ui.btnSecondary} mt-3 gap-2`}
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          Chat với Tubu Tree
        </button>
      )}
      {invite && (
        <Link href={loginHref(`/ho-tro/chat?product=${encodeURIComponent(productSlug)}`)} className={`${ui.btnSecondary} mt-3 gap-2`}>
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          Đăng nhập để chat với Tubu Tree
        </Link>
      )}
    </>
  );
}
