import { lazy, Suspense, useCallback, useId, useState } from 'react';
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
 * Thẻ mời "Chẩn đoán tổ ấm" (30 giây, gợi ý bộ sản phẩm hợp nhà bạn) dùng ở khối Trang chủ `quiz` và ở Vườn Xanh cạnh sảnh mini game. Thẻ tự nó KHÔNG tạo request nào (sheet và gợi ý sản phẩm chỉ gọi API khi khách mở sheet), còn trạng thái mini game chỉ được đọc từ cache cùng khoá với `ArcadeHub` (Vườn Xanh tải, Trang chủ không). Cache báo quà đã nhận (hoặc sheet vừa
 * ghi quà xong) thì dòng phụ không hứa quà nữa; chưa biết thì giữ lời hứa mặc định. Khách và tài khoản khách theo thiết bị luôn thấy lời hứa. Sheet ở lại (chỉ đóng) sau lần mở đầu để giữ câu trả
 * lời và kết quả nếu khách mở lại.
 */
export function HomeQuizCard() {
  const titleId = useId();
  const real = useRealUser();
  // Chỉ đọc cache, không bao giờ tải: ngân sách request của Trang chủ không có chỗ cho trạng thái mini game. Ở Vườn Xanh `ArcadeHub` tải cùng khoá nên thẻ vẫn cập nhật.
  const status = useQuery({ ...arcadeStatusQuery, enabled: false });
  const [claimedNow, setClaimedNow] = useState(false);
  const onClaimed = useCallback(() => setClaimedNow(true), []);
  const claimed = real && (claimedNow || status.data?.quizClaimed === true);
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
          <HomeQuizSheet open={open} onClose={() => setOpen(false)} onClaimed={onClaimed} />
        </Suspense>
      )}
    </section>
  );
}
