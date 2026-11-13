import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getFeedPublicPreview, type FeedPreviewItem } from '@tubutree/app-core/api/feed';
import { getPublicConfig, type PublicConfig } from '@tubutree/app-core/api/config';
import { CommunityChannels } from '@/components/community/community-channels';
import { PublicPreviewList } from '@/components/community/public-preview-list';
import { JsonLd } from '@/components/seo/json-ld';
import { createServerHttp } from '@/lib/core-http-server';
import { staticPageJsonLd, staticPageMetadata } from '@/lib/page-seo';
import { FeedShell } from './feed-shell';
import { FeedView } from './feed-view';

// API cache bản xem trước 60 giây; trang ISR không giữ lâu hơn để bài đã gỡ biến mất nhanh khỏi HTML công khai.
export const revalidate = 60;

// Dữ liệu có cấu trúc chỉ khai trang (WebPage + breadcrumb), không khai bài đăng: bản xem trước đổi theo từng phút và có thể tắt bằng cờ.
const SEO = {
  path: '/cong-dong',
  title: 'Cộng đồng Vườn Tubu',
  description: 'Hỏi đáp cách dùng, chia sẻ trải nghiệm và cổ vũ nhau trong cộng đồng Vườn Tubu của Tubu Tree.',
};

export const metadata: Metadata = staticPageMetadata(SEO);

export default async function CommunityPage() {
  const http = createServerHttp({ revalidate });
  // Lỗi đọc thì bỏ qua: trình duyệt tự tải lại, trang ISR không bị lưu rỗng vì lỗi tạm.
  const config: PublicConfig | undefined = await getPublicConfig(http).catch(() => undefined);
  // Cờ tắt thì API trả 404 cho bản xem trước nên chỉ hỏi khi cờ bật.
  const preview: FeedPreviewItem[] | undefined =
    config?.communityPublicPreview === true ? await getFeedPublicPreview(http).then((r) => r.posts, () => undefined) : undefined;
  return (
    <>
      {/* useSearchParams (bộ lọc thẻ) buộc phần client nằm sau Suspense; HTML công khai là bản xem trước của khách. */}
      <Suspense
        fallback={
          <FeedShell subtitle={Boolean(preview?.length)}>
            {preview && preview.length > 0 ? (
              <>
                <CommunityChannels {...(config ? { initialConfig: config } : {})} />
                <PublicPreviewList posts={preview} />
              </>
            ) : null}
          </FeedShell>
        }
      >
        <FeedView initialPreview={preview} initialConfig={config} />
      </Suspense>
      <JsonLd data={staticPageJsonLd(SEO)} />
    </>
  );
}
