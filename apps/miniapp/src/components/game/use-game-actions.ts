import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'zmp-ui';
import { checkInSuccessText } from '@tubutree/app-core/daily-check-in-copy';
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
  type AnswerResult,
  type HarvestCouponCap,
  type HarvestReward,
} from '../../services/game-api';
import { haptic } from '../../utils/haptic';
import { getErrorMessage, isStaleStateError } from '../../services/api';
import { isHttpError } from '../../services/http';
import { gameMoreCopy, isStaleQuizMessage } from '@tubutree/app-core/game-more-copy';
import { vi } from '../../i18n/vi';
import { formatDrops, formatPoints } from '../../utils/format';
import { settleWithin } from '../../utils/settle-within';
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
  /** Lần thu hoạch có cây mầm (nhận điểm, không góp quỹ). */
  sprout: boolean;
}

interface WateringResult {
  harvested: boolean;
  progress: number;
  target: number;
  couponCapped?: HarvestCouponCap | 'GUEST';
  rewardBlocked?: 'GUEST' | string;
  reward?: HarvestReward & { coupons?: (string | { code: string })[] };
}

const harvestMeta = (r: WateringResult): HarvestMeta => {
  const list = (r.reward?.coupons ?? []).map((c) => (typeof c === 'string' ? c : c.code)).filter(Boolean);
  const coupons = list.length > 0 ? list : r.reward?.coupon ? [r.reward.coupon] : [];
  return {
    couponCapped: r.couponCapped === 'DAY' || r.couponCapped === 'MONTH' || r.couponCapped === 'OFF' ? r.couponCapped : null,
    guest: r.couponCapped === 'GUEST' || r.rewardBlocked === 'GUEST',
    coupons,
    nextTarget: r.target,
    sprout: r.reward?.sprout === true,
  };
};

/**
 * Mọi lệnh ghi của trang Vườn Xanh. Trạng thái giao diện (hộp thu hoạch, đáp án quiz) ở lại trang và
 * đi vào qua callback, để việc ẩn/hiện khối theo tab không làm mất nó. Mỗi mutation giữ nguyên danh sách
 * khoá cần làm mới: số dư Điểm Xanh đọc ở màn Thanh toán, nên thiếu khoá là hiện số cũ.
 */
