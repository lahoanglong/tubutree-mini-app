'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Map as MapIcon } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { brandsQuery } from '@tubutree/app-core/queries/catalog';
import { coreHttp } from '@/lib/core-http';
import { browseHref, EMPTY_SEARCH_STATE } from '@/lib/search-state';
import { Icon, ScrollRow, SectionHeader, Text } from '@/components/mini';
import { SR_ONLY } from '@/components/mini/sr-only';

/**
 * Chip nhãn là liên kết thật (công cụ tìm kiếm đi theo được tới /brand/[slug]); trông và hit-area y hệt `Chip` (md, chưa chọn), chỉ là thẻ `<a>`:
 * `Chip` là `<button>` nên không bọc được trong `Link` (điều khiển lồng điều khiển).
 */
function BrandChipLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="tubu-press tubu-hit-44"
      style={{
        cursor: 'pointer',
        fontFamily: 'inherit',
        lineHeight: 'inherit',
        textDecoration: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: 'var(--color-bg-surface)',
        boxShadow: 'inset 0 0 0 1px var(--color-border-subtle)',
        color: 'var(--color-text-secondary)',
        fontWeight: 600,
        fontSize: 'var(--type-body-sm-size)',
        padding: '7px 14px',
        minHeight: 36,
        minWidth: 44,
        flexShrink: 0,
        borderRadius: 'var(--radius-pill)',
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
      }}
    >
      {children}
    </Link>
  );
}

/**
 * "Hành trình nguyên liệu" giữa Trang chủ (bản web của `brand-journey.tsx` ở Mini App): tiêu đề `SectionHeader` (Inter 16/700, nút
 * "Xem bản đồ") rồi thẻ mở bản đồ xuất xứ, kèm dải thương hiệu Việt (chạm mở trang thương hiệu). `initialBrands` là danh sách server đã tải cho trang ISR. Chưa có danh sách thương hiệu thì vẫn có thẻ bản đồ.
 */
export function BrandJourney({ initialBrands }: { initialBrands?: { brand: string; count: number; slug?: string | null }[] }) {
  const router = useRouter();
  // Nhãn chậm đổi (sync Pancake ~15 phút/lần) → cache 60s.
  const brands = useQuery({ ...brandsQuery(coreHttp), staleTime: 60_000, ...(initialBrands ? { initialData: initialBrands } : {}) });
  const list = brands.data ?? [];
  return (
    <section aria-label={homeCopy.journey.title}>
      <SectionHeader title={homeCopy.journey.title} action={{ label: homeCopy.journey.cta, to: '/cau-chuyen' }} />
      <div style={{ background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-card)', padding: 12 }}>
        {/* Cùng đích với nút "Xem bản đồ" ở tiêu đề: thẻ chỉ còn cho chạm/chuột; bàn phím và trình đọc đi qua đúng một điều khiển (như các kệ khác).
            aria-hidden cũng giấu câu mô tả trong thẻ ("12 thương hiệu Việt…"), nên trình đọc nghe câu đó một lần ở bản chỉ-đọc ngoài nút. */}
        <span style={SR_ONLY}>{homeCopy.journey.body(list.length)}</span>
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          className="tubu-press"
          onClick={() => router.push('/cau-chuyen')}
          style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 44, padding: 0, border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer' }}
        >
          <span aria-hidden style={{ width: 44, height: 44, borderRadius: 'var(--radius-control)', background: 'var(--color-bg-surface)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
            <Icon icon={MapIcon} tone="brand" />
          </span>
          <Text variant="body-sm" tone="secondary" as="span" style={{ flex: 1, minWidth: 0 }}>
            {homeCopy.journey.body(list.length)}
          </Text>
          <Icon icon={ChevronRight} size="sm" tone="brand" />
        </button>
        {list.length > 0 && (
          <ScrollRow arrows label="Dải thương hiệu, vuốt ngang để xem thêm" style={{ gap: 8, padding: '8px 0 4px' }}>
            {list.map((b) => (
              <BrandChipLink key={b.brand} href={b.slug ? `/brand/${encodeURIComponent(b.slug)}` : browseHref({ ...EMPTY_SEARCH_STATE, brands: [b.brand] })}>
                {b.brand}
              </BrandChipLink>
            ))}
          </ScrollRow>
        )}
      </div>
    </section>
  );
}
