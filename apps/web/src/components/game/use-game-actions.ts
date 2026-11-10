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
import { checkInSuccessText } from '@tubutree/app-core/daily-check-in-copy';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { coreHttp } from '@/lib/core-http';
import { formatDrops, formatNumber, formatPoints } from './format';
import { useLockedMutation } from './use-locked-mutation';
import { NetworkError } from '@/lib/client-api';
import { gameMoreCopy, isStaleQuizMessage } from '@tubutree/app-core/game-more-copy';
import { actionErrorText } from '@/lib/error-text';
import { serverRejectedState } from '@/lib/server-rejected-state';
import { settleWithin } from '@/lib/settle-within';

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
  /** Chỉ cây ở lô nhà mới chia sẻ được; lô phụ thì ẩn nút. */
  canShare: boolean;
}

interface WateringResult {
  harvested: boolean;
  progress: number;
  target: number;
  couponCapped?: HarvestCouponCap | 'GUEST';
  rewardBlocked?: 'GUEST' | string;
  reward?: HarvestReward;
}

const harvestMeta = (r: WateringResult, home: boolean): HarvestMeta => {
  const list = (r.reward?.coupons ?? []).filter(Boolean);
  const coupons = list.length > 0 ? list : r.reward?.coupon ? [r.reward.coupon] : [];
  return {
    couponCapped: r.couponCapped === 'DAY' || r.couponCapped === 'MONTH' || r.couponCapped === 'OFF' ? r.couponCapped : null,
    guest: r.couponCapped === 'GUEST' || r.rewardBlocked === 'GUEST',
    coupons,
    nextTarget: r.target,
    sprout: r.reward?.sprout === true,
    canShare: home,
  };
};

type Notify = (text: string, tone: 'success' | 'error') => void;

const errText = actionErrorText;

