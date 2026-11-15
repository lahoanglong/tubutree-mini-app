'use client';

import { PageHeader } from '@/components/ui/page-header';
import { Suspense, useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowUpRight, Leaf, MapPin, Recycle, Sparkles } from 'lucide-react';
import { fetchProducts, type ProductCard } from '@tubutree/app-core/api/catalog';
import { ProductThumb } from '@/components/mini/product-thumb';
import { Sheet } from '@/components/ui/sheet';
import { BRAND_ORIGINS, brandBrowseTarget, type BrandOrigin } from '@/lib/brand-origins';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { PAGE_WIDE } from '@/lib/page-frame';
import { BrandBadge } from './brand-badge';
import { BrandMap } from './brand-map';
import './brand-theme.css';

/** Điện thoại: chạm nhãn mở tấm chi tiết. Từ md bảng chi tiết nằm cạnh bản đồ nên không mở tấm. Đọc ở lúc chạm (không ở lần dựng đầu) để HTML dựng sẵn khớp khi hydrate. */
const isPhone = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches;

const PROVENANCE_PILLARS = [
  {
    num: '01',
    title: 'Thổ nhưỡng bản địa minh bạch',
    body: 'Tám vùng nguyên liệu trải dài từ Thanh Hóa, Trường Sơn, Tây Nguyên đến miệt vườn Cửu Long.',
    Icon: Leaf,
  },
  {
    num: '02',
    title: 'Chưng cất & lên men tự nhiên',
    body: 'Giữ trọn hoạt chất sinh học từ vỏ dứa, bồ hòn, mật hoa dừa và thảo mộc nguyên bản.',
    Icon: Sparkles,
  },
  {
    num: '03',
    title: 'Thu hồi vỏ chai tuần hoàn',
    body: 'Mỗi vỏ chai sạch gửi kèm đơn hàng tiếp theo được miễn phí vận chuyển và tích Điểm Xanh.',
    Icon: Recycle,
  },
] as const;

const regionSkuCache = new Map<string, ProductCard[]>();

