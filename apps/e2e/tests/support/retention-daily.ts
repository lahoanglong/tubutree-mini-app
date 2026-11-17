import { mkdirSync } from 'fs';
import type { Locator, Page } from '@playwright/test';
import type { BadgeId, BadgesResponse, DailyMissionId, DailyMissionsResponse } from '@tubutree/shared-types';
import { mockNewbieGame } from './game-newbie-states';
import type { MockApi } from './mock-api';

/**
 * Dữ liệu và công cụ đo chung cho hai spec retention-daily (Mini App 360px, web 390px/1440px): nhiệm vụ hằng ngày, huy hiệu, chấm nhắc
 * thanh đáy. Mock đọc từ MỘT đối tượng trạng thái nên spec đổi cờ giữa hai lần mở trang (tắt rồi bật) mà không dựng lại mock.
 */

export interface DailyRow {
  id: DailyMissionId;
  done: boolean;
  claimed: boolean;
}

export interface RetentionState {
  dailyEnabled: boolean;
  badgesEnabled: boolean;
  daily: DailyRow[];
  oneTime: typeof ONE_TIME_MISSIONS;
  quizPending: boolean;
  checkedInToday: boolean;
  unread: number;
  activeOrders: number;
  earned: BadgeId[];
}

export const ALL_BADGES: readonly BadgeId[] = ['FIRST_ORDER', 'RECYCLE_3', 'REFILL_5', 'STREAK_7', 'STREAK_30', 'QUIZ_PERFECT_10', 'PHOTO_REVIEW', 'INVITE_1'];

/** Nhiệm vụ một lần (cũ) của thẻ Nhiệm vụ: cả hai chưa xong, để không có nút "Nhận thưởng" cũ lẫn với nút "Nhận" của phần Hôm nay. */
export const ONE_TIME_MISSIONS = [
  { code: 'REVIEW_3', title: 'Đánh giá 3 sản phẩm', rewardPoints: 30, progress: 1, goal: 3, completed: false, claimed: false },
  { code: 'INVITE_3', title: 'Mời 3 bạn bè', rewardPoints: 50, progress: 0, goal: 3, completed: false, claimed: false },
];

/** Một nhiệm vụ một lần đã xong mà chưa nhận: phần một lần phải mở sẵn và không có nút gập. */
export const ONE_TIME_WITH_CLAIMABLE = [{ ...ONE_TIME_MISSIONS[0]!, progress: 3, completed: true }, ONE_TIME_MISSIONS[1]!];

export const CLAIMABLE_ID: DailyMissionId = 'DAILY_WATER';

export function retentionState(over: Partial<RetentionState> = {}): RetentionState {
  return {
    dailyEnabled: false,
    badgesEnabled: false,
    daily: [
      { id: 'DAILY_QUIZ', done: false, claimed: false },
      { id: CLAIMABLE_ID, done: true, claimed: false },
      { id: 'DAILY_STORY', done: true, claimed: true },
    ],
    oneTime: ONE_TIME_MISSIONS,
    quizPending: false,
    checkedInToday: true,
    unread: 0,
    activeOrders: 0,
    earned: ['FIRST_ORDER', 'STREAK_7'],
    ...over,
  };
}

const DAILY_OFF: DailyMissionsResponse = {
  enabled: false,
  dayKey: null,
  missions: [],
  water: 0,
  bonusPoints: 0,
  bonusClaimed: false,
  pointsBlocked: false,
  waterLeft: 0,
  pointsLeft: 0,
  quizPending: false,
};

