import type { Metadata } from 'next';

/**
 * Trang theo dõi đơn đặt không đăng nhập: chặn lập chỉ mục và không gửi Referer (khoá theo dõi nằm sau dấu # nên không vào Referer,
 * nhưng mã đơn trong đường dẫn thì có) khi khách bấm liên kết ra ngoài.
 */
export const metadata: Metadata = {
  title: 'Theo dõi đơn hàng',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function GuestOrderLayout({ children }: { children: React.ReactNode }) {
  return children;
}