function useRegionProducts(keyword: string): ProductCard[] {
  const [items, setItems] = useState<ProductCard[]>(() => regionSkuCache.get(keyword) ?? []);

  useEffect(() => {
    const cached = regionSkuCache.get(keyword);
    if (cached) {
      setItems(cached);
      return;
    }
    let cancelled = false;
    setItems([]);
    fetchProducts(coreHttp, { page: 1, limit: 4, q: keyword })
      .then((res) => {
        if (cancelled) return;
        const next = Array.isArray(res?.data) ? res.data.slice(0, 4) : [];
        regionSkuCache.set(keyword, next);
        setItems(next);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [keyword]);

  return items;
}

function RegionProductShelf({
  province,
  items,
  headingLevel,
  onNavigate,
}: {
  province: string;
  items: readonly ProductCard[];
  headingLevel: 'h3' | 'h4';
  onNavigate?: () => void;
}) {
  if (items.length === 0) return null;
  const HeadingTag = headingLevel;
  return (
    <div className="mt-5 border-t border-[var(--color-border-subtle)] pt-4" data-testid="brand-region-products">
      <HeadingTag className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
        Sản phẩm tiêu biểu từ {province}
      </HeadingTag>
      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {items.map((p) => {
          const price = p.salePrice ?? p.basePrice;
          return (
            <Link
              key={p.id}
              href={`/san-pham/${p.slug}`}
              onClick={onNavigate}
              className="group flex min-h-11 items-center gap-3 rounded-control border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] p-2.5 transition hover:border-[var(--color-action-secondary-border)] hover:bg-[var(--color-bg-subtle)]"
            >
              <ProductThumb src={p.thumbnail} alt="" size={48} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-xs font-semibold leading-snug text-[var(--color-text-primary)]">
                  {p.name}
                </span>
                <span className="mt-1 flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-[var(--color-text-brand)]">{formatVnd(price)}</span>
                  <span className="inline-flex items-center gap-0.5 font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-brand)]">
                    Xem sản phẩm
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  </span>
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Đọc ?brand= trong một con nhỏ để useSearchParams chỉ làm phần này chờ client, còn cả trang vẫn có trong HTML dựng sẵn. */
function OpenFromQuery({ onOpen }: { onOpen: (o: BrandOrigin) => void }) {
  const brand = useSearchParams()?.get('brand');
  useEffect(() => {
    const match = BRAND_ORIGINS.find((o) => o.id === brand);
    if (match) onOpen(match);
  }, [brand, onOpen]);
  return null;
}

const accent = (id: string) => ({ ['--pin']: `var(--color-brand-${id})` }) as CSSProperties;

/**
 * Hành trình nguyên liệu: bản đồ thực vật học hữu cơ và 8 thẻ nhãn gắn với tỉnh xuất xứ, kèm kệ sản phẩm tiêu biểu thật theo vùng nguyên liệu.
 */
export function BrandStoryView() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const active = BRAND_ORIGINS.find((o) => o.id === selectedId) ?? BRAND_ORIGINS[0]!;
  const regionProducts = useRegionProducts(active.searchKeyword);

  const pick = useCallback((o: BrandOrigin) => {
    setSelectedId(o.id);
    setSheetOpen(isPhone());
  }, []);

  return (
    <main className={`${PAGE_WIDE} pb-10`}>
      <Suspense fallback={null}>
        <OpenFromQuery onOpen={pick} />
      </Suspense>
      <div className="pt-6 max-md:pt-0">
        <PageHeader title="Hành trình nguyên liệu" backHref="/" />
        <p className="mt-3 max-w-3xl leading-relaxed text-[var(--color-text-secondary)] max-md:mt-3 max-md:text-[length:var(--type-body-md-size)] max-md:leading-normal max-md:text-[var(--color-text-secondary)]">
          Mỗi thương hiệu Tubu Tree đều gắn liền với một tỉnh thành Việt Nam. Chạm tên thương hiệu trên bản đồ vùng nguyên liệu Việt Nam để khám phá xuất xứ.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Triết lý tuyển chọn nguyên liệu">
          {PROVENANCE_PILLARS.map(({ num, title, body, Icon }) => (
            <div
              key={num}
              className="rounded-card border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 [box-shadow:var(--elevation-1)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-xs font-semibold tracking-widest text-[var(--color-text-brand)]">
                  CHƯƠNG {num}
                </span>
                <span className="inline-grid h-7 w-7 place-items-center rounded-control bg-[var(--color-bg-subtle)] text-[var(--color-text-brand)]">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
              </div>
              <span className="mt-2 block font-display text-base font-semibold text-[var(--color-text-primary)]">
                {title}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-[var(--color-text-secondary)]">
                {body}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 md:grid md:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] md:items-start md:gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="md:col-start-1 md:row-start-1 lg:row-span-2">
          <BrandMap onPick={pick} activeId={active.id} sheetOpen={sheetOpen} />
        </div>

        <div className="md:col-start-2 md:row-start-1">
          <h2 className={`${ui.sectionTitle} pb-2 pt-4 md:pt-0`}>{BRAND_ORIGINS.length} Thương hiệu & Tỉnh thành xuất xứ</h2>
          <div className="grid grid-cols-2 gap-3 pb-6 md:pb-0 lg:grid-cols-4">
            {BRAND_ORIGINS.map((loc) => (
              <button
                key={loc.id}
                type="button"
                data-testid={`brand-card-${loc.id}`}
                data-active={loc.id === active.id ? 'true' : 'false'}
                onClick={() => pick(loc)}
                style={accent(loc.id)}
                className="flex min-h-11 items-start gap-2.5 rounded-card border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3 text-left text-[var(--color-text-primary)] transition [box-shadow:var(--elevation-1)] active:scale-95 motion-reduce:active:scale-100 md:data-[active=true]:border-[var(--pin)] md:data-[active=true]:bg-[color-mix(in_srgb,var(--pin)_8%,var(--color-bg-surface))]"
              >
                <BrandBadge id={loc.id} className="h-10 w-10" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{loc.brand}</span>
                  <span className="mt-0.5 flex items-start gap-1 text-xs text-[var(--color-text-secondary)]">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{loc.province}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">{loc.ingredient}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <section
          aria-live="polite"
          data-testid="brand-detail"
          style={accent(active.id)}
          className="mt-4 hidden rounded-card border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 [box-shadow:var(--elevation-1)] md:col-span-2 md:row-start-2 md:block lg:col-span-1 lg:col-start-2"
        >
          <div className="flex items-start gap-4">
            <BrandBadge id={active.id} className="h-20 w-20" />
            <div className="min-w-0 flex-1">
              <span className="inline-flex items-center gap-1 rounded-pill bg-[var(--color-bg-subtle)] px-2.5 py-0.5 text-xs font-semibold text-[var(--color-text-brand)]">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                Vùng nguyên liệu · {active.province}
              </span>
              <h3 className={`${ui.blockTitle} mt-1.5 font-display`}>{active.brand}</h3>
              <p className="mt-1 text-sm font-medium text-[var(--color-text-secondary)]">{active.ingredient}</p>
            </div>
          </div>
          <p className="mt-4 leading-relaxed text-[var(--color-text-primary)]">{active.story}</p>
          <Link href={brandBrowseTarget(active, '/san-pham')} data-testid="brand-detail-cta" className={`${ui.btnPrimary} mt-4`}>
            Khám phá sản phẩm {active.brand}
          </Link>
          <RegionProductShelf province={active.province} items={regionProducts} headingLevel="h4" />
        </section>
      </div>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={active.brand}>
        <div className="flex items-center gap-3">
          <BrandBadge id={active.id} className="h-16 w-16" />
          <p className="flex min-w-0 items-center gap-1 text-sm text-[var(--color-text-secondary)]">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {active.province} · {active.ingredient}
          </p>
        </div>
        <p className="mt-4 leading-relaxed text-[var(--color-text-primary)]">{active.story}</p>
        <Link href={brandBrowseTarget(active, '/san-pham')} onClick={() => setSheetOpen(false)} className={`${ui.btnPrimary} mt-4 w-full`}>
          Khám phá sản phẩm {active.brand}
        </Link>
        <RegionProductShelf
          province={active.province}
          items={regionProducts}
          headingLevel="h3"
          onNavigate={() => setSheetOpen(false)}
        />
      </Sheet>
    </main>
  );
}
