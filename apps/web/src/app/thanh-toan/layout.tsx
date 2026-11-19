import type { Metadata } from 'next';
import { ServerGuestConfigProvider } from '@/components/checkout/server-guest-config';
import { guestCheckoutOn, welcomeAmountOf, type GuestCheckoutConfig } from '@/lib/guest-checkout/flag';
import { readPublicConfigOnServer } from '@/lib/guest-checkout/server-config';

/** Trang riêng của khách: tiêu đề riêng cho tab/lịch sử, và chặn lập chỉ mục như /tai-khoan (xem app/robots.ts). */
export const metadata: Metadata = { title: { default: 'Thanh toán', template: '%s — Tubu Tree' }, robots: { index: false, follow: false } };

/**
 * Hạn làm mới của bản cờ đọc ở máy chủ. Trang này là ISR và cả bộ đệm dữ liệu lẫn trang đều trả bản cũ cho lượt đầu sau khi hết hạn, nên sau
 * khi đổi cờ, HTML có thể còn mang cờ cũ tới vài phút. Bản đó chỉ dùng trong lúc `/config/public` của trình duyệt chưa về (thường dưới 1 giây
 * sau khi trang chạy): về rồi thì trang theo bản của trình duyệt.
 */
const CONFIG_REVALIDATE_S = 60;

/** Chỉ đưa xuống trình duyệt đúng hai trường trang cần, không phải cả cấu hình công khai. */
async function serverGuestConfig(): Promise<GuestCheckoutConfig | undefined> {
  const config = await readPublicConfigOnServer(CONFIG_REVALIDATE_S);
  if (!config) return undefined;
  const amount = welcomeAmountOf(config);
  return { webGuestCheckoutEnabled: guestCheckoutOn(config), newCustomer: { welcomeVoucher: amount === null ? null : { amount } } };
}

export default async function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return <ServerGuestConfigProvider value={await serverGuestConfig()}>{children}</ServerGuestConfigProvider>;
}
