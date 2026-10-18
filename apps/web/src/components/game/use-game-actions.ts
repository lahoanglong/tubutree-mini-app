'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  answerQuiz,
  buyStreakFreeze,
  buyTree,
  checkIn,
  claimMission,
  collectDew,
  repairStreak,
  spin,
  waterTree,
  type AnswerResult,
  type HarvestSpecies,
} from '@tubutree/app-core/api/game';
import { coreHttp } from '@/lib/core-http';
import { formatDrops, formatNumber, formatPoints } from './format';
import { useLockedMutation } from './use-locked-mutation';

export interface HarvestReward {
  coupon?: string;
  certificate?: string;
  species?: HarvestSpecies;
}

interface WateringResult {
  harvested: boolean;
  progress: number;
  target: number;
  reward?: HarvestReward;
}

type Notify = (text: string, tone: 'success' | 'error') => void;

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

/**
 * Mọi lệnh ghi của trang Vườn Xanh. Trạng thái giao diện (hộp thu hoạch, đáp án quiz) ở lại trang và đi vào qua
 * callback, để việc ẩn/hiện khối theo tab không làm mất nó. Mỗi mutation giữ nguyên danh sách khoá cần làm mới: số dư
 * Điểm Xanh đọc ở màn Thanh toán, nên thiếu khoá là hiện số cũ.
 */
export function useGameActions({
  notify,
  onHarvest,
  onAnswered,
}: {
  notify: Notify;
  onHarvest: (reward: HarvestReward | undefined) => void;
  onAnswered: (result: AnswerResult, vars: { id: string; choice: number }) => void;
}) {
  const queryClient = useQueryClient();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['game'] });
    void queryClient.invalidateQueries({ queryKey: ['me'] });
    // Điểm Xanh vừa đổi → màn Thanh toán đọc số dư từ ['loyalty'], phải làm mới cùng lúc, nếu không
    // khách vừa tiêu xong sang checkout vẫn thấy số cũ.
    void queryClient.invalidateQueries({ queryKey: ['loyalty'] });
  };
  const onError = (e: unknown) => notify(errText(e), 'error');

  const checkInM = useLockedMutation({
    mutationFn: () => checkIn(coreHttp),
    onSuccess: (r) => {
      const parts = [`+${formatDrops(r.seedsEarned)}`];
      if (r.streakFrozeUsed) parts.push('🧊 đã dùng vé giữ lửa');
      if (r.bonusNote) parts.push(r.bonusNote);
      notify(parts.join(' · '), 'success');
      refresh();
    },
    onError,
  });
  const dewM = useLockedMutation({
    mutationFn: () => collectDew(coreHttp),
    onSuccess: (r) => {
      notify(`Hứng được +${formatDrops(r.seedsEarned)} từ giọt sương sáng 💦`, 'success');
      refresh();
    },
    onError,
  });
  const freezeM = useLockedMutation({
    mutationFn: () => buyStreakFreeze(coreHttp),
    onSuccess: (r) => {
      notify(`Đã mua vé giữ lửa 🧊 (còn ${r.streakFreezes} vé)`, 'success');
      refresh();
    },
    onError,
  });
  const repairM = useLockedMutation({
    mutationFn: () => repairStreak(coreHttp),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['game', 'profile'] });
      notify('Đã hồi sinh chuỗi! 🌿', 'success');
    },
    onError,
  });
  const handleSpin = async () => {
    try {
      const r = await spin(coreHttp);
      refresh();
      return r;
    } catch (e) {
      notify(errText(e), 'error');
      throw e;
    }
  };

  const afterWatering = (label: string, r: WateringResult) => {
    if (r.harvested) {
      onHarvest(r.reward);
    } else {
      notify(`${label} · ${formatNumber(r.progress)}/${formatDrops(r.target)}`, 'success');
    }
    refresh();
    void queryClient.invalidateQueries({ queryKey: ['game', 'forest'] });
  };

  const waterM = useLockedMutation({
    mutationFn: () => waterTree(coreHttp, 20),
    onSuccess: (r) => afterWatering('Đã tưới', r),
    onError,
  });
  // Khoá chống bấm đúp của lượt góp nằm ở TreeActions (cần biết kết quả để quyết định đóng hộp hay giữ key), nên
  // đây dùng useMutation thường và caller gọi mutateAsync.
  const buyTreeM = useMutation({
    mutationFn: (idempotencyKey: string) => buyTree(coreHttp, idempotencyKey),
    onSuccess: (r) => {
      notify(`Đã góp 1 cây vào quỹ trồng cây 🌳 (−${formatPoints(r.cost)}) · mã ${r.certificateCode}`, 'success');
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['game', 'forest'] });
    },
    onError,
  });
  const claimMissionM = useLockedMutation(
    {
      mutationFn: (code: string) => claimMission(coreHttp, code),
      onSuccess: (r) => {
        notify(`Đã nhận +${formatNumber(r.rewardPoints)} Điểm Xanh! 🌿`, 'success');
        void queryClient.invalidateQueries({ queryKey: ['game', 'missions'] });
        void queryClient.invalidateQueries({ queryKey: ['me'] });
      },
      onError,
    },
    (code) => code,
  );
  const answerM = useLockedMutation(
    {
      mutationFn: ({ id, choice }: { id: string; choice: number }) => answerQuiz(coreHttp, id, choice),
      onSuccess: (r, vars) => {
        // Hiện reveal "Bạn có biết…"; chỉ sang câu kế khi khách bấm "Câu tiếp theo".
        onAnswered(r, vars);
        void queryClient.invalidateQueries({ queryKey: ['game', 'profile'] });
        void queryClient.invalidateQueries({ queryKey: ['me'] });
      },
      onError,
    },
    ({ id }) => id,
  );

  return { checkInM, dewM, freezeM, repairM, handleSpin, waterM, buyTreeM, claimMissionM, answerM };
}
