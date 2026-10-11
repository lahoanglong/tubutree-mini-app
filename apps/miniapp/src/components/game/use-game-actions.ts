import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'zmp-ui';
import {
  checkIn,
  collectDew,
  buyStreakFreeze,
  repairStreak,
  spin,
  answerQuiz,
  waterTree,
  buyTree,
  claimMission,
  unlockPlot,
  waterPlot,
  claimSeasonPass,
  giftWater,
  type AnswerResult,
  type HarvestSpecies,
} from '../../services/game-api';
import { haptic } from '../../utils/haptic';
import { getErrorMessage } from '../../services/api';
import { vi } from '../../i18n/vi';
import { formatDrops, formatNumber, formatXu } from '../../utils/format';

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

/**
 * Mọi lệnh ghi của trang Vườn Xanh. Trạng thái giao diện (hộp thu hoạch, đáp án quiz) ở lại trang và
 * đi vào qua callback, để việc ẩn/hiện khối theo tab không làm mất nó. Mỗi mutation giữ nguyên danh sách
 * khoá cần làm mới: số dư Điểm Xanh/xu đọc ở màn Thanh toán, nên thiếu khoá là hiện số cũ.
 */
export function useGameActions({
  onHarvest,
  onAnswered,
}: {
  onHarvest: (reward: HarvestReward | undefined) => void;
  onAnswered: (result: AnswerResult, vars: { id: string; choice: number }) => void;
}) {
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['game'] });
    void queryClient.invalidateQueries({ queryKey: ['me'] });
    // Điểm Xanh/xu vừa đổi → màn Thanh toán đọc số dư từ ['loyalty']/['coins'], phải làm mới
    // cùng lúc, nếu không khách vừa tiêu xong sang checkout vẫn thấy số cũ.
    void queryClient.invalidateQueries({ queryKey: ['loyalty'] });
    void queryClient.invalidateQueries({ queryKey: ['coins'] });
  };
  const onError = (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' });

  const checkInM = useMutation({
    mutationFn: checkIn,
    onSuccess: (r) => {
      const parts = [`+${formatDrops(r.seedsEarned)}`];
      if (r.streakFrozeUsed) parts.push('🧊 đã dùng vé giữ lửa');
      if (r.bonusNote) parts.push(r.bonusNote);
      openSnackbar({ text: parts.join(' · '), type: 'success' });
      refresh();
    },
    onError,
  });
  const dewM = useMutation({
    mutationFn: collectDew,
    onSuccess: (r) => {
      openSnackbar({ text: `Hứng được +${formatDrops(r.seedsEarned)} từ giọt sương sáng 💦`, type: 'success' });
      refresh();
    },
    onError,
  });
  const freezeM = useMutation({
    mutationFn: buyStreakFreeze,
    onSuccess: (r) => {
      openSnackbar({ text: `Đã mua vé giữ lửa 🧊 (còn ${r.streakFreezes} vé)`, type: 'success' });
      refresh();
    },
    onError,
  });
  const repairM = useMutation({
    mutationFn: repairStreak,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['game', 'profile'] });
      haptic('medium');
      openSnackbar({ text: vi.game.streakRepair.ok, type: 'success' });
    },
    onError,
  });
  const giftM = useMutation({
    mutationFn: (recipientId: string) => giftWater(recipientId),
    onSuccess: (r) => {
      openSnackbar({ text: `Đã tặng ${formatDrops(r.amount)} cho bạn 🎁`, type: 'success' });
      refresh();
    },
    onError,
  });
  const handleSpin = async () => {
    try {
      const r = await spin();
      refresh();
      return r;
    } catch (e) {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      throw e;
    }
  };

  const afterWatering = (label: string, r: WateringResult) => {
    if (r.harvested) {
      onHarvest(r.reward);
    } else {
      openSnackbar({ text: `${label} · ${formatNumber(r.progress)}/${formatDrops(r.target)}`, type: 'success' });
    }
    refresh();
    void queryClient.invalidateQueries({ queryKey: ['game', 'forest'] });
  };

  const waterM = useMutation({
    mutationFn: () => waterTree(20),
    onSuccess: (r) => afterWatering('Đã tưới', r),
    onError,
  });
  const buyTreeM = useMutation({
    mutationFn: buyTree,
    onSuccess: (r) => {
      openSnackbar({ text: `Đã góp 1 cây vào quỹ trồng cây 🌳 (−${formatXu(r.cost)}) · mã ${r.certificateCode}`, type: 'success' });
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['game', 'forest'] });
      void queryClient.invalidateQueries({ queryKey: ['coins'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError,
  });
  const unlockM = useMutation({
    mutationFn: (currency: 'SEEDS' | 'XU') => unlockPlot(currency),
    onSuccess: () => {
      openSnackbar({ text: 'Đã mở lô đất mới 🪴', type: 'success' });
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['coins'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError,
  });
  const waterPlotM = useMutation({
    mutationFn: (plotId: string) => waterPlot(plotId, 20),
    onSuccess: (r) => afterWatering('Đã tưới lô', r),
    onError,
  });
  const claimPassM = useMutation({
    mutationFn: ({ tier, track }: { tier: number; track: 'free' | 'premium' }) => claimSeasonPass(tier, track),
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: vi.game.seasonPass.claimOk, type: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['game', 'seasonPass'] });
      void queryClient.invalidateQueries({ queryKey: ['game', 'profile'] });
      void queryClient.invalidateQueries({ queryKey: ['coins'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError,
  });
  const claimMissionM = useMutation({
    mutationFn: (code: string) => claimMission(code),
    onSuccess: (r) => {
      haptic('medium');
      openSnackbar({ text: vi.game.missions.claimOk(r.rewardPoints), type: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['game', 'missions'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError,
  });
  const answerM = useMutation({
    mutationFn: ({ id, choice }: { id: string; choice: number }) => answerQuiz(id, choice),
    onSuccess: (r, vars) => {
      // Hiện reveal "Bạn có biết…"; chỉ sang câu kế khi user bấm "Câu tiếp theo".
      onAnswered(r, vars);
      void queryClient.invalidateQueries({ queryKey: ['game', 'profile'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError,
  });

  return {
    checkInM,
    dewM,
    freezeM,
    repairM,
    giftM,
    handleSpin,
    waterM,
    buyTreeM,
    unlockM,
    waterPlotM,
    claimPassM,
    claimMissionM,
    answerM,
  };
}
