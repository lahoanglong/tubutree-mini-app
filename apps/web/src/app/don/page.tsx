import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { guestCheckoutOn } from '@/lib/guest-checkout/flag';
import { readPublicConfigOnServer } from '@/lib/guest-checkout/server-config';
import { GuestOrderLookup } from './lookup-form';

/** Trang tra cứu không có gì để lập chỉ mục; không gửi Referer vì đường dẫn có thể mang mã đơn (`?ma=`). */
export const metadata: Metadata = {
  title: 'Tra cứu đơn hàng',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

const CODE_PARAM_MAX = 40;

/**
 * Tra đơn đặt không đăng nhập bằng mã đơn + SĐT (`POST /checkout/guest/lookup`). Cờ `web.guest_checkout_enabled` tắt thì 404 như `/don/<mã>`;
 * không đọc được cấu hình thì vẫn dựng trang (API tự trả 404 khi không có đơn). `?ma=` điền sẵn mã (từ trang theo dõi báo không tìm thấy).
 */
export default async function GuestOrderLookupPage({ searchParams }: { searchParams: Promise<{ ma?: string | string[] }> }) {
  const config = await readPublicConfigOnServer(0);
  if (config && !guestCheckoutOn(config)) notFound();
  const raw = (await searchParams).ma;
  const initialCode = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, CODE_PARAM_MAX) ?? '';
  return <GuestOrderLookup initialCode={initialCode} />;
}
