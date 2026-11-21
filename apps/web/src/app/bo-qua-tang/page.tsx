import type { Metadata } from 'next';
import { fetchGiftLanding, type GiftLanding } from '@tubutree/app-core/api/bundle';
import { giftCombosProducts, giftCombosViews } from '@tubutree/app-core/commerce/gift-combos';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { createServerHttp } from '@/lib/core-http-server';
import { BUILD_GAP_REVALIDATE_S } from '@/lib/home-initial';
import { PAGE_WIDE } from '@/lib/page-frame';
import { jsonLdScript } from '@/lib/product-seo';
import { browseCollectionJsonLd, withBrowseSocial } from '@/lib/seo/browse-structured-data';
import GiftCombosView from './gift-combos-view';

export const revalidate = 300;

const TITLE = fillCopy('giftCombos.title');
const PATH = '/bo-qua-tang';

// Trang tĩnh được lập chỉ mục (nằm trong sitemap qua route-map); mô tả không ghi số tiền để không lệch khi mốc đổi ở cấu hình.
export const metadata: Metadata = withBrowseSocial({
  title: TITLE,
  description: fillCopy('giftCombos.metaDescription'),
  alternates: { canonical: PATH },
});

const isBuild = () => process.env.NEXT_PHASE === 'phase-production-build';

export default async function GiftCombosPage() {
  let initial: GiftLanding | undefined;
  try {
    initial = await fetchGiftLanding(createServerHttp());
  } catch (e) {
    // Lúc chạy: ném để Next giữ bản đã dựng thay vì lưu trang không combo tới hết 5 phút. `next build` thường chạy khi API chưa lên: dựng không
    // dữ liệu (view tự tải phía trình duyệt, JSON-LD không khai danh sách), rồi rút hạn làm mới để bản đủ dữ liệu thay vào sớm (như hub /san-pham).
    if (!isBuild()) throw e;
    await createServerHttp({ revalidate: BUILD_GAP_REVALIDATE_S }).get('/config/public').catch(() => undefined);
  }
  const fetchedAt = Date.now();
  const products = giftCombosProducts(giftCombosViews(initial, fetchedAt));
  const ld = browseCollectionJsonLd(metadata, [{ name: 'Trang chủ', href: '/' }, { name: TITLE }], products);
  return (
    <main className={`${PAGE_WIDE} py-6`}>
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }} />}
      <GiftCombosView initial={initial} initialFetchedAt={fetchedAt} />
    </main>
  );
}
