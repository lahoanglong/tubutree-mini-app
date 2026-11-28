import { lazy, Suspense, useCallback, useId, useState } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ArcadeStatus } from '@tubutree/app-core/api/game';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useAuthStore } from '../../store/auth';
import { isGuestUser } from '../../utils/guest-user';
import { haptic } from '../../utils/haptic';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Heading, Text } from '../ui/text';
import '../../css/home-quiz.css';

// Sheet ba câu và bộ gợi ý chỉ tải khi khách chạm Bắt đầu: thẻ mời ở Trang chủ không gánh chúng.
const HomeQuizSheet = lazy(() => import('./home-quiz-sheet').then((m) => ({ default: m.HomeQuizSheet })));

// Thẻ và sheet không import mô-đun nào Vườn Xanh cũng dùng (services/arcade-api, hooks/use-real-user, api/game): phần dùng chung đó nhỏ hơn
// `experimentalMinChunkSize` nên Rollup gộp vào entry. Vì vậy khoá cache và luật khách thật được viết lại ở đây, spec giữ chúng trùng bản gốc.
/** Cùng khoá `arcadeStatusQuery` (services/arcade-api). */
export const ARCADE_STATUS_KEY = ['game', 'arcade'] as const;

/**
 * Thẻ mời "Chẩn đoán tổ ấm" (30 giây, gợi ý bộ sản phẩm hợp nhà bạn) ở khối Trang chủ `quiz`. Thẻ tự nó KHÔNG tạo request nào (sheet và gợi ý
 * sản phẩm chỉ gọi API khi khách mở sheet); trạng thái mini game chỉ đọc từ cache cùng khoá với `ArcadeHub`, có khi khách đã ghé Vườn Xanh trong
 * phiên. Cache báo quà đã nhận (hoặc sheet vừa ghi quà xong) thì dòng phụ không hứa quà nữa; chưa biết thì giữ lời hứa mặc định. Khách và tài
 * khoản khách theo thiết bị luôn thấy lời hứa. Sheet ở lại (chỉ đóng) sau lần mở đầu để giữ câu trả lời và kết quả nếu khách mở lại.
 */
export function HomeQuizCard() {
  const titleId = useId();
  // Cùng luật `useRealUser`: tài khoản khách theo thiết bị có phiên nhưng máy chủ không phát quà.
  const real = useAuthStore((s) => s.status === 'authenticated' && s.user !== null && s.user !== undefined && !isGuestUser(s.user));
  const queryClient = useQueryClient();
  // Chỉ đọc cache, không bao giờ tải: ngân sách request của Trang chủ không có chỗ cho trạng thái mini game. Khách đã ghé Vườn Xanh thì `ArcadeHub` đã tải cùng khoá.
  const status = useQuery<ArcadeStatus>({ queryKey: ARCADE_STATUS_KEY, queryFn: skipToken });
  const [claimedNow, setClaimedNow] = useState(false);
  const onClaimed = useCallback(() => {
    setClaimedNow(true);
    // Bản trạng thái đã có trong cache (khách đã ghé Vườn Xanh) được vá ngay: thẻ chỉ đọc cache, không tự tải lại. Chưa có bản nào thì không dựng bản giả.
    queryClient.setQueryData<ArcadeStatus>(ARCADE_STATUS_KEY, (old) => (old ? { ...old, quizClaimed: true } : old));
  }, [queryClient]);
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
          <HomeQuizSheet open={open} real={real} onClose={() => setOpen(false)} onClaimed={onClaimed} />
        </Suspense>
      )}
    </section>
  );
}
