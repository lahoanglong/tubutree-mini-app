import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isPlayableMiniGame, miniGameTitle, PLAYABLE_MINI_GAMES } from '@tubutree/app-core/game-mini/format';
import MiniRoundShell from '@/components/game/mini/mini-round-shell';
import { PRIVATE_CHILD_SEO } from '@/lib/landing-seo';
import { PAGE_WIDE } from '@/lib/page-frame';

type Props = { params: Promise<{ game: string }> };

// loading.tsx của /vuon-xanh làm Next stream 200 trước khi notFound() chạy; khoá danh sách game ở tầng định tuyến để game lạ là 404 thật.
export const dynamicParams = false;
export const generateStaticParams = () => PLAYABLE_MINI_GAMES.map((game) => ({ game }));

// Màn chơi không có nội dung để tìm kiếm (câu hỏi đổi mỗi ngày, cần bấm Bắt đầu): noindex, gỡ canonical kế thừa từ landing /vuon-xanh.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { game } = await params;
  const title = isPlayableMiniGame(game) ? miniGameTitle(game) : 'Vườn Xanh';
  return { title: { absolute: `${title} — Tubu Tree` }, robots: { index: false, follow: false }, ...PRIVATE_CHILD_SEO };
}

export default async function MiniGamePlayPage({ params }: Props) {
  const { game } = await params;
  if (!isPlayableMiniGame(game)) notFound();
  // Vùng chơi cao ít nhất một màn hình: màn kết quả dài hơn màn mở đầu, chân trang luôn nằm dưới mép nên không bị đẩy trong tầm nhìn (CLS).
  return (
    <main className={`${PAGE_WIDE} min-h-dvh pb-24 pt-0 md:pt-6`}>
      <MiniRoundShell game={game} />
    </main>
  );
}
