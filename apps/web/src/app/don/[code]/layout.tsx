import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { guestCheckoutOn } from '@/lib/guest-checkout/flag';
import { readPublicConfigOnServer } from '@/lib/guest-checkout/server-config';

/**
 * Trang theo dõi đơn đặt không đăng nhập: chặn lập chỉ mục và không gửi Referer (khoá theo dõi nằm sau dấu # nên không vào Referer,
 * nhưng mã đơn trong đường dẫn thì có) khi khách bấm liên kết ra ngoài.
 */
export const metadata: Metadata = {
  title: 'Theo dõi đơn hàng',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * Cờ `web.guest_checkout_enabled` tắt thì `/don/<mã>` không có thật: trả 404 như trước khi có tính năng, không dựng khung trang 200.
 * Đọc thẳng API mỗi lượt (revalidate 0), không qua bộ đệm: ngay sau khi bật cờ, khách vừa đặt xong được chuyển tới đây không được gặp 404
 * vì một bản cờ cũ còn trong bộ đệm. Không đọc được cấu hình (API lỗi hay quá hạn) thì vẫn dựng trang: trang tự báo không tìm thấy đơn.
 */
export default async function GuestOrderLayout({ children }: { children: React.ReactNode }) {
  const config = await readPublicConfigOnServer(0);
  if (config && !guestCheckoutOn(config)) notFound();
  return children;
}
