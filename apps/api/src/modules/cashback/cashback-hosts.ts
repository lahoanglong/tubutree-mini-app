/**
 * Miền của từng sàn theo slug (CashbackMerchant không có cột domain). `productUrl` đi nguyên văn vào tham số `url=` của
 * deeplink AccessTrade, nên host lạ biến link của Tubu thành bước chuyển hướng tới trang tuỳ ý. Sàn thêm sau (slug chưa
 * khai ở đây) không nhận productUrl cho tới khi khai miền.
 */
export const CASHBACK_MERCHANT_HOSTS: Readonly<Record<string, readonly string[]>> = {
  shopee: ['shopee.vn', 'shp.ee'],
  lazada: ['lazada.vn', 'lzd.co'],
  tiktokshop: ['tiktok.com'],
};

/** URL https, không user:pass, host đúng miền (hoặc miền con) của sàn. */
export function productUrlMatchesMerchant(slug: string, productUrl: string): boolean {
  const hosts = CASHBACK_MERCHANT_HOSTS[slug];
  if (!hosts) return false;
  let url: URL;
  try {
    url = new URL(productUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}
