'use client';

import type { BrandCount } from '@tubutree/app-core/api/catalog';
import { hubBrands } from '@tubutree/app-core/browse/hub';
import { avatarInitial, avatarTone } from '@tubutree/app-core/initials-avatar';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Section, SectionHeader, Text } from '@/components/mini';

const AVATAR = 48;

/** `logoUrl` do API bổ sung sau; API hiện tại chưa trả thì ô lùi về chữ cái đầu. */
export type HubBrand = BrandCount & { logoUrl?: string | null };

export interface BrandGridProps {
  brands: HubBrand[] | undefined;
  onSelect: (brand: string) => void;
}

function InitialsAvatar({ name }: { name: string }) {
  const tone = avatarTone(name);
  return (
    <div
      data-testid="initials-avatar"
      aria-hidden="true"
      style={{
        width: AVATAR, height: AVATAR, flex: '0 0 auto', borderRadius: '50%', background: tone.background, color: tone.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: Math.round(AVATAR * 0.44), lineHeight: 1,
        fontFamily: 'var(--font-ui)', userSelect: 'none',
      }}
    >
      {avatarInitial(name)}
    </div>
  );
}

/**
 * Lưới logo thương hiệu ở hub (nguồn: apps/miniapp/src/components/catalog/brand-grid.tsx): 4 cột ở điện thoại, một hàng 12 ô ở lg,
 * nhiều sản phẩm trước, tối đa 12; dưới 4 nhãn thì không vẽ gì.
 */
export function BrandGrid({ brands, onSelect }: BrandGridProps) {
  const list = hubBrands(brands);
  if (list.length === 0) return null;
  const title = fillCopy('browse.brands');
  return (
    <Section id="browse-brands" label={title}>
      <SectionHeader title={title} />
      <div className="grid grid-cols-4 gap-2 md:grid-cols-6 lg:grid-cols-12">
        {list.map((b) => (
          <button
            key={b.brand}
            type="button"
            className="tubu-press"
            aria-label={fillCopy('browse.brandSpoken', { name: b.brand })}
            onClick={() => onSelect(b.brand)}
            style={{
              minHeight: 44, minWidth: 0, padding: '8px 4px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 6, fontFamily: 'inherit', background: 'transparent', border: 'none', cursor: 'pointer',
            }}
          >
            {b.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={b.logoUrl}
                alt=""
                width={AVATAR}
                height={AVATAR}
                loading="lazy"
                style={{ width: AVATAR, height: AVATAR, flex: '0 0 auto', borderRadius: '50%', objectFit: 'cover', background: 'var(--color-bg-media)' }}
              />
            ) : (
              <InitialsAvatar name={b.brand} />
            )}
            <Text variant="caption" data-brand-label="" style={{ fontWeight: 600, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {b.brand}
            </Text>
          </button>
        ))}
      </div>
    </Section>
  );
}
