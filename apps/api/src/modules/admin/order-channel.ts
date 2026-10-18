/**
 * Nhãn kênh của đơn cho báo cáo và CSV. `Order.source` do máy chủ ghi lúc đặt (checkout.service, affiliate.service,
 * subscriptions.service, dealer.service); đơn tạo trước khi có cột (hoặc tập lệnh điền bù không phân biệt được) là null.
 * Mã lạ in nguyên văn để không giấu một kênh mới thêm sau này.
 */
export const ORDER_SOURCE_LABEL: Record<string, string> = {
  checkout: 'Giỏ hàng',
  buy_now: 'Mua ngay',
  storefront: 'Gian hàng (khách tự mua)',
  ctv_assisted: 'CTV lên đơn hộ',
  subscription: 'Gói định kỳ',
  dealer: 'Đại lý',
};

export const ORDER_PLATFORM_LABEL: Record<string, string> = {
  miniapp: 'Mini App',
  web: 'Web',
  system: 'Hệ thống',
  pos: 'Tại quầy',
};

export const UNKNOWN_CHANNEL_LABEL = 'Không rõ';

export const orderSourceLabel = (source: string | null | undefined): string =>
  source ? (ORDER_SOURCE_LABEL[source] ?? source) : UNKNOWN_CHANNEL_LABEL;

export const orderPlatformLabel = (platform: string | null | undefined): string =>
  platform ? (ORDER_PLATFORM_LABEL[platform] ?? platform) : UNKNOWN_CHANNEL_LABEL;
