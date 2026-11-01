import { Sprout } from 'lucide-react';
import { planShopSections } from '@tubutree/app-core/commerce/shop-page';
import { visibleCollection } from '@tubutree/app-core/commerce/storefront-builder';
import type { StorefrontEdit } from '../services/storefront-api';
import { apiMediaUrl } from '../services/api';
import { Heading, Text } from './ui/text';
import { ShopSection } from './ui/shop-section';

/**
 * Bản xem trước gian hàng cho chính chủ, dùng khi khách chưa xem được (nháp, chờ duyệt): dựng bằng chính `ShopSection` của tab Shop
 * của trang công khai /s/:slug, với đúng phần khách thấy (món ẩn bị bỏ) và đúng trần số khối. Khung `inert`: xem, không bấm.
 */
export function StorefrontPreview({ sf }: { sf: StorefrontEdit }) {
  const sections = planShopSections(sf.collections.map(visibleCollection)).main;
  const cover = sf.coverUrl ? apiMediaUrl(sf.coverUrl) : null;
  const avatar = sf.avatarUrl ? apiMediaUrl(sf.avatarUrl) : null;

  return (
    <div data-testid="storefront-preview" style={{ background: 'var(--color-bg-canvas)', borderRadius: 'var(--radius-card)', overflow: 'hidden', border: '1px solid var(--color-border-subtle)' }}>
      <div style={{ height: 72, background: cover ? `url("${cover.replace(/["\\\r\n]/g, encodeURIComponent)}") center/cover` : 'var(--color-bg-cover)' }} />
      <div style={{ padding: '0 16px 12px', marginTop: -24 }}>
        <div
          style={{
            width: 48, height: 48, borderRadius: '50%', background: 'var(--color-action-primary-bg)', border: '3px solid var(--color-bg-surface)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          }}
        >
          {avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Sprout size={24} color="var(--color-text-inverse)" />}
        </div>
        <Heading variant="title-md" as="h3" style={{ marginTop: 6 }}>{sf.title}</Heading>
        <Text variant="caption" tone="tertiary" as="div">/s/{sf.slug}</Text>
        {sf.headerNote && <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 6 }}>{sf.headerNote}</Text>}
        {sections.length === 0 ? (
          <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 10 }}>Chưa có sản phẩm nào.</Text>
        ) : (
          <div {...({ inert: '' } as Record<string, string>)} style={{ marginTop: 10 }}>
            {sections.map((c) => (
              <ShopSection key={c.id} collection={c} preview />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
