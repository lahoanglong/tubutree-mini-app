import { lazy, Suspense, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useRealUser } from '../../hooks/use-real-user';
import { arcadeStatusQuery } from '../../services/arcade-api';
import { haptic } from '../../utils/haptic';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Heading, Text } from '../ui/text';
import '../../css/home-quiz.css';

// Sheet ba câu và bộ gợi ý chỉ tải khi khách chạm Bắt đầu: thẻ mời ở Trang chủ không gánh chúng.
const HomeQuizSheet = lazy(() => import('./home-quiz-sheet').then((m) => ({ default: m.HomeQuizSheet })));

/**
 * Thẻ mời "Chẩn đoán tổ ấm" (30 giây, gợi ý bộ sản phẩm hợp nhà bạn) dùng ở khối Trang chủ `quiz` và ở Vườn Xanh cạnh sảnh mini game. Sheet và gợi ý sản phẩm không
 * gọi API tới khi khách mở sheet. Khách thật đã đăng nhập thì thẻ dùng chung truy vấn trạng thái mini game (cùng khoá với `ArcadeHub`, một request) để biết quà đã nhận
 * chưa: nhận rồi thì dòng phụ không hứa quà nữa. Khách và tài khoản khách theo thiết bị không gọi gì, vẫn thấy lời hứa. Sheet ở lại (chỉ đóng) sau lần mở đầu để giữ câu trả
 * lời và kết quả nếu khách mở lại.
 */
export function HomeQuizCard() {
  const titleId = useId();
  const real = useRealUser();
  const status = useQuery({ ...arcadeStatusQuery, enabled: real, staleTime: 30_000 });
  const claimed = real && status.data?.quizClaimed === true;
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby={titleId} data-testid="home-quiz-card">
      <Card variant="flat" padding={16}>
        <div className="tubu-hqz-card">
          <Heading as="h2" id={titleId} variant="title-sm" font="ui">
            {fillCopy('homeQuiz.card.title')}
          </Heading>
          <Text variant="body-sm" tone="secondary" as="p">
            {fillCopy('homeQuiz.card.sub')}
          </Text>
          <Text variant="caption" tone="brand" as="p">
            {fillCopy(claimed ? 'homeQuiz.result.claimed' : 'homeQuiz.card.reward')}
          </Text>
          <Button
            aria-label={`${fillCopy('homeQuiz.card.cta')} ${fillCopy('homeQuiz.card.title')}`}
            onPress={() => {
              haptic('light');
              setLoaded(true);
              setOpen(true);
            }}
          >
            {fillCopy('homeQuiz.card.cta')}
          </Button>
        </div>
      </Card>
      {loaded && (
        <Suspense fallback={null}>
          <HomeQuizSheet open={open} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </section>
  );
}