/** Khoá của lệnh tặng nước: nơi vẽ nút đọc `useMutationState` theo khoá này để biết MỌI bạn đang được tặng (`giftM.variables` chỉ giữ lệnh sau cùng). */
export const GIFT_MUTATION_KEY = ['game', 'gift'] as const;


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

  // Trả lời hứa tải lại để `onSuccess` trả ra: TanStack Query đợi nó trước `onSettled`, nên khoá của lệnh còn giữ (nút còn bận)
  // cho tới khi số nước/điểm/lô mới về. Nhả sớm hơn thì nút bấm được lúc màn còn số cũ: tưới tiếp theo số cũ, nhận thưởng lần hai.
  // Mọi chỗ trả lời hứa qua `settleWithin` (hạn 4 giây): làm mới treo (mạng chậm) không giữ nút bận lâu hơn lệnh vừa thành công.
  const refresh = (): Promise<unknown> =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['game'] }),
      queryClient.invalidateQueries({ queryKey: ['me'] }),
      // Điểm Xanh vừa đổi → màn Thanh toán đọc số dư từ ['loyalty'], phải làm mới cùng lúc, nếu không
      // khách vừa tiêu xong sang checkout vẫn thấy số cũ.
      queryClient.invalidateQueries({ queryKey: ['loyalty'] }),
    ]);
  // Hết thời gian: máy chủ có thể đã ghi nhận thao tác, nên làm mới để màn hình khớp với sổ.
  const onError = (e: unknown) => {
    notify(errText(e), 'error');
    if (e instanceof NetworkError && e.timedOut) return settleWithin(refresh());
  };
  // Việc một-lần bị từ chối bằng 400/404/409: danh sách bạn và số nước đang hiện đã cũ, nên tải lại rồi mới nhả khoá (nhả ngay thì nút còn sáng
  // trên dữ liệu cũ và chạm lại nhận đúng lời từ chối đó). Lời lỗi đã hiện trước khi chờ.
  const onRejectedOnce = (e: unknown) => onError(e) ?? (serverRejectedState(e) ? settleWithin(refresh()) : undefined);

  const checkInM = useLockedMutation({
    mutationFn: () => checkIn(coreHttp),
    onSuccess: (r) => {
      notify(checkInSuccessText(r), r.pending.length > 0 ? 'error' : 'success');
      // Cả hai phần xong thì khoá nút ngay, đừng chờ refetch (trong lúc đó nút Vườn Xanh sẽ bật lại).
      if (r.pending.length === 0) {
        queryClient.setQueryData<{ checkedInToday: boolean }>(['loyalty-checkin'], (old) => (old ? { ...old, checkedInToday: true } : old));
      }
      return settleWithin(
        Promise.all([
          queryClient.invalidateQueries({ queryKey: ['loyalty-checkin'] }),
          queryClient.invalidateQueries({ queryKey: ['points-txn'] }),
          refresh(),
        ]),
      );
    },
    // Trạng thái điểm danh nằm ở ['loyalty-checkin'] (không thuộc ['loyalty']) cạnh hồ sơ ['game'], nên bị từ chối vì đã điểm danh
    // thì phải tải lại cả hai, kẻo nút còn sáng trên dữ liệu cũ.
    onError: (e: unknown) =>
      onError(e) ?? (serverRejectedState(e) ? settleWithin(Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['loyalty-checkin'] })])) : undefined),
  });
  const dewM = useLockedMutation({
    mutationFn: () => collectDew(coreHttp),
    onSuccess: (r) => {
      notify(`Hứng được +${formatDrops(r.seedsEarned)} từ giọt sương sáng 💦`, 'success');
      return settleWithin(refresh());
    },
    onError: onRejectedOnce,
  });
  const freezeM = useLockedMutation({
    mutationFn: () => buyStreakFreeze(coreHttp),
    onSuccess: (r) => {
      notify(`Đã mua vé giữ lửa 🧊 (còn ${r.streakFreezes} vé)`, 'success');
      return settleWithin(refresh());
    },
    onError: onRejectedOnce,
  });
  const repairM = useLockedMutation({
    mutationFn: () => repairStreak(coreHttp),
    onSuccess: () => {
      notify('Đã hồi sinh chuỗi! 🌿', 'success');
      return settleWithin(queryClient.invalidateQueries({ queryKey: ['game', 'profile'] }));
    },
    onError: onRejectedOnce,
  });
  const giftM = useLockedMutation(
    {
      mutationKey: GIFT_MUTATION_KEY,
      mutationFn: (recipientId: string) => giftWater(coreHttp, recipientId),
      onSuccess: (r) => {
        notify(`Đã tặng ${formatDrops(r.amount)} cho bạn 🎁`, 'success');
        return settleWithin(refresh());
      },
      onError: onRejectedOnce,
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
      if (e instanceof NetworkError && e.timedOut) refresh();
      throw e;
    }
  };

  const afterWatering = (label: string, r: WateringResult, home: boolean): Promise<unknown> => {
    if (r.harvested) {
      onHarvest(r.reward, harvestMeta(r, home));
    } else {
      notify(`${label} · còn ${formatDrops(Math.max(0, r.target - r.progress))} nữa là thu hoạch`, 'success');
    }
    return settleWithin(Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['game', 'forest'] })]));
  };

  const waterM = useLockedMutation({
    mutationFn: (drops: number) => waterTree(coreHttp, drops),
    onSuccess: (r, drops) => afterWatering(`Đã tưới −${formatDrops(drops)}`, r, true),
    onError: onRejectedOnce,
  });
  // Khoá chống bấm đúp của lượt góp nằm ở TreeActions (cần biết kết quả để quyết định đóng hộp hay giữ key), nên
  // đây dùng useMutation thường và caller gọi mutateAsync.
  const buyTreeM = useMutation({
    mutationFn: (idempotencyKey: string) => buyTree(coreHttp, idempotencyKey),
    onSuccess: (r) => {
      notify(`Đã góp 1 cây vào quỹ trồng cây 🌳 (−${formatPoints(r.cost)}) · mã ${r.certificateCode}`, 'success');
      return settleWithin(Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['game', 'forest'] })]));
    },
    // Promise của onError được chờ trước khi mutateAsync từ chối, nên khoá ref ở TreeFund giữ tới khi dữ liệu mới về.
    onError: onRejectedOnce,
  });
  const unlockM = useLockedMutation({
    mutationFn: (slot: number) => unlockPlot(coreHttp, slot),
    onSuccess: () => {
      notify('Đã mở lô đất mới 🪴', 'success');
      return settleWithin(refresh());
    },
    onError: onRejectedOnce,
  });
  const waterPlotM = useLockedMutation(
    {
      mutationFn: (plotId: string) => waterPlot(coreHttp, plotId, 20),
      onSuccess: (r) => afterWatering(`Đã tưới lô −${formatDrops(20)}`, r, false),
      onError: onRejectedOnce,
    },
    (plotId) => plotId,
  );
  const claimPassM = useLockedMutation(
    {
      mutationFn: ({ tier, track }: { tier: number; track: 'free' | 'premium' }) => claimSeasonPass(coreHttp, tier, track),
      onSuccess: () => {
        notify('Đã nhận thưởng chặng mùa! 🎉', 'success');
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
    },
    ({ tier, track }) => `${tier}:${track}`,
  );
  const claimMissionM = useLockedMutation(
    {
      mutationFn: (code: string) => claimMission(coreHttp, code),
      onSuccess: (r) => {
        notify(`Đã nhận +${formatNumber(r.rewardPoints)} Điểm Xanh! 🌿`, 'success');
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
    },
    (code) => code,
  );
  const shareHarvestM = useLockedMutation({
    mutationFn: () => shareHarvest(coreHttp),
    onSuccess: (r) => {
      notify(r.alreadyShared ? gameNewbieCopy.harvest.shareCommunityAlready : gameNewbieCopy.harvest.shareCommunityOk, 'success');
      return settleWithin(queryClient.invalidateQueries({ queryKey: ['feed'] }));
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
      onError: (e: unknown) => {
        if (!isStaleQuizMessage(errText(e))) return onError(e);
        notify(gameMoreCopy.quiz.staleSet, 'error');
        return settleWithin(queryClient.invalidateQueries({ queryKey: ['game', 'quiz'] }));
      },
    },
    ({ id }) => id,
  );

  return { checkInM, dewM, freezeM, repairM, giftM, handleSpin, waterM, buyTreeM, unlockM, waterPlotM, claimPassM, claimMissionM, answerM, shareHarvestM };
}
