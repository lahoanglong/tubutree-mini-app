import { useNavigate } from 'zmp-ui';
import { Store } from 'lucide-react';
import { useStorefrontContext } from '../store/storefront-context';
import { vi } from '../i18n/vi';
import { Button } from './ui/button';
import { Icon } from './ui/icon';
import { Text } from './ui/text';

/**
 * Banner mảnh hiện khi user đang ở trong ngữ cảnh gian hàng (đến từ /s/:slug).
 * Cho phép quay về Tubu Tree (clear context + về trang chủ).
 * Đặt ngay sau đỉnh Page trên các trang trong luồng mua: product-detail, cart.
 */
export function StorefrontContextBar() {
  const navigate = useNavigate();
  const { slug, clear } = useStorefrontContext();
  if (!slug) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '0 8px 0 14px',
        background: 'var(--color-bg-surface)',
        boxShadow: 'var(--elevation-1)',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Icon icon={Store} size="sm" tone="muted" />
        <Text variant="caption" tone="secondary">{vi.storefront.inStore}</Text>
      </span>
      <Button
        variant="ghost"
        onPress={() => {
          clear();
          navigate('/');
        }}
      >
        {vi.storefront.backToTubu}
      </Button>
    </div>
  );
}