export function useGameActions({
  onHarvest,
  onAnswered,
}: {
  onHarvest: (reward: HarvestReward | undefined, meta: HarvestMeta) => void;
  onAnswered: (result: AnswerResult, vars: { id: string; choice: number }) => void;
}) {
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['game'] }),
      queryClient.invalidateQueries({ queryKey: ['me'] }),
      // Điểm Xanh vừa đổi → màn Thanh toán đọc số dư từ ['loyalty'], phải làm mới cùng lúc, nếu không
      // khách vừa tiêu xong sang checkout vẫn thấy số cũ.
      queryClient.invalidateQueries({ queryKey: ['loyalty'] }),
    ]);
  // Việc một-lần (nhận thưởng, hứng sương, mở lô) giữ khoá tới khi dữ liệu mới về: nhả sớm thì nút còn sáng trên dữ liệu cũ và
  // cú chạm kế tiếp bị máy chủ từ chối ngay sau lời báo thành công. Có hạn để mạng chậm không giữ nút lâu hơn lệnh vừa xong.
  const refreshThenRelease = () => settleWithin(refresh());
  // Hết thời gian: máy chủ có thể đã ghi nhận thao tác, nên làm mới để màn hình khớp với sổ.
  const onError = (e: unknown) => {
    openSnackbar({ text: getErrorMessage(e), type: 'error' });
    if (isHttpError(e) && e.code === 'ECONNABORTED') void refresh();
  };

  // Máy chủ từ chối một việc một-lần bằng 400/404/409 (đã nhận, lô đã đổi, không còn đủ điều kiện): thẻ đang hiện đã cũ nên tải lại
  // rồi mới nhả khoá. Nhả ngay thì nút còn sáng trên dữ liệu cũ và chạm lại nhận đúng lời từ chối đó. Mất mạng, quá hạn, 401 và 5xx
  // không nói gì về trạng thái thật nên không tải lại ở đây.
  const onRejectedOnce = (e: unknown) => {
    onError(e);
    return isStaleStateError(e) ? refreshThenRelease() : undefined;
  };

  const checkInM = useLockedMutation({
    mutationFn: checkIn,
    onSuccess: (r) => {
      openSnackbar({ text: checkInSuccessText(r), type: r.pending.length > 0 ? 'warning' : 'success' });
      // Cả hai phần xong thì khoá nút ngay, đừng chờ refetch (trong lúc đó nút Vườn Xanh sẽ bật lại).
      if (r.pending.length === 0) {
        queryClient.setQueryData<{ checkedInToday: boolean }>(['loyalty-checkin'], (old) => (old ? { ...old, checkedInToday: true } : old));
      }
      void queryClient.invalidateQueries({ queryKey: ['loyalty-checkin'] });
      void queryClient.invalidateQueries({ queryKey: ['points-txn'] });
      void refresh();
    },
    onError,
  });
  const dewM = useLockedMutation({
    mutationFn: collectDew,
    onSuccess: (r) => {
      openSnackbar({ text: `Hứng được +${formatDrops(r.seedsEarned)} từ giọt sương sáng 💦`, type: 'success' });
      return refreshThenRelease();
    },
    onError: onRejectedOnce,
  });
  const freezeM = useLockedMutation({
    mutationFn: buyStreakFreeze,
    onSuccess: (r) => {
      openSnackbar({ text: `Đã mua vé giữ lửa 🧊 (còn ${r.streakFreezes} vé)`, type: 'success' });
      void refresh();
    },
    onError,
  });
  const repairM = useLockedMutation({
    mutationFn: repairStreak,
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: vi.game.streakRepair.ok, type: 'success' });
      return settleWithin(queryClient.invalidateQueries({ queryKey: ['game', 'profile'] }));
    },
    onError: onRejectedOnce,
  });
  const handleSpin = async () => {
    try {
      const r = await spin();
      void refresh();
      return r;
    } catch (e) {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      throw e;
    }
  };

  const afterWatering = (label: string, r: WateringResult) => {
    if (r.harvested) {
      onHarvest(r.reward, harvestMeta(r));
    } else {
      const left = Math.max(0, r.target - r.progress);
      openSnackbar({ text: `${label} · còn ${formatDrops(left)} nữa là thu hoạch`, type: 'success' });
    }
    void refresh();
    void queryClient.invalidateQueries({ queryKey: ['game', 'forest'] });
  };

  const waterM = useLockedMutation({
    mutationFn: (drops: number) => waterTree(drops),
    onSuccess: (r, drops) => afterWatering(`Đã tưới −${formatDrops(drops)}`, r),
    // Tưới 0💧 là nút Thu hoạch: cây đã thu hoạch ở máy khác thì nút này chỉ đúng trên hồ sơ cũ, nên bị từ chối phải tải lại.
    // Tưới thường bị từ chối (thiếu nước…) thì chỉ báo, vì lượt sau là một quyết định mới của khách.
    onError: (e, drops) => (drops === 0 ? onRejectedOnce(e) : onError(e)),
  });
  // Khoá chống chạm đúp của lượt góp nằm ở TreeActions (cần biết kết quả để quyết định đóng hộp hay giữ key), nên
  // đây dùng useMutation thường và caller gọi mutateAsync.
  const buyTreeM = useMutation({
    mutationFn: (idempotencyKey: string) => buyTree(idempotencyKey),
    onSuccess: (r) => {
      openSnackbar({ text: `Đã góp 1 cây vào quỹ trồng cây 🌳 (−${formatPoints(r.cost)}) · mã ${r.certificateCode}`, type: 'success' });
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ['game', 'forest'] });
    },
    onError,
  });
  const unlockM = useLockedMutation({
    mutationFn: (slot: number) => unlockPlot(slot),
    onSuccess: () => {
      openSnackbar({ text: 'Đã mở lô đất mới 🪴', type: 'success' });
      return refreshThenRelease();
    },
    onError: onRejectedOnce,
  });
  const waterPlotM = useLockedMutation({
    mutationFn: (plotId: string) => waterPlot(plotId, 20),
    onSuccess: (r) => afterWatering(`Đã tưới lô −${formatDrops(20)}`, r),
    onError: onRejectedOnce,
  }, (plotId) => plotId);
  const claimPassM = useLockedMutation({
    mutationFn: ({ tier, track }: { tier: number; track: 'free' | 'premium' }) => claimSeasonPass(tier, track),
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: vi.game.seasonPass.claimOk, type: 'success' });
      return settleWithin(
        Promise.all([
          queryClient.invalidateQueries({ queryKey: ['game', 'seasonPass'] }),
          queryClient.invalidateQueries({ queryKey: ['game', 'profile'] }),
          // Thưởng bậc có thể là Điểm Xanh.
          queryClient.invalidateQueries({ queryKey: ['loyalty'] }),
        ]),
      );
    },
    onError: onRejectedOnce,
  }, ({ tier, track }) => `${tier}:${track}`);
  const claimMissionM = useLockedMutation({
    mutationFn: (code: string) => claimMission(code),
    onSuccess: (r) => {
      haptic('medium');
      openSnackbar({ text: vi.game.missions.claimOk(r.rewardPoints), type: 'success' });
      return settleWithin(
        Promise.all([
          queryClient.invalidateQueries({ queryKey: ['game', 'missions'] }),
          queryClient.invalidateQueries({ queryKey: ['me'] }),
          // Thưởng nhiệm vụ cộng Điểm Xanh: màn Thanh toán đọc số dư từ ['loyalty'].
          queryClient.invalidateQueries({ queryKey: ['loyalty'] }),
        ]),
      );
    },
    onError: onRejectedOnce,
  }, (code) => code);
  const answerM = useLockedMutation({
    mutationFn: ({ id, choice }: { id: string; choice: number }) => answerQuiz(id, choice),
    onSuccess: (r, vars) => {
      // Hiện reveal "Bạn có biết…"; chỉ sang câu kế khi user bấm "Câu tiếp theo".
      onAnswered(r, vars);
      void queryClient.invalidateQueries({ queryKey: ['game', 'profile'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: unknown) => {
      const message = getErrorMessage(e);
      if (!isStaleQuizMessage(message)) return onError(e);
      openSnackbar({ text: gameMoreCopy.quiz.staleSet, type: 'warning' });
      void queryClient.invalidateQueries({ queryKey: ['game', 'quiz'] });
    },
  }, ({ id }) => id);

  return {
    checkInM,
    dewM,
    freezeM,
    repairM,
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
