import { Sprout } from 'lucide-react';
import type { StorefrontEdit } from '../services/storefront-api';
import { apiMediaUrl } from '../services/api';
import { Heading, Text } from './ui/text';
import { ProductTile } from './ui/product-tile';

const MAX_TILES = 4;

/** Bản xem trước gian hàng cho chính chủ, dùng khi khách chưa xem được (nháp, chờ duyệt): cùng bố cục với trang công khai /s/:slug. */
export function StorefrontPreview({ sf }: { sf: StorefrontEdit }) {
  const items = sf.collections.flatMap((c) => c.items).filter((it) => !it.isHidden && !it.hiddenReason);
  const shown = items.slice(0, MAX_TILES);
  const cover = sf.coverUrl ? apiMediaUrl(sf.coverUrl) : null;
  const avatar = sf.avatarUrl ? apiMediaUrl(sf.avatarUrl) : null;

  return (
    <div data-testid="storefront-preview" style={{ background: 'var(--color-bg-canvas)', borderRadius: 'var(--radius-card)', overflow: 'hidden', border: '1px solid var(--color-border-subtle)' }}>
      <div style={{ height: 72, background: cover ? `url("${cover.replace(/["\\\r\n]/g, encodeURIComponent)}") center/cover` : 'var(--forest-700)' }} />
      <div style={{ padding: '0 12px 12px', marginTop: -24 }}>
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
        {shown.length === 0 ? (
          <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 10 }}>Chưa có sản phẩm nào.</Text>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
            {shown.map((it) => (
              <ProductTile key={it.id} product={it.product} variant="grid" priceOverride={null} showWishlist={false} action="none" onPress={() => undefined} />
            ))}
          </div>
        )}
        {items.length > shown.length && (
          <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 8 }}>và {items.length - shown.length} sản phẩm khác</Text>
        )}
      </div>
    </div>
  );
}
