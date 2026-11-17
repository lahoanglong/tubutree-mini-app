import { redirect } from 'next/navigation';
import { legacyVouchersTarget } from '@tubutree/app-core/commerce/offers-hub';

type VouchersSearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Next đưa tham số lặp vào searchParams dưới dạng mảng: giữ đủ từng giá trị theo thứ tự. */
function toSearch(sp: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v);
  }
  return params.toString();
}

/**
 * Mã giảm giá không còn trang riêng: kho mã là khối Nhận mã (mở sẵn) ở tab Săn mã của Ưu đãi, ví và lịch sử ở tab Mã của tôi. Đường cũ giữ lại để link
 * trong thông báo, chân trang cũ, dấu trang của khách vẫn tới đúng tab, giữ mọi tham số khác (`code=X`); chuyển hướng ở máy chủ (307) nên không có trang trung gian.
 */
export default async function VouchersPage({ searchParams }: { searchParams: VouchersSearchParams }) {
  redirect(legacyVouchersTarget('/uu-dai', toSearch(await searchParams)));
}
