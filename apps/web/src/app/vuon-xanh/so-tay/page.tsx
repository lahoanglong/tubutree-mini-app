import type { Metadata } from 'next';
import { albumCopy } from '@tubutree/app-core/game-album/copy';
import { AlbumScreen } from '@/components/game-album/album-screen';
import { PRIVATE_CHILD_SEO } from '@/lib/landing-seo';
import { PAGE_WIDE } from '@/lib/page-frame';

// Sổ của từng khách (cần đăng nhập, cặp Mini `/game/album`): noindex, gỡ canonical kế thừa từ landing /vuon-xanh, không vào sitemap.
export const metadata: Metadata = { title: albumCopy('title'), robots: { index: false, follow: false }, ...PRIVATE_CHILD_SEO };

export default function AlbumPage() {
  return (
    <main className={`${PAGE_WIDE} min-h-dvh pb-24 pt-0 md:pt-6`}>
      <AlbumScreen />
    </main>
  );
}
