import type { BadgesResponse, DailyMissionClaimResponse, DailyMissionId, DailyMissionsResponse } from '@tubutree/shared-types';
import type { MissionTarget } from '../game-newbie';
import { fillBootCopy } from '../shop-copy-boot';

/** Đích của nút "Làm": việc trong Vườn Xanh cuộn về khối điểm danh và tưới; việc ở gian hàng mở danh mục. */
const DAILY_TARGETS: Record<DailyMissionId, MissionTarget> = {
  DAILY_QUIZ: 'checkin',
  DAILY_PLAY: 'checkin',
  DAILY_WATER: 'checkin',
  DAILY_STORY: 'catalog',
  DAILY_WISHLIST: 'catalog',
};

export type DailyRowState = 'todo' | 'claimable' | 'claimed' | 'done';

export interface DailyRowView {
  id: DailyMissionId;
  title: string;
  /** "+5 💧"; khách vãng lai không được hứa thưởng nên rỗng. */
  reward: string;
  /** todo: chưa làm (nút Làm); claimable: đã làm, chưa nhận (nút Nhận); claimed: đã nhận; done: đã làm nhưng khách vãng lai không nhận được. */
  state: DailyRowState;
  target: MissionTarget;
  aria: string;
}

export function dailyRows(res: DailyMissionsResponse | undefined): DailyRowView[] {
  if (!res?.enabled) return [];
  return res.missions.map((m) => {
    const title = fillBootCopy(`daily.mission.${m.id}`);
    const state: DailyRowState = m.claimed ? 'claimed' : !m.done ? 'todo' : res.pointsBlocked ? 'done' : 'claimable';
    const aria =
      state === 'claimed'
        ? fillBootCopy('daily.claimedAria', { title })
        : state === 'claimable'
          ? fillBootCopy('daily.claimAria', { title })
          : state === 'done'
            ? fillBootCopy('daily.doneAria', { title })
            : fillBootCopy('daily.goAria', { title });
    return { id: m.id, title, reward: res.pointsBlocked ? '' : fillBootCopy('daily.water', { n: res.water }), state, target: DAILY_TARGETS[m.id], aria };
  });
}

/** "2/3" của phần Hôm nay: số nhiệm vụ đã làm (đã nhận hoặc chưa). */
export function dailyProgress(res: DailyMissionsResponse | undefined): string {
  if (!res?.enabled) return '';
  return fillBootCopy('daily.progress', { n: res.missions.filter((m) => m.done || m.claimed).length, total: res.missions.length });
}

/** Dòng thưởng ngày dưới 3 nhiệm vụ. Khách vãng lai không được hứa Điểm Xanh nên không có dòng. */
export function dailyBonusLine(res: DailyMissionsResponse | undefined): string | null {
  if (!res?.enabled || res.pointsBlocked || res.bonusPoints <= 0) return null;
  return fillBootCopy(res.bonusClaimed ? 'daily.bonusDone' : 'daily.bonus', { points: res.bonusPoints });
}

/** Chữ báo sau khi nhận: thưởng thật sau trần (có thể 0 khi Vườn Xanh đã trao đủ hôm nay). */
export function dailyClaimToast(r: Pick<DailyMissionClaimResponse, 'water' | 'points'>): string {
  if (r.water <= 0 && r.points <= 0) return fillBootCopy('daily.toastCapped');
  if (r.points > 0) return fillBootCopy('daily.toastBonus', { n: r.water, points: r.points });
  return fillBootCopy('daily.toastWater', { n: r.water });
}

/**
 * Chấm ở tab Vườn Xanh: hôm nay chưa làm Đố Xanh (khi Đố Xanh đang bật, máy chủ tính sẵn `quizPending`) hoặc chưa điểm danh. Chỉ khi
 * nhiệm vụ hằng ngày bật; dữ liệu chưa về thì không chấm (không nháy lên rồi tắt).
 */
export function gardenDotOn(daily: DailyMissionsResponse | undefined, checkIn: { checkedInToday: boolean } | null | undefined): boolean {
  if (!daily?.enabled) return false;
  return daily.quizPending || checkIn?.checkedInToday === false;
}

/** Nhiệm vụ hằng ngày bật thì lý do "chưa điểm danh" chuyển sang chấm Vườn Xanh, tab Ưu đãi chỉ còn lý do mã sắp hết hạn. */
export const checkInDotMovesToGarden = (daily: DailyMissionsResponse | undefined): boolean => daily?.enabled === true;

/** Chấm ở tab Cá nhân: có thông báo chưa đọc. Tab đã mang số đơn đang xử lý thì số thắng, không vẽ cả hai. */
export function profileDotOn(daily: DailyMissionsResponse | undefined, unread: number | undefined, activeOrders: number): boolean {
  return daily?.enabled === true && (unread ?? 0) > 0 && activeOrders <= 0;
}

export interface BadgeChipView {
  id: string;
  name: string;
  earned: boolean;
  /** Điều kiện đạt, hiện khi khách chạm huy hiệu chưa đạt. */
  how: string;
  aria: string;
}

/** Hàng huy hiệu: đã đạt đứng trước (theo thứ tự gốc), chưa đạt mờ đi và kèm điều kiện. */
export function badgeChips(res: BadgesResponse | undefined): BadgeChipView[] {
  if (!res?.enabled) return [];
  const views = res.badges.map((b) => {
    const name = fillBootCopy(`badges.name.${b.id}`);
    const how = fillBootCopy(`badges.how.${b.id}`);
    return { id: b.id, name, earned: b.earned, how, aria: b.earned ? fillBootCopy('badges.earnedAria', { name }) : fillBootCopy('badges.lockedAria', { name, how }) };
  });
  return [...views.filter((v) => v.earned), ...views.filter((v) => !v.earned)];
}

export function badgeCount(res: BadgesResponse | undefined): string {
  if (!res?.enabled) return '';
  return fillBootCopy('badges.count', { n: res.badges.filter((b) => b.earned).length, total: res.badges.length });
}
