import { expect, type Locator, type Page } from '@playwright/test';
import type { MiniStartResponse, MiniSubmitResponse, MiniTodayResponse } from '@tubutree/shared-types';
import { gameCopy } from '../../../../packages/app-core/src/game-mini/copy';
import { reply, type MockApi } from './mock-api';

/** Dữ liệu và thao tác chung của spec game mini (Đố Xanh, Đúng Thùng) ở Mini App và web: API mock như máy chủ thật khi cờ game.mini.* bật. */

export { gameCopy };

export function miniToday(over: Partial<MiniTodayResponse> = {}): MiniTodayResponse {
  return {
    dayKey: '2026-11-17',
    games: [
      { game: 'sort', items: 10, timeLimitMs: 45_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
      { game: 'daily_quiz', items: 3, timeLimitMs: 60_000, rewardedRoundsPerDay: 1, rewardedRoundsLeft: 1, playedToday: 0 },
    ],
    rewardEligible: true,
    noRewardReason: null,
    caps: { waterUsed: 0, waterCap: 40, pointsUsed: 0, pointsCap: 100, accountCapReached: false, pointsBudgetExhausted: false },
    dailyQuizDoneToday: false,
    ...over,
  };
}

const round = (game: 'daily_quiz' | 'sort', content: MiniStartResponse['content'], over: Partial<MiniStartResponse> = {}): MiniStartResponse => {
  const now = Date.now();
  return {
    game,
    roundId: `r-${game}`,
    token: null,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 10 * 60_000).toISOString(),
    rewarded: true,
    noRewardReason: null,
    content,
    ...over,
  };
};

export const QUIZ_PRODUCT = { slug: 'nuoc-rua-chen-bo-ket', name: 'Nước rửa chén bồ kết 500ml', imageUrl: null, price: 59_000, inStock: true };

export const QUIZ_ITEMS = [
  { id: 'q1', prompt: 'Vỏ hộp sữa giấy nên bỏ vào thùng nào?', options: ['Tái chế', 'Rác hữu cơ', 'Rác còn lại', 'Đốt'], product: null },
  { id: 'q2', prompt: 'Một cây xanh trưởng thành hấp thụ khí nào?', options: ['CO₂', 'Oxy', 'Nitơ', 'Heli'], product: null },
  { id: 'q3', prompt: 'Bồ kết dùng để làm gì trong nhà?', options: ['Rửa chén, gội đầu', 'Nấu canh', 'Tưới cây', 'Lau kính ô tô'], product: QUIZ_PRODUCT },
];

export const SORT_ITEMS = [
  { id: 's1', label: 'Chai nhựa PET', emoji: '🧴' },
  { id: 's2', label: 'Vỏ chuối', emoji: '🍌' },
  { id: 's3', label: 'Lon nhôm', emoji: '🥫' },
  { id: 's4', label: 'Bã cà phê', emoji: '☕' },
  { id: 's5', label: 'Túi nilon bẩn', emoji: null },
  { id: 's6', label: 'Hộp giấy', emoji: '📦' },
  { id: 's7', label: 'Vỏ trứng', emoji: '🥚' },
  { id: 's8', label: 'Ly giấy tráng nhựa', emoji: '🥤' },
  { id: 's9', label: 'Chai thủy tinh', emoji: '🍾' },
  { id: 's10', label: 'Khăn giấy đã dùng', emoji: null },
];

const SOURCE = 'https://www.moitruong.gov.vn/phan-loai-rac';

export function quizResult(over: Partial<MiniSubmitResponse> = {}): MiniSubmitResponse {
  return {
    game: 'daily_quiz',
    roundId: 'r-daily_quiz',
    correct: 2,
    total: 3,
    durationMs: 9_000,
    rewarded: true,
    noRewardReason: null,
    baseWater: 6,
    basePoints: 0,
    water: 6,
    points: 0,
    capped: [],
    totalSeeds: 130,
    checkIn: { done: true, newlyCheckedIn: true, streakDays: 4 },
    review: {
      game: 'daily_quiz',
      items: QUIZ_ITEMS.map((q, i) => ({
        contentId: q.id,
        prompt: q.prompt,
        correct: i !== 1,
        given: i === 1 ? 1 : 0,
        expected: 0,
        explanation: `Giải thích câu ${i + 1}`,
        sourceUrl: SOURCE,
        productSlug: q.product?.slug ?? null,
      })),
    },
    ...over,
  };
}

export function sortResult(over: Partial<MiniSubmitResponse> = {}): MiniSubmitResponse {
  return {
    game: 'sort',
    roundId: 'r-sort',
    correct: 7,
    total: 10,
    durationMs: 20_000,
    rewarded: true,
    noRewardReason: null,
    baseWater: 10,
    basePoints: 0,
    water: 10,
    points: 0,
    capped: [],
    totalSeeds: 140,
    checkIn: null,
    review: {
      game: 'sort',
      items: SORT_ITEMS.map((it, i) => ({
        contentId: it.id,
        label: it.label,
        correct: i < 7,
        given: 'recycle' as const,
        expected: i < 7 ? ('recycle' as const) : ('other' as const),
        explanation: `Vì sao món ${i + 1}`,
        sourceUrl: SOURCE,
      })),
    },
    ...over,
  };
}

