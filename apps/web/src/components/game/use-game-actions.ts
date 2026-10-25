'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  answerQuiz,
  buyStreakFreeze,
  buyTree,
  checkIn,
  claimMission,
  claimSeasonPass,
  collectDew,
  giftWater,
  repairStreak,
  shareHarvest,
  spin,
  unlockPlot,
  waterPlot,
  waterTree,
  type AnswerResult,
  type HarvestCouponCap,
  type HarvestReward,
} from '@tubutree/app-core/api/game';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { coreHttp } from '@/lib/core-http';
import { formatDrops, formatNumber, formatPoints } from './format';
import { useLockedMutation } from './use-locked-mutation';

export type { HarvestReward };

/** Phần của phản hồi tưới mà hộp chúc mừng cần ngoài `reward`. */
export interface HarvestMeta {
  couponCapped: HarvestCouponCap | null;
  /** Khách vãng lai: API không cấp mã và điểm cây mầm (`couponCapped` hoặc `rewardBlocked` = 'GUEST'). */
  guest: boolean;
  /** Mọi mã của lần thu hoạch: `coupons` nếu có, không thì `coupon` cũ. */
  coupons: string[];
  /** 💧 cần cho cây kế tiếp (target sau thu hoạch). */
  nextTarget: number;
}

interface WateringResult {
  harvested: boolean;
  progress: number;
  target: number;
  couponCapped?: HarvestCouponCap | 'GUEST';
  rewardBlocked?: 'GUEST' | string;
  reward?: HarvestReward;
}

const harvestMeta = (r: WateringResult): HarvestMeta => {
  const list = (r.reward?.coupons ?? []).filter(Boolean);
  const coupons = list.length > 0 ? list : r.reward?.coupon ? [r.reward.coupon] : [];
  return {
    couponCapped: r.couponCapped === 'DAY' || r.couponCapped === 'MONTH' ? r.couponCapped : null,
    guest: r.couponCapped === 'GUEST' || r.rewardBlocked === 'GUEST',
    coupons,
    nextTarget: r.target,
  };
};

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
  onHarvest: (reward: HarvestReward | undefined, meta: HarvestMeta) => void;
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
  const giftM = useLockedMutation(
    {
      mutationFn: (recipientId: string) => giftWater(coreHttp, recipientId),
      onSuccess: (r) => {
        notify(`Đã tặng ${formatDrops(r.amount)} cho bạn 🎁`, 'success');
        refresh();
      },
      onError,
    },
    (recipientId) => recipientId,
  );
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
      onHarvest(r.reward, harvestMeta(r));
    } else {
      notify(`${label} · ${formatNumber(r.progress)}/${formatDrops(r.target)}`, 'success');
    }
    refresh();
    void queryClient.invalidateQueries({ queryKey: ['game', 'forest'] });
  };

  const waterM = useLockedMutation({
    mutationFn: (drops: number) => waterTree(coreHttp, drops),
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
  const unlockM = useLockedMutation({
    mutationFn: (slot: number) => unlockPlot(coreHttp, slot),
    onSuccess: () => {
      notify('Đã mở lô đất mới 🪴', 'success');
      refresh();
    },
    onError,
  });
  const waterPlotM = useLockedMutation(
    {
      mutationFn: (plotId: string) => waterPlot(coreHttp, plotId, 20),
      onSuccess: (r) => afterWatering('Đã tưới lô', r),
      onError,
    },
    (plotId) => plotId,
  );
  const claimPassM = useLockedMutation(
    {
      mutationFn: ({ tier, track }: { tier: number; track: 'free' | 'premium' }) => claimSeasonPass(coreHttp, tier, track),
      onSuccess: () => {
        notify('Đã nhận thưởng chặng mùa! 🎉', 'success');
        void queryClient.invalidateQueries({ queryKey: ['game', 'seasonPass'] });
        void queryClient.invalidateQueries({ queryKey: ['game', 'profile'] });
        // Thưởng bậc có thể là Điểm Xanh.
        void queryClient.invalidateQueries({ queryKey: ['loyalty'] });
      },
      onError,
    },
    ({ tier, track }) => `${tier}:${track}`,
  );
  const claimMissionM = useLockedMutation(
    {
      mutationFn: (code: string) => claimMission(coreHttp, code),
      onSuccess: (r) => {
        notify(`Đã nhận +${formatNumber(r.rewardPoints)} Điểm Xanh! 🌿`, 'success');
        void queryClient.invalidateQueries({ queryKey: ['game', 'missions'] });
        void queryClient.invalidateQueries({ queryKey: ['me'] });
        // Thưởng nhiệm vụ cộng Điểm Xanh: màn Thanh toán đọc số dư từ ['loyalty'].
        void queryClient.invalidateQueries({ queryKey: ['loyalty'] });
      },
      onError,
    },
    (code) => code,
  );
  const shareHarvestM = useLockedMutation({
    mutationFn: () => shareHarvest(coreHttp),
    onSuccess: () => {
      notify(gameNewbieCopy.harvest.shareCommunityOk, 'success');
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
    onError,
  });
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

  return { checkInM, dewM, freezeM, repairM, giftM, handleSpin, waterM, buyTreeM, unlockM, waterPlotM, claimPassM, claimMissionM, answerM, shareHarvestM };
}
