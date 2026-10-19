import type { Metadata } from 'next';
import { getWasteRules } from '@tubutree/app-core/api/waste';
import { createServerHttp } from '@/lib/core-http-server';
import { RecycleRulesView } from '@/components/recycle/recycle-rules-view';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Thể lệ Đổi rác lấy quà — Tubu Tree',
  description: 'Thể lệ chương trình Đổi rác lấy quà của Tubu Tree: món nhận, cách quy đổi Điểm Xanh và điều kiện tham gia.',
  alternates: { canonical: '/doi-rac/quy-dinh' },
};

export default async function RecycleRulesPage() {
  // Lỗi đọc thì bỏ qua: trình duyệt tự tải, trang ISR không bị lưu rỗng vì lỗi tạm.
  const rules = await getWasteRules(createServerHttp({ revalidate })).catch(() => undefined);
  return <RecycleRulesView initialText={rules ? rules.text : undefined} />;
}
