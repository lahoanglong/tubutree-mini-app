'use client';

import { useId, useState } from 'react';
import dynamic from 'next/dynamic';
import type { HomeQuizResult } from '@tubutree/app-core/api/game';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Button, Card, Heading, Text } from '@/components/mini';

const HomeQuizSheet = dynamic(() => import('./home-quiz-sheet').then((m) => m.HomeQuizSheet), { ssr: false });

/**
 * Thẻ mời "Chẩn đoán tổ ấm" (30 giây) ở Vườn Xanh và khối `quiz` của Trang chủ. Thẻ tĩnh: không gọi API và không có chiều cao đổi,
 * nên khối không làm trang nhảy; sheet ba câu và danh sách sản phẩm chỉ nạp và chỉ gọi mạng khi khách bấm "Bắt đầu".
 */
export function HomeQuizCard() {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [claimed, setClaimed] = useState<HomeQuizResult | null>(null);
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
            <Text variant="caption" tone="tertiary" as="p" className="mt-1">
              {fillCopy('homeQuiz.card.reward')}
            </Text>
          </div>
          <Button className="flex-none" aria-label={`${fillCopy('homeQuiz.card.cta')} ${fillCopy('homeQuiz.card.title')}`} onPress={() => setOpen(true)}>
            {fillCopy('homeQuiz.card.cta')}
          </Button>
        </div>
      </Card>
      {open && <HomeQuizSheet onClose={() => setOpen(false)} claimed={claimed} onClaimed={setClaimed} />}
    </section>
  );
}
