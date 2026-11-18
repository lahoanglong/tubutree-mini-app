import type { Metadata } from 'next';
import { fetchGreenBoxPage } from '@tubutree/app-core/api/bundle';
import { greenBoxWebCopy } from '@tubutree/app-core/commerce/green-box';
import { createServerHttp } from '@/lib/core-http-server';
import { ogBase, withBrand } from '@/lib/og';
import { PAGE_WIDE } from '@/lib/page-frame';
import GreenBoxView from './green-box-view';

export const revalidate = 300;

const TITLE = greenBoxWebCopy('pageTitle');

// Trang ưu đãi theo cờ, danh sách đổi theo tồn kho từng giờ: không lập chỉ mục (follow để crawler vẫn tới sản phẩm).
export const metadata: Metadata = {
  title: TITLE,
  robots: { index: false, follow: true },
  openGraph: { ...ogBase, title: withBrand(TITLE), url: '/hop-xanh' },
};

export default async function GreenBoxPage() {
  // Lỗi thì để trang tự tải lại phía trình duyệt.
  const initial = await fetchGreenBoxPage(createServerHttp()).catch(() => undefined);
  return (
    <main className={`${PAGE_WIDE} py-6`}>
      <GreenBoxView initial={initial} />
    </main>
  );
}
