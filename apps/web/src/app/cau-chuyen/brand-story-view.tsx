'use client';

import { PageHeader } from '@/components/ui/page-header';
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MapPin } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { BRAND_ORIGINS, brandBrowseHref, type BrandOrigin } from '@/lib/brand-origins';
import { ui } from '@/lib/guest-ui';
import { BrandMap } from './brand-map';
import './brand-theme.css';

/** Nền tối nhẹ ngay sau chữ trắng trên gradient nhãn (D8-1): màu nhãn giữ nguyên, chỉ vùng chữ đủ 4,5:1. */
const TEXT_SCRIM = 'rounded-control bg-[var(--color-brand-tile-scrim)] px-2.5 py-1.5';

/** Hành trình nguyên liệu: bản đồ gỗ 3D và 8 ô nhãn gắn với tỉnh xuất xứ; chạm mở sheet câu chuyện kèm lối sang sản phẩm của nhãn. */
export function BrandStoryView() {
  const params = useSearchParams();
  const [selected, setSelected] = useState<BrandOrigin | null>(() => BRAND_ORIGINS.find((o) => o.id === params?.get('brand')) ?? null);

  return (
    <main className="mx-auto w-full max-w-frame pb-8">
      <div className="px-4 pt-6 max-md:pt-0 md:px-6">
        <PageHeader title="Hành trình nguyên liệu" />
        <p className="mt-3 leading-relaxed text-stone-700 max-md:mt-3 max-md:text-[length:var(--type-body-md-size)] max-md:leading-normal max-md:text-[var(--color-text-secondary)]">
          Mỗi thương hiệu Tubu Tree đều gắn liền với một tỉnh thành Việt Nam. Chạm mốc trên bản đồ gỗ 3D để khám phá xuất xứ.
        </p>
      </div>

      <div className="mt-4 md:grid md:grid-cols-[minmax(0,370px)_1fr] md:items-start md:gap-6 md:px-4">
        <BrandMap onPick={setSelected} />

        <div>
          <h2 className={`${ui.sectionTitle} px-4 pb-2 pt-4 md:px-0 md:pt-0`}>{BRAND_ORIGINS.length} Thương hiệu & Tỉnh thành xuất xứ</h2>
          <div className="grid grid-cols-2 gap-3 px-4 pb-6 md:px-0 lg:grid-cols-3">
            {BRAND_ORIGINS.map((loc) => (
              <button
                key={loc.id}
                type="button"
                onClick={() => setSelected(loc)}
                className="flex flex-col justify-between rounded-card p-3.5 text-left shadow-card transition active:scale-95"
                style={{ minHeight: 135, background: loc.gradient }}
              >
                <span aria-hidden className="text-4xl leading-tight">
                  {loc.emoji}
                </span>
                <span data-testid="brand-tile-scrim" className={`block max-w-full self-start ${TEXT_SCRIM}`}>
                  <span className="block font-bold text-stone-0">{loc.brand}</span>
                  <span className="flex items-center gap-1 text-xs text-stone-0">
                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                    {loc.province}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <Sheet open={selected !== null} onClose={() => setSelected(null)} title={selected?.brand}>
        {selected && (
          <>
            <div className="rounded-card p-6 text-center" style={{ background: selected.gradient }}>
              <span aria-hidden className="block text-6xl leading-tight">
                {selected.emoji}
              </span>
              <span className={`mt-1 inline-flex items-center justify-center gap-1 text-sm text-stone-0 ${TEXT_SCRIM}`}>
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {selected.province} · {selected.ingredient}
              </span>
            </div>
            <p className="mt-4 leading-relaxed text-stone-900">{selected.story}</p>
            <Link href={brandBrowseHref(selected.catalogBrand)} onClick={() => setSelected(null)} className={`${ui.btnPrimary} mt-4 w-full`}>
              Khám phá sản phẩm {selected.brand}
            </Link>
          </>
        )}
      </Sheet>
    </main>
  );
}
