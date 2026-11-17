import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isPlayableMiniGame, miniGameTitle } from '@tubutree/app-core/game-mini/format';
import MiniRoundShell from '@/components/game/mini/mini-round-shell';
import { PRIVATE_CHILD_SEO } from '@/lib/landing-seo';
import { PAGE_WIDE } from '@/lib/page-frame';

type Props = { params: Promise<{ game: string }> };

// Màn chơi không có nội dung để tìm kiếm (câu hỏi đổi mỗi ngày, cần bấm Bắt đầu): noindex, gỡ canonical kế thừa từ landing /vuon-xanh.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { game } = await params;
  const title = isPlayableMiniGame(game) ? miniGameTitle(game) : 'Vườn Xanh';
  return { title: { absolute: `${title} — Tubu Tree` }, robots: { index: false, follow: false }, ...PRIVATE_CHILD_SEO };
}

export default async function MiniGamePlayPage({ params }: Props) {
  const { game } = await params;
  if (!isPlayableMiniGame(game)) notFound();
  return (
    <main className={`${PAGE_WIDE} pb-24 pt-0 md:pt-6`}>
      <MiniRoundShell game={game} />
    </main>
  );
}
