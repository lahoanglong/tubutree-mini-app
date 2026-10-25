'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Map as MapIcon } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { brandsQuery } from '@tubutree/app-core/queries/catalog';
import { coreHttp } from '@/lib/core-http';
import { browseHref, EMPTY_SEARCH_STATE } from '@/lib/search-state';
import { Chip, Heading, Icon, ScrollRow, Text } from '@/components/mini';

/**
 * "Hành trình nguyên liệu" giữa Trang chủ (bản web của `brand-journey.tsx` ở Mini App): thẻ mở bản đồ xuất xứ, kèm dải nhãn Việt
 * (chạm mở trang nhãn). `initialBrands` là danh sách server đã tải cho trang ISR. Chưa có danh sách nhãn thì vẫn có thẻ bản đồ.
 */
export function BrandJourney({ initialBrands }: { initialBrands?: { brand: string; count: number; slug?: string | null }[] }) {
  const router = useRouter();
  // Nhãn chậm đổi (sync Pancake ~15 phút/lần) → cache 60s.
  const brands = useQuery({ ...brandsQuery(coreHttp), staleTime: 60_000, ...(initialBrands ? { initialData: initialBrands } : {}) });
  const list = brands.data ?? [];
  return (
    <section aria-label={homeCopy.journey.title} style={{ padding: '8px 0' }}>
      <div style={{ background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-card)', padding: 12 }}>
        <button
          type="button"
          className="tubu-press"
          onClick={() => router.push('/cau-chuyen')}
          style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 44, padding: 0, border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer' }}
        >
          <span aria-hidden style={{ width: 44, height: 44, borderRadius: 'var(--radius-control)', background: 'var(--color-bg-surface)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
            <Icon icon={MapIcon} tone="brand" />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <Heading variant="title-sm" as="h2">
              {homeCopy.journey.title}
            </Heading>
            <Text variant="caption" tone="secondary" as="div">
              {homeCopy.journey.body(list.length)}
            </Text>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flex: '0 0 auto' }}>
            <Text variant="label" tone="brand">
              {homeCopy.journey.cta}
            </Text>
            <Icon icon={ChevronRight} size="sm" tone="brand" />
          </span>
        </button>
        {list.length > 0 && (
          <ScrollRow label="Dải thương hiệu, vuốt ngang để xem thêm" style={{ gap: 8, padding: '8px 0 4px' }}>
            {list.map((b) => (
              <Chip key={b.brand} onPress={() => router.push(b.slug ? `/brand/${encodeURIComponent(b.slug)}` : browseHref({ ...EMPTY_SEARCH_STATE, brands: [b.brand] }))}>
                {b.brand}
              </Chip>
            ))}
          </ScrollRow>
        )}
      </div>
    </section>
  );
}