/** Dựng mọi đường mà Vườn Xanh, Cá nhân và thanh đáy gọi cho gói này; gọi SAU mockSession. */
export function mockRetention(api: MockApi, state: RetentionState): void {
  mockNewbieGame(api, 'after-seedling');
  // /me thật trả cả số dư; trang Tài khoản web tính điểm từ đó (mockSession chỉ trả hồ sơ nên trang đổ vỡ vì thiếu số).
  api.get('/me', () => ({
    id: 'u-retention', fullName: 'Nguyễn Văn An', email: null, dob: null, avatarUrl: null, phone: '0912345678', role: 'CUSTOMER', referralCode: 'AN123',
    onboarded: true, segments: [], pointsBalance: 120, pointsConvertedBalance: 0, walletBalance: 50_000,
  }));
  api.get('/game/missions', () => state.oneTime);
  api.get('/game/daily', (): DailyMissionsResponse =>
    state.dailyEnabled
      ? {
          enabled: true,
          dayKey: '2026-11-17',
          missions: state.daily.map((m) => ({ ...m })),
          water: 5,
          bonusPoints: 10,
          bonusClaimed: false,
          pointsBlocked: false,
          waterLeft: 20,
          pointsLeft: 10,
          quizPending: state.quizPending,
        }
      : DAILY_OFF,
  );
  api.post('/game/daily/:id/claim', ({ params }) => {
    const row = state.daily.find((m) => m.id === params.id);
    if (row) row.claimed = true;
    return { id: params.id, water: 5, points: 0, bonus: false, capped: [], totalSeeds: 70 };
  });
  api.get('/game/badges', (): BadgesResponse =>
    state.badgesEnabled
      ? { enabled: true, badges: ALL_BADGES.map((id) => ({ id, earned: state.earned.includes(id), earnedAt: state.earned.includes(id) ? '2026-11-10T03:00:00.000Z' : null })) }
      : { enabled: false, badges: [] },
  );
  api.get('/me/daily-check-in', () => ({
    checkedInToday: state.checkedInToday,
    pointsDone: true,
    waterDone: state.checkedInToday,
    streakDays: 3,
    currentCycleDay: 3,
    todayPoints: 0,
    todayWater: state.checkedInToday ? 0 : 10,
    rewards: [],
  }));
  api.get('/me/summary', () => ({
    orders: { pending_payment: 0, processing: 0, shipping: 0, delivered: 0, closed: 0, active: state.activeOrders },
    unreadNotifications: state.unread,
    activeSubscriptions: 0,
  }));
  api.get('/orders/active-count', () => ({ count: state.activeOrders }));
  api.get('/me/notifications', []);
  api.post('/events', { accepted: 0 });
  api.allowUnmocked('GET /me/wallet', 'GET /auth/me', 'GET /dealer/me', 'GET /brand/owner/me', 'GET /chat/summary', 'GET /affiliate/me');
}

/**
 * Lỗi trang chưa bắt (pageerror) trong suốt ca. Bỏ qua "access control checks": WebKit báo vậy khi `page.goto` lần hai huỷ lô sự kiện
 * analytics đang bay (app đã bắt lỗi này, xem flushEventQueue), không phải lỗi của màn đang đo.
 */
export function collectPageErrors(page: Page): string[] {
  const crashed: string[] = [];
  page.on('pageerror', (e) => {
    if (!/due to access control checks/.test(e.message)) crashed.push(e.message);
  });
  return crashed;
}

/** Chiều cao nội dung trang: Mini cuộn trong `.zaui-page`, web cuộn ở tài liệu; lấy số lớn hơn của hai vùng cuộn. */
export async function contentHeight(page: Page): Promise<{ doc: number; zaui: number; height: number }> {
  const m = await page.evaluate(() => {
    const doc = (document.scrollingElement ?? document.documentElement).scrollHeight;
    const zaui = document.querySelector<HTMLElement>('.zaui-page')?.scrollHeight ?? 0;
    return { doc, zaui };
  });
  return { ...m, height: Math.max(m.doc, m.zaui) };
}

/** Không tràn ngang: tài liệu và vùng cuộn Mini (nếu có) đều không rộng hơn khung nhìn. */
export async function horizontalOverflow(page: Page): Promise<{ doc: number; docClient: number; zaui: number; zauiClient: number; ok: boolean }> {
  return page.evaluate(() => {
    const el = document.documentElement;
    const zp = document.querySelector<HTMLElement>('.zaui-page');
    const r = { doc: el.scrollWidth, docClient: el.clientWidth, zaui: zp?.scrollWidth ?? 0, zauiClient: zp?.clientWidth ?? 0 };
    return { ...r, ok: r.doc <= r.docClient && (!zp || r.zaui <= r.zauiClient) };
  });
}

/** Kích thước và hoạt ảnh của một chấm nhắc. */
export async function dotFacts(dot: Locator): Promise<{ width: number; height: number; animationName: string }> {
  const box = await dot.boundingBox();
  const animationName = await dot.evaluate((el) => getComputedStyle(el).animationName);
  return { width: box?.width ?? 0, height: box?.height ?? 0, animationName };
}

export const SHOT_DIR = process.env.RETENTION_SHOTS_DIR ?? '/tmp/review/tubu/shots/waves/tubu-retention-daily';

/** Cuộn phần tử lên đầu khung nhìn (cả vùng cuộn `.zaui-page` của Mini lẫn tài liệu web) rồi chụp; lỗi ghi file chỉ in ra, không làm ca đỏ. */
export async function shoot(page: Page, name: string, anchor?: Locator): Promise<void> {
  try {
    if (anchor) {
      await anchor.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>('.zaui-page').forEach((p) => {
          p.scrollTop = Math.max(0, p.scrollTop - 64);
        });
        window.scrollBy(0, -64);
      });
    }
    await page.waitForTimeout(250);
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, animations: 'disabled' });
  } catch (e) {
    console.log(`RETENTION_SHOT_FAIL ${name}: ${String(e)}`);
  }
}
