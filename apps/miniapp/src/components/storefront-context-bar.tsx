import { Box, Text, useNavigate } from 'zmp-ui';
import { useStorefrontContext } from '../store/storefront-context';
import { vi } from '../i18n/vi';

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
    <Box
      flex
      alignItems="center"
      justifyContent="space-between"
      style={{ padding: '8px 14px', background: 'var(--neutral-0)', boxShadow: 'var(--shadow-xs)' }}
    >
      <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
        🏪 {vi.storefront.inStore}
      </Text>
      <Text
        size="xSmall"
        bold
        className="tubu-press"
        style={{ color: 'var(--primary-700)' }}
        onClick={() => {
          clear();
          navigate('/');
        }}
      >
        {vi.storefront.backToTubu}
      </Text>
    </Box>
  );
}