/** Bật game mini: "Chơi hôm nay", bắt đầu và nộp từng game; trả mảng thân các lần nộp để spec kiểm đáp án gửi đi. */
export function mockMiniGames(
  api: MockApi,
  opts: { today?: MiniTodayResponse; guest?: 'NOT_LOGGED_IN' | 'NOT_REAL_USER'; quiz?: MiniSubmitResponse; sort?: MiniSubmitResponse; failFirstSubmit?: boolean } = {},
) {
  const submits: { game: string; body: Record<string, unknown> }[] = [];
  const guest = opts.guest;
  // Chưa đăng nhập (web): ván ký `token`, không lưu. Tài khoản khách theo thiết bị (Mini App): ván có `roundId` nhưng không tính thưởng.
  const startOver = guest ? { ...(guest === 'NOT_LOGGED_IN' ? { roundId: null, token: 'tok.e2e' } : {}), rewarded: false, noRewardReason: guest } : {};
  api.get('/game/mini/today', () => opts.today ?? (guest ? miniToday({ rewardEligible: false, noRewardReason: guest }) : miniToday()));
  api.post('/game/mini/daily_quiz/start', () => round('daily_quiz', { game: 'daily_quiz', items: QUIZ_ITEMS }, startOver));
  api.post('/game/mini/sort/start', () => round('sort', { game: 'sort', bins: ['recycle', 'food', 'other'], items: SORT_ITEMS }, startOver));
  let failed = false;
  const submit = (game: 'daily_quiz' | 'sort') => (ctx: { call: { body: unknown } }) => {
    submits.push({ game, body: ctx.call.body as Record<string, unknown> });
    if (opts.failFirstSubmit && !failed) {
      failed = true;
      return reply(503, { statusCode: 503, message: 'Service Unavailable' });
    }
    const guestResult = guest ? { rewarded: false, noRewardReason: guest, water: 0, points: 0, checkIn: null, ...(guest === 'NOT_LOGGED_IN' ? { roundId: null } : {}) } : {};
    return game === 'daily_quiz' ? { ...(opts.quiz ?? quizResult()), ...guestResult } : { ...(opts.sort ?? sortResult()), ...guestResult };
  };
  api.post('/game/mini/daily_quiz/submit', submit('daily_quiz'));
  api.post('/game/mini/sort/submit', submit('sort'));
  return { submits };
}

/** Nút Bắt đầu của màn mở đầu (Mini App giữ trang Vườn Xanh phía sau trong DOM, trang đó cũng có nút "Bắt đầu"). */
export async function startRound(page: Page) {
  await page.getByTestId('mini-intro').getByRole('button', { name: gameCopy('intro.start') }).click();
}

/** Chơi hết 3 câu Đố Xanh bằng chuột/chạm: chọn đáp án A rồi bấm "Câu tiếp"/"Nộp bài". */
export async function playQuiz(page: Page) {
  for (let i = 0; i < 3; i++) {
    await expect(page.getByTestId('mini-quiz-prompt')).toHaveText(QUIZ_ITEMS[i]!.prompt);
    await page.getByTestId('mini-quiz-option-0').click();
    await page.getByRole('button', { name: gameCopy(i === 2 ? 'quiz.finish' : 'quiz.next') }).click();
  }
}

export const sortProgress = (page: Page) => page.getByTestId('mini-status').getByText(/^\d+\/10$/);

/** Bỏ các món còn lại vào thùng Tái chế bằng chạm thẳng thùng, mỗi lần cách nhau hơn khoá chạm đúp 300ms. */
export async function finishSort(page: Page, from: number) {
  for (let i = from; i < 10; i++) {
    await expect(sortProgress(page)).toHaveText(`${i}/10`);
    await page.getByTestId('mini-sort-bin-recycle').click();
    await page.waitForTimeout(350);
  }
}

/**
 * Mọi phần tử bấm được trong `scope` cao ít nhất 44px (vùng chạm tối thiểu). Tên thẻ sản phẩm (`.tubu-tile-link`) nhận chạm qua `::after` phủ cả
 * vỏ thẻ, nên đo vỏ thẻ (khối định vị gần nhất) chứ không đo dòng chữ.
 */
export async function expectTargets44(scope: Locator) {
  const small = await scope.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const box = (el.classList.contains('tubu-tile-link') ? (el.offsetParent as HTMLElement) : el).getBoundingClientRect();
        return { el: (el.getAttribute('data-testid') ?? el.textContent ?? '').trim().slice(0, 40), h: box.height, w: box.width };
      })
      .filter((x) => x.h < 44 || x.w < 44),
  );
  expect(small, 'Phần tử bấm được nhỏ hơn 44px').toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(o.sw, 'Trang tràn ngang').toBeLessThanOrEqual(o.cw);
}
