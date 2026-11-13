import { useNavigate } from 'zmp-ui';
import { hubBrands } from '@tubutree/app-core/browse/hub';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { BrandCount } from '@tubutree/app-core/api/catalog';
import { SHELL_BRAND_KEY, journeyBrandHref, journeyBrands, normalizeBrandKey } from '@tubutree/app-core/brand-origins';
import { haptic } from '../../utils/haptic';
import { InitialsAvatar } from '../ui/initials-avatar';
import { Section } from '../ui/section';
import { SectionHeader } from '../ui/section-header';
import { Text } from '../ui/text';
import { hideBrokenImage } from '@tubutree/app-core/image-fallback';

const AVATAR = 48;

/** `logoUrl` do API bổ sung sau; API hiện tại chưa trả thì ô lùi về chữ cái đầu. */
export type HubBrand = BrandCount & { logoUrl?: string | null };

export interface BrandGridProps {
  brands: HubBrand[] | undefined;
  onSelect: (brand: string) => void;
}

/** Lưới logo thương hiệu ở hub: 4 cột, nhiều sản phẩm trước, tối đa 12 (3 hàng); dưới 4 nhãn thì không vẽ gì. API chỉ có nhãn vỏ "Tubu Tree" thì vẽ 8 nhãn hành trình (chạm mở tìm theo từ khoá). */
export function BrandGrid({ brands, onSelect }: BrandGridProps) {
  const navigate = useNavigate();
  // PROD ghi mọi SKU là nhãn "Tubu Tree": khi API chỉ trả vỏ chung đó thì hiện 8 nhãn hành trình (tìm theo từ khoá trong tên) thay vì ẩn cả khối.
  const onlyShell = !!brands && brands.length > 0 && brands.every((b) => normalizeBrandKey(b.brand) === SHELL_BRAND_KEY);
  const journey = onlyShell ? journeyBrands(brands) : [];
  const list: HubBrand[] = journey.length > 0 ? journey.map((j) => ({ brand: j.label, count: 0, slug: j.slug })) : hubBrands(brands);
  if (list.length === 0) return null;
  const title = fillCopy('browse.brands');
  return (
    <Section id="browse-brands" label={title}>
      <div style={{ padding: '0 16px' }}>
        <SectionHeader title={title} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
          {list.map((b, i) => (
            <button
              key={b.brand}
              type="button"
              className="tubu-press"
              aria-label={fillCopy('browse.brandSpoken', { name: b.brand })}
              onClick={() => {
                haptic('light');
                if (journey.length > 0) navigate(journeyBrandHref(journey[i]!, '/browse'));
                else onSelect(b.brand);
              }}
              style={{
                minHeight: 44,
                minWidth: 0,
                padding: '8px 4px',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                fontFamily: 'inherit',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {b.logoUrl ? (
                <img
                  src={b.logoUrl}
                  alt=""
                  width={AVATAR}
                  height={AVATAR}
                  loading="lazy"
                  style={{ width: AVATAR, height: AVATAR, flex: '0 0 auto', borderRadius: '50%', objectFit: 'cover', background: 'var(--color-bg-media)' }}
                  onError={hideBrokenImage}
                />
              ) : (
                <InitialsAvatar name={b.brand} size={AVATAR} />
              )}
              <Text
                variant="caption"
                data-brand-label=""
                style={{ fontWeight: 600, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {b.brand}
              </Text>
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}
