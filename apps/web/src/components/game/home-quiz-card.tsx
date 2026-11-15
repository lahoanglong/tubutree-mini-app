'use client';

import { useId, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import type { HomeQuizResult } from '@tubutree/app-core/api/game';
import { gameArcadeStatusQuery } from '@tubutree/app-core/queries/game';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { Button, Card, Heading, Text } from '@/components/mini';

const HomeQuizSheet = dynamic(() => import('./home-quiz-sheet').then((m) => m.HomeQuizSheet), { ssr: false });

// Quà chỉ nhận một lần mỗi tài khoản: máy chủ báo đã nhận (`quizClaimed`) thì sheet coi như đã có kết quả, không gọi nhận quà nữa.
const ALREADY_CLAIMED: HomeQuizResult = { granted: 0, alreadyClaimed: true, totalSeeds: 0 };

/**
 * Thẻ mời "Chẩn đoán tổ ấm" (30 giây) ở Vườn Xanh và khối `quiz` của Trang chủ. Khách thấy dòng hứa quà; đã đăng nhập mà `quizClaimed` thì dòng đó nói
 * đã nhận quà (không hứa lần nữa). `quizClaimed` chỉ ĐỌC từ bộ nhớ đệm của khoá `['game','arcade']` (`enabled: false`): thẻ không bao giờ tự gọi mạng,
 * nên Trang chủ không có thêm request; ở Vườn Xanh sảnh mini game nạp cùng khoá và thẻ nhận kết quả ngay. Trong lúc nơi khác đang nạp khoá đó dòng quà ẩn
 * (`invisible`, vẫn chiếm chỗ) để không hiện lời hứa rồi đổi, và thẻ không đổi chiều cao.
 * Sheet ba câu và danh sách sản phẩm chỉ nạp và chỉ gọi mạng khi khách bấm "Bắt đầu".
 */
export function HomeQuizCard() {
  const titleId = useId();
  const authed = useAuthPhase() === 'authenticated';
  const status = useQuery({ ...gameArcadeStatusQuery(coreHttp), enabled: false });
  const serverClaimed = authed && status.data?.quizClaimed === true;
  const rewardHidden = authed && !status.data && status.fetchStatus === 'fetching';
  const [open, setOpen] = useState(false);
  const [claimed, setClaimed] = useState<HomeQuizResult | null>(null);
  // Vừa nhận (hay máy chủ báo đã nhận) trong sheet thì thẻ đổi dòng quà ngay, không đợi lượt nạp lại trạng thái.
  const isClaimed = serverClaimed || (authed && claimed !== null);
  return (
    <section aria-labelledby={titleId} data-testid="home-quiz-card">
      <Card variant="flat" padding={16}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <Heading id={titleId} variant="title-sm" font="ui" as="h2">
              {fillCopy('homeQuiz.card.title')}
            </Heading>
            <Text variant="body-sm" tone="secondary" as="p" className="mt-1">
              {fillCopy('homeQuiz.card.sub')}
            </Text>
            <Text variant="caption" tone="tertiary" as="p" className={`mt-1${rewardHidden ? ' invisible' : ''}`}>
              {fillCopy(isClaimed ? 'homeQuiz.result.claimed' : 'homeQuiz.card.reward')}
            </Text>
          </div>
          <Button className="flex-none" aria-label={`${fillCopy('homeQuiz.card.cta')} ${fillCopy('homeQuiz.card.title')}`} onPress={() => setOpen(true)}>
            {fillCopy('homeQuiz.card.cta')}
          </Button>
        </div>
      </Card>
      {open && <HomeQuizSheet onClose={() => setOpen(false)} claimed={claimed ?? (serverClaimed ? ALREADY_CLAIMED : null)} onClaimed={setClaimed} />}
    </section>
  );
}
