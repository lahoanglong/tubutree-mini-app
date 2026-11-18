import type { Metadata } from 'next';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { MATCHER_PATH } from '@tubutree/app-core/game-mini/matcher';
import { getMatcherStatus, matcherOn } from '@tubutree/app-core/game-mini/matcher-status';
import { gameWebCopy } from '@tubutree/app-core/game-mini/web-copy';
import MatcherFlow from '@/components/game/matcher/matcher-flow';
import { createServerHttp } from '@/lib/core-http-server';
import { PAGE_WIDE } from '@/lib/page-frame';
import { staticPageMetadata } from '@/lib/page-seo';

/**
 * Cờ `game.matcher_enabled` tắt (hay chưa đọc được) thì trang noindex: không lối vào nào dẫn tới, máy tìm kiếm không giữ một trang chỉ báo
 * "đang tạm nghỉ". Trang không nằm trong sitemap.
 */
export async function generateMetadata(): Promise<Metadata> {
  const base = staticPageMetadata({ path: MATCHER_PATH, title: gameCopy('game.matcher.title'), description: gameWebCopy('matcher.meta.description') });
  const on = await getMatcherStatus(createServerHttp({ revalidate: 60 }))
    .then(matcherOn)
    .catch(() => false);
  return on ? base : { ...base, robots: { index: false, follow: false } };
}

export default function MatcherPage() {
  return (
    <main className={`${PAGE_WIDE} min-h-dvh pb-24 pt-0 md:pt-6`}>
      <MatcherFlow />
    </main>
  );
}
