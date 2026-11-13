'use client';

import { PageHeader } from '@/components/ui/page-header';
import { Suspense, useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MapPin } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { BRAND_ORIGINS, brandBrowseTarget, type BrandOrigin } from '@/lib/brand-origins';
import { ui } from '@/lib/guest-ui';
import { PAGE_WIDE } from '@/lib/page-frame';
import { BrandBadge } from './brand-badge';
import { BrandMap } from './brand-map';
import './brand-theme.css';

/** Điện thoại: chạm nhãn mở tấm chi tiết. Từ md bảng chi tiết nằm cạnh bản đồ nên không mở tấm. Đọc ở lúc chạm (không ở lần dựng đầu) để HTML dựng sẵn khớp khi hydrate. */
const isPhone = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches;

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
 * Hành trình nguyên liệu: bản đồ chú thích và 8 thẻ nhãn gắn với tỉnh xuất xứ. Điện thoại: chạm mở tấm câu chuyện kèm lối sang sản phẩm của nhãn.
 * Từ md: Master–Detail, thẻ chọn nhãn ở trên và bảng chi tiết của nhãn đang chọn ngay dưới (mặc định nhãn đầu hoặc `?brand=`); bản đồ và thẻ dùng chung nhãn chọn.
 */
export function BrandStoryView() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const active = BRAND_ORIGINS.find((o) => o.id === selectedId) ?? BRAND_ORIGINS[0]!;

  const pick = useCallback((o: BrandOrigin) => {
    setSelectedId(o.id);
    setSheetOpen(isPhone());
  }, []);

  return (
    <main className={`${PAGE_WIDE} pb-8`}>
      <Suspense fallback={null}>
        <OpenFromQuery onOpen={pick} />
      </Suspense>
      <div className="pt-6 max-md:pt-0">
        <PageHeader title="Hành trình nguyên liệu" />
        <p className="mt-3 leading-relaxed text-stone-700 max-md:mt-3 max-md:text-[length:var(--type-body-md-size)] max-md:leading-normal max-md:text-[var(--color-text-secondary)]">
          Mỗi thương hiệu Tubu Tree đều gắn liền với một tỉnh thành Việt Nam. Chạm tên thương hiệu trên bản đồ vùng nguyên liệu Việt Nam để khám phá xuất xứ.
        </p>
      </div>

      <div className="mt-4 md:grid md:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] md:items-start md:gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
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
                className="flex min-h-11 items-start gap-2 rounded-card border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3 text-left text-[var(--color-text-primary)] transition [box-shadow:var(--elevation-1)] active:scale-95 motion-reduce:active:scale-100 md:data-[active=true]:border-[var(--pin)] md:data-[active=true]:bg-[color-mix(in_srgb,var(--pin)_8%,var(--color-bg-surface))]"
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
          className="mt-4 hidden rounded-card border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 [box-shadow:var(--elevation-1)] md:col-span-2 md:row-start-2 md:block lg:col-span-1 lg:col-start-2"
        >
          <div className="flex items-center gap-4">
            <BrandBadge id={active.id} className="h-20 w-20" />
            <div className="min-w-0">
              <h3 className={ui.blockTitle}>{active.brand}</h3>
              <p className="mt-1 flex items-center gap-1 text-sm text-[var(--color-text-secondary)]">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {active.province}
              </p>
              <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{active.ingredient}</p>
            </div>
          </div>
          <p className="mt-4 leading-relaxed text-[var(--color-text-primary)]">{active.story}</p>
          <Link href={brandBrowseTarget(active, '/san-pham')} data-testid="brand-detail-cta" className={`${ui.btnPrimary} mt-4`}>
            Khám phá sản phẩm {active.brand}
          </Link>
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
      </Sheet>
    </main>
  );
}
