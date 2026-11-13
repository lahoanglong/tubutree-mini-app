import type { Metadata } from 'next';
import { getWasteRules } from '@tubutree/app-core/api/waste';
import { createServerHttp } from '@/lib/core-http-server';
import { staticPageJsonLd, staticPageMetadata } from '@/lib/page-seo';
import { JsonLd } from '@/components/seo/json-ld';
import { RecycleRulesView } from '@/components/recycle/recycle-rules-view';

export const revalidate = 300;

// Vệt breadcrumb không có "Đổi rác lấy quà" (/doi-rac): trang đó noindex (route private), không nên nằm trong dữ liệu có cấu trúc.
const SEO = {
  path: '/doi-rac/quy-dinh',
  title: 'Thể lệ Đổi rác lấy quà',
  description: 'Thể lệ chương trình Đổi rác lấy quà của Tubu Tree: món nhận, cách quy đổi Điểm Xanh và điều kiện tham gia.',
};

export const metadata: Metadata = staticPageMetadata(SEO);

export default async function RecycleRulesPage() {
  // Lỗi đọc thì bỏ qua: trình duyệt tự tải, trang ISR không bị lưu rỗng vì lỗi tạm.
  const rules = await getWasteRules(createServerHttp({ revalidate })).catch(() => undefined);
  return (
    <>
      <RecycleRulesView initialText={rules ? rules.text : undefined} />
      <JsonLd data={staticPageJsonLd(SEO)} />
    </>
  );
}
