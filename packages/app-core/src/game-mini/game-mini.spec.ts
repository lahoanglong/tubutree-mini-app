import { describe, expect, it, vi } from 'vitest';
import type { MiniStartResponse, MiniSubmitResponse, MiniTodayResponse } from '@tubutree/shared-types';
import { FORBIDDEN_TERMS } from '../shop-copy';
import { classifyMiniError, MINI_DEVICE_KEY, miniDeviceId } from './api';
import { isMiniDisabled, miniTodayQuery, withFreshSession } from './today';
import {
  binUnderPoint,
  quizChoose,
  quizDone,
  quizNext,
  quizStart,
  quizTimeLeft,
  QUIZ_QUESTION_MS,
  SORT_TAP_COOLDOWN_MS,
  sortBinsFor,
  sortDone,
  sortPlace,
  sortStart,
} from './boards';
import { GAME_MINI_COPY, GAME_MINI_COPY_MAX, gameCopy, type GameMiniCopyKey } from './copy';
import {
  isMiniAppGame,
  miniAppToday,
  miniCapLines,
  miniClock,
  miniEarnQuizLeft,
  miniFailureView,
  miniIntroReward,
  miniPlayPath,
  miniProductPath,
  miniResultSummary,
  miniRowStatus,
  miniWebOnlyLine,
  playableToday,
  safeSourceUrl,
  sourceHost,
} from './format';
import { initialRoundState, roundMsLeft, roundReducer, submitDelayMs, SUBMIT_RETRIES, type RoundEvent, type RoundState } from './round-machine';
import { miniProductView, miniQuizProduct, miniReviewRows } from './review';

const T0 = 1_000_000;

function startResp(over: Partial<MiniStartResponse> = {}): MiniStartResponse {
  return {
    game: 'daily_quiz',
    roundId: 'r1',
    token: null,
    issuedAt: '2026-11-17T03:00:00.000Z',
    expiresAt: '2026-11-17T03:10:00.000Z',
    rewarded: true,
    noRewardReason: null,
    content: { game: 'daily_quiz', items: [] },
    ...over,
  };
}

function submitResp(over: Partial<MiniSubmitResponse> = {}): MiniSubmitResponse {
  return {
    game: 'daily_quiz',
    roundId: 'r1',
    correct: 3,
    total: 3,
    durationMs: 30_000,
    rewarded: true,
    noRewardReason: null,
    baseWater: 7,
    basePoints: 10,
    water: 7,
    points: 10,
    capped: [],
    totalSeeds: 120,
    checkIn: null,
    review: { game: 'daily_quiz', items: [] },
    ...over,
  };
}

function today(over: Partial<MiniTodayResponse> = {}): MiniTodayResponse {
  return {
    dayKey: '2026-11-17',
    games: [
      { game: 'sort', items: 10, timeLimitMs: 45_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
      { game: 'match', items: 6, timeLimitMs: 60_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
      { game: 'daily_quiz', items: 3, timeLimitMs: 60_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 1, playedToday: 1 },
    ],
    rewardEligible: true,
    noRewardReason: null,
    caps: { waterUsed: 0, waterCap: 40, pointsUsed: 0, pointsCap: 100, accountCapReached: false, pointsBudgetExhausted: false },
    dailyQuizDoneToday: false,
    ...over,
  };
}

const run = (events: RoundEvent[], from: RoundState = initialRoundState) => events.reduce(roundReducer, from);
const playing = () => run([{ type: 'start' }, { type: 'started', round: startResp(), now: T0 }]);
const submitting = () => roundReducer(playing(), { type: 'finish', answers: [0, 1, null], now: T0 + 20_000 });
const httpErr = (status: number | undefined, code?: string) => ({ response: status === undefined ? undefined : { status, data: code ? { code } : {} } });

describe('roundReducer', () => {
  it('idle → starting → playing, hạn ván tính từ lúc nhận đề theo độ dài máy chủ cấp', () => {
    const s = playing();
    expect(s.phase).toBe('playing');
    expect(s.receivedAt).toBe(T0);
    expect(s.deadline).toBe(T0 + 10 * 60_000);
  });

  it('Bắt đầu chạm hai lần khi đang phát đề, đang chơi, đang nộp: không mở ván mới', () => {
    const starting = run([{ type: 'start' }]);
    expect(roundReducer(starting, { type: 'start' })).toBe(starting);
    const p = playing();
    expect(roundReducer(p, { type: 'start' })).toBe(p);
    const sub = submitting();
    expect(roundReducer(sub, { type: 'start' })).toBe(sub);
  });

  it('phát đề hỏng → error (bước start); Bắt đầu lại từ error mở ván mới', () => {
    const s = run([{ type: 'start' }, { type: 'start_failed', failure: 'network' }]);
    expect(s).toMatchObject({ phase: 'error', failure: 'network', failedStep: 'start' });
    expect(roundReducer(s, { type: 'start' }).phase).toBe('starting');
    expect(roundReducer(s, { type: 'retry', now: T0 })).toBe(s);
  });

  it('chơi xong → submitting với lần gửi 1, giữ đáp án', () => {
    const s = submitting();
    expect(s).toMatchObject({ phase: 'submitting', attempts: 1, answers: [0, 1, null] });
  });

  it('nộp thành công → result', () => {
    const r = submitResp();
    expect(roundReducer(submitting(), { type: 'submitted', result: r })).toMatchObject({ phase: 'result', result: r });
  });

  it('mất mạng lúc nộp: tự gửi lại đúng 2 lần rồi sang error, đáp án vẫn giữ', () => {
    let s = submitting();
    for (let i = 0; i < SUBMIT_RETRIES; i++) {
      s = roundReducer(s, { type: 'submit_failed', failure: 'network', now: T0 + 21_000 });
      expect(s.phase).toBe('submitting');
      expect(s.attempts).toBe(i + 2);
    }
    s = roundReducer(s, { type: 'submit_failed', failure: 'network', now: T0 + 25_000 });
    expect(s).toMatchObject({ phase: 'error', failedStep: 'submit', failure: 'network', answers: [0, 1, null] });
    const again = roundReducer(s, { type: 'retry', now: T0 + 30_000 });
    expect(again).toMatchObject({ phase: 'submitting', attempts: 1, answers: [0, 1, null] });
  });

  it('lỗi không gửi lại được (bài sai dạng, đã nộp) → error ngay', () => {
    expect(roundReducer(submitting(), { type: 'submit_failed', failure: 'rejected', now: T0 + 21_000 })).toMatchObject({ phase: 'error', failure: 'rejected' });
    expect(roundReducer(submitting(), { type: 'submit_failed', failure: 'already_submitted', now: T0 + 21_000 }).failure).toBe('already_submitted');
  });

  it('máy chủ báo quá hạn, hoặc gửi lại khi đã quá hạn → expired (không thưởng, không trừ lượt)', () => {
    expect(roundReducer(submitting(), { type: 'submit_failed', failure: 'expired', now: T0 + 21_000 }).phase).toBe('expired');
    const late = T0 + 10 * 60_000 + 1;
    expect(roundReducer(submitting(), { type: 'submit_failed', failure: 'network', now: late }).phase).toBe('expired');
    const err = run([{ type: 'submit_failed', failure: 'rejected', now: T0 + 21_000 }], submitting());
    expect(roundReducer(err, { type: 'retry', now: late }).phase).toBe('expired');
  });

  it('chơi xong sau hạn → expired, không nộp', () => {
    const s = roundReducer(playing(), { type: 'finish', answers: [], now: T0 + 10 * 60_000 });
    expect(s.phase).toBe('expired');
  });

  it('expire chỉ áp khi đang có ván dở', () => {
    expect(roundReducer(initialRoundState, { type: 'expire' })).toBe(initialRoundState);
    expect(roundReducer(playing(), { type: 'expire' }).phase).toBe('expired');
    const done = roundReducer(submitting(), { type: 'submitted', result: submitResp() });
    expect(roundReducer(done, { type: 'expire' })).toBe(done);
  });

  it('sự kiện lạc pha bị bỏ qua (phản hồi muộn của lượt cũ)', () => {
    const p = playing();
    expect(roundReducer(p, { type: 'submitted', result: submitResp() })).toBe(p);
    expect(roundReducer(p, { type: 'started', round: startResp({ roundId: 'r2' }), now: T0 })).toBe(p);
    expect(roundReducer(initialRoundState, { type: 'finish', answers: [], now: T0 })).toBe(initialRoundState);
  });

  it('reset về idle từ mọi pha', () => {
    expect(roundReducer(submitting(), { type: 'reset' })).toEqual(initialRoundState);
  });

  it('submitDelayMs: lần đầu đợi đủ 5,5 giây từ lúc nhận đề; lần gửi lại lùi 1,5 rồi 3 giây; too_fast đợi ít nhất 5 giây', () => {
    const s = roundReducer(playing(), { type: 'finish', answers: [], now: T0 + 2_000 });
    expect(submitDelayMs(s, T0 + 2_000)).toBe(3_500);
    expect(submitDelayMs(s, T0 + 9_000)).toBe(0);
    const r1 = roundReducer(s, { type: 'submit_failed', failure: 'network', now: T0 + 6_000 });
    expect(submitDelayMs(r1, T0 + 6_000)).toBe(1_500);
    const r2 = roundReducer(r1, { type: 'submit_failed', failure: 'network', now: T0 + 8_000 });
    expect(submitDelayMs(r2, T0 + 8_000)).toBe(3_000);
    const tf = roundReducer(s, { type: 'submit_failed', failure: 'too_fast', now: T0 + 6_000 });
    expect(submitDelayMs(tf, T0 + 6_000)).toBe(5_000);
    expect(submitDelayMs(playing(), T0)).toBe(0);
  });

  it('roundMsLeft không âm', () => {
    expect(roundMsLeft(initialRoundState, T0)).toBeNull();
    expect(roundMsLeft(playing(), T0 + 11 * 60_000)).toBe(0);
  });
});

describe('classifyMiniError', () => {
  it('mã nghiệp vụ thắng mã HTTP: ROUND_LIMIT (429) không gửi lại', () => {
    expect(classifyMiniError(httpErr(429, 'ROUND_LIMIT'))).toBe('limit');
    expect(classifyMiniError(httpErr(429))).toBe('network');
  });
  it('mất mạng, 5xx là lỗi tạm', () => {
    expect(classifyMiniError(new Error('Network Error'))).toBe('network');
    expect(classifyMiniError(httpErr(502))).toBe('network');
  });
  it('mã của lõi game', () => {
    expect(classifyMiniError(httpErr(404, 'GAME_DISABLED'))).toBe('disabled');
    expect(classifyMiniError(httpErr(404, 'GAME_NO_CONTENT'))).toBe('no_content');
    expect(classifyMiniError(httpErr(404, 'ROUND_NOT_FOUND'))).toBe('rejected');
    expect(classifyMiniError(httpErr(400, 'ROUND_EXPIRED'))).toBe('expired');
    expect(classifyMiniError(httpErr(400, 'ROUND_TOO_FAST'))).toBe('too_fast');
    expect(classifyMiniError(httpErr(409, 'ROUND_SUBMITTED'))).toBe('already_submitted');
    expect(classifyMiniError(httpErr(401, 'LOGIN_REQUIRED'))).toBe('login_required');
    expect(classifyMiniError({ status: 400, code: 'ANSWERS_INVALID' })).toBe('rejected');
  });
  it('cờ tắt = 404; query không thử lại khi 404', () => {
    expect(isMiniDisabled(httpErr(404, 'GAME_DISABLED'))).toBe(true);
    const q = miniTodayQuery({} as never, true);
    expect(q.queryKey).toEqual(['game', 'mini', 'today', 'member']);
    expect(miniTodayQuery({} as never, false).queryKey).toEqual(['game', 'mini', 'today', 'guest']);
    expect(q.retry(0, httpErr(404))).toBe(false);
    expect(q.retry(0, httpErr(500))).toBe(true);
    expect(q.retry(1, httpErr(500))).toBe(false);
  });
});

describe('miniDeviceId', () => {
  const bytes = (n: number) => new Uint8Array(n).fill(171);
  it('tạo mã 32 ký tự hex, lưu và dùng lại', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    const id = miniDeviceId(storage, bytes);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(data.get(MINI_DEVICE_KEY)).toBe(id);
    expect(miniDeviceId(storage, () => new Uint8Array(16))).toBe(id);
  });
  it('không lưu được thì vẫn có mã trong phiên', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(miniDeviceId(blocked, bytes)).toMatch(/^[0-9a-f]{32}$/);
    expect(miniDeviceId(null, bytes)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('Đố Xanh: bàn chơi', () => {
  it('chọn, đổi lựa chọn, chốt bằng Câu tiếp', () => {
    let p = quizStart(3, T0);
    p = quizChoose(p, 2, 4);
    p = quizChoose(p, 1, 4);
    expect(p.chosen).toBe(1);
    p = quizNext(p, T0 + 5_000);
    expect(p).toMatchObject({ index: 1, answers: [1, null, null], chosen: null, questionStartedAt: T0 + 5_000 });
  });
  it('chỉ số lựa chọn ngoài khoảng bị bỏ qua', () => {
    const p = quizStart(3, T0);
    expect(quizChoose(p, 4, 4)).toBe(p);
    expect(quizChoose(p, -1, 4)).toBe(p);
    expect(quizChoose(p, 1.5, 4)).toBe(p);
  });
  it('hết 20 giây: câu chưa chọn bỏ trống, đồng hồ câu mới chạy lại', () => {
    let p = quizStart(3, T0);
    expect(quizTimeLeft(p, T0 + 5_000)).toBe(QUIZ_QUESTION_MS - 5_000);
    expect(quizTimeLeft(p, T0 + 25_000)).toBe(0);
    p = quizNext(p, T0 + QUIZ_QUESTION_MS);
    expect(p.answers[0]).toBeNull();
    expect(quizTimeLeft(p, T0 + QUIZ_QUESTION_MS)).toBe(QUIZ_QUESTION_MS);
  });
  it('xong ba câu thì dừng, không ghi thêm', () => {
    let p = quizStart(3, T0);
    for (let i = 0; i < 3; i++) p = quizNext(quizChoose(p, i, 4), T0 + i);
    expect(quizDone(p)).toBe(true);
    expect(p.answers).toEqual([0, 1, 2]);
    expect(quizNext(p, T0)).toBe(p);
    expect(quizChoose(p, 0, 4)).toBe(p);
  });
});

describe('Đúng Thùng: bàn chơi', () => {
  it('chạm thùng đặt món đang hiện rồi sang món kế', () => {
    let p = sortStart(10);
    p = sortPlace(p, 0, 'recycle', T0);
    expect(p).toMatchObject({ index: 1, lastPlacedAt: T0 });
    expect(p.answers[0]).toBe('recycle');
  });
  it('chạm đúp thùng không tính hai lần: cùng chỉ số cũ, hoặc dưới 300ms', () => {
    const p = sortPlace(sortStart(10), 0, 'food', T0);
    expect(sortPlace(p, 0, 'food', T0 + 10)).toBe(p);
    expect(sortPlace(p, 1, 'food', T0 + SORT_TAP_COOLDOWN_MS - 1)).toBe(p);
    expect(sortPlace(p, 1, 'food', T0 + SORT_TAP_COOLDOWN_MS).index).toBe(2);
  });
  it('hết món thì không đặt thêm; món chưa đặt khi hết giờ là null', () => {
    let p = sortStart(2);
    p = sortPlace(p, 0, 'other', T0);
    expect(p.answers).toEqual(['other', null]);
    p = sortPlace(p, 1, 'food', T0 + 1_000);
    expect(sortDone(p)).toBe(true);
    expect(sortPlace(p, 2, 'food', T0 + 2_000)).toBe(p);
  });
  it('thùng theo thứ tự cố định, Nguy hại chỉ khi máy chủ phát', () => {
    expect(sortBinsFor(['other', 'recycle', 'food'])).toEqual(['recycle', 'food', 'other']);
    expect(sortBinsFor(['hazardous', 'other', 'recycle', 'food'])).toEqual(['recycle', 'food', 'other', 'hazardous']);
  });
  it('thả ngoài mọi thùng → null (món về chỗ)', () => {
    const rects = [
      { bin: 'recycle' as const, left: 0, top: 500, right: 110, bottom: 580 },
      { bin: 'food' as const, left: 120, top: 500, right: 230, bottom: 580 },
    ];
    expect(binUnderPoint(rects, 50, 540)).toBe('recycle');
    expect(binUnderPoint(rects, 150, 540)).toBe('food');
    expect(binUnderPoint(rects, 115, 540)).toBeNull();
    expect(binUnderPoint(rects, 50, 300)).toBeNull();
  });
});

describe('định dạng', () => {
  it('Chơi hôm nay: chỉ game đã có giao diện, Đố Xanh trước', () => {
    expect(playableToday(today()).map((g) => g.game)).toEqual(['daily_quiz', 'sort', 'match']);
    expect(playableToday(undefined)).toEqual([]);
  });

  it('Mini App: chỉ Đố Xanh và Đúng Thùng là dòng chơi; Ghép Cặp, Đoán Xuất Xứ, Giỏ Đúng Việc gom vào một dòng "chơi trên tubutree.com"', () => {
    expect(['daily_quiz', 'sort', 'match', 'origin', 'basket'].filter((g) => isMiniAppGame(g as never))).toEqual(['daily_quiz', 'sort']);
    const t = miniAppToday(today());
    expect(t.rows.map((g) => g.game)).toEqual(['daily_quiz', 'sort']);
    expect(t.webOnly).toEqual(['match']);
    expect(miniAppToday(undefined)).toEqual({ rows: [], webOnly: [] });
    expect(miniWebOnlyLine(['match', 'origin', 'basket'])).toBe('Ghép Cặp, Đoán Xuất Xứ, Giỏ Đúng Việc: chơi trên tubutree.com');
    expect(miniWebOnlyLine([])).toBeNull();
    expect(miniWebOnlyLine(['match', 'origin', 'basket'])!.length).toBeLessThanOrEqual(GAME_MINI_COPY_MAX['entry.webOnly']!);
  });

  it('dòng trạng thái: chơi thử / còn n lượt / đã nhận đủ', () => {
    const t = today();
    expect(miniRowStatus(t, t.games[0]!).text).toBe('Còn 2 lượt thưởng');
    expect(miniRowStatus(today({ rewardEligible: false, noRewardReason: 'NOT_LOGGED_IN' }), t.games[0]!).text).toBe('Chơi thử, chưa tính thưởng');
    expect(miniRowStatus(t, { ...t.games[0]!, rewardedRoundsLeft: 0 }).text).toBe('Đã nhận đủ hôm nay');
    const capped = today({ caps: { ...t.caps, accountCapReached: true } });
    expect(miniRowStatus(capped, t.games[0]!).text).toBe('Đã nhận đủ hôm nay');
  });

  it('hết lượt thưởng: nói "không tính thưởng" trước khi bắt đầu', () => {
    const t = today({ games: [{ game: 'sort', items: 10, timeLimitMs: 45_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 0, playedToday: 2 }] });
    expect(miniIntroReward(t, 'sort')).toEqual({ rewarded: false, lines: ['Bạn đã dùng hết lượt thưởng của game này hôm nay.'] });
    expect(miniIntroReward(today({ rewardEligible: false, noRewardReason: 'NOT_LOGGED_IN' }), 'sort').rewarded).toBe(false);
    expect(miniIntroReward(today(), 'sort')).toEqual({ rewarded: true, lines: ['Thưởng tới 10 Giọt nước, thêm 10 Điểm Xanh khi đúng từ 80%'] });
    const budget = today({ caps: { ...today().caps, pointsBudgetExhausted: true } });
    expect(miniIntroReward(budget, 'sort').lines).toEqual(['Thưởng tới 10 Giọt nước', 'Thưởng điểm hôm nay đã hết, bạn vẫn nhận Giọt nước.']);
  });

  it('mức thưởng hứa trước khớp công thức máy chủ: Đố Xanh 3 câu tối đa 4 + 3 = 7 Giọt nước, hạ theo phần 💧 còn lại hôm nay', () => {
    expect(miniIntroReward(today(), 'daily_quiz').lines[0]).toBe('Thưởng tới 7 Giọt nước, thêm 10 Điểm Xanh khi đúng từ 80%');
    const nearCap = today({ caps: { ...today().caps, waterUsed: 37, waterCap: 40 } });
    expect(miniIntroReward(nearCap, 'sort').lines[0]).toBe('Thưởng tới 3 Giọt nước, thêm 10 Điểm Xanh khi đúng từ 80%');
    const waterFull = today({ caps: { ...today().caps, waterUsed: 40, waterCap: 40 } });
    expect(miniIntroReward(waterFull, 'sort')).toEqual({ rewarded: true, lines: ['Bạn đã nhận đủ Giọt nước từ game hôm nay.'] });
    const bothFull = today({ caps: { ...today().caps, waterUsed: 40, waterCap: 40, pointsBudgetExhausted: true } });
    expect(miniIntroReward(bothFull, 'sort')).toEqual({ rewarded: false, lines: ['Hôm nay bạn đã nhận đủ thưởng game.'] });
  });

  it('bị trần: câu nói thật theo bảng 8.6', () => {
    expect(miniCapLines(['account_water', 'account_points'])).toEqual(['Hôm nay bạn đã nhận đủ thưởng game.']);
    expect(miniCapLines(['global'])).toEqual(['Thưởng điểm hôm nay đã hết, bạn vẫn nhận Giọt nước.']);
    expect(miniCapLines(['device', 'tank'])).toHaveLength(2);
    const s = miniResultSummary(submitResp({ water: 3, points: 0, capped: ['global', 'account_water'] }));
    expect(s.gains).toEqual(['+3 Giọt nước']);
    expect(s.notes).toEqual(['Bạn đã nhận đủ Giọt nước từ game hôm nay.', 'Thưởng điểm hôm nay đã hết, bạn vẫn nhận Giọt nước.']);
  });

  it('kết quả khách chưa đăng nhập: nút chính mời đăng nhập', () => {
    const s = miniResultSummary(submitResp({ rewarded: false, noRewardReason: 'NOT_LOGGED_IN', water: 0, points: 0 }));
    expect(s).toMatchObject({ loginToReward: true, gains: [], score: 'Đúng 3/3' });
    expect(miniResultSummary(submitResp({ rewarded: false, noRewardReason: 'NO_REWARDED_ROUNDS_LEFT', water: 0, points: 0 })).loginToReward).toBe(false);
    expect(miniResultSummary(submitResp({ rewarded: false, noRewardReason: 'NOT_REAL_USER', water: 0, points: 0 })).loginToReward).toBe(true);
    expect(miniResultSummary(submitResp({ rewarded: false, noRewardReason: 'ACCOUNT_TOO_NEW', water: 0, points: 0 })).loginToReward).toBe(false);
  });

  it('Đố Xanh xong: dòng điểm danh và chuỗi', () => {
    const s = miniResultSummary(submitResp({ checkIn: { done: true, newlyCheckedIn: true, streakDays: 4 } }));
    expect(s.notes).toContain('Đã điểm danh hôm nay, chuỗi 4 ngày.');
    expect(miniResultSummary(submitResp({ checkIn: { done: true, newlyCheckedIn: false, streakDays: 4 } })).notes).toContain('Hôm nay bạn đã điểm danh.');
  });

  it('đồng hồ, đường dẫn, nguồn an toàn', () => {
    expect(miniClock(38_000)).toBe('0:38');
    expect(miniClock(37_200)).toBe('0:38');
    expect(miniClock(60_000)).toBe('1:00');
    expect(miniClock(-5)).toBe('0:00');
    expect(miniPlayPath.miniapp('sort')).toBe('/game/play/sort');
    expect(miniPlayPath.web('daily_quiz')).toBe('/vuon-xanh/choi/daily_quiz');
    expect(miniProductPath.web('bo-hon', 'daily_quiz')).toBe('/san-pham/bo-hon?entrySource=game:daily_quiz');
    expect(sourceHost('https://www.monre.gov.vn/a')).toBe('monre.gov.vn');
    expect(safeSourceUrl('javascript:alert(1)')).toBeNull();
    expect(safeSourceUrl('not a url')).toBeNull();
  });
});

describe('chữ game mini', () => {
  const sample: Record<string, string | number> = { n: 2, m: 3, c: 2, t: 3, water: 10, points: 10, pct: 80, title: 'Đúng Thùng', desc: 'x', status: 'y', item: 'Hộp sữa giấy', bin: 'Tái chế', host: 'monre.gov.vn', a: 'Saponin', k: 2, label: 'Bồ hòn', side: 'Nguyên liệu', ingredient: 'Bồ hòn', use: 'Tạo bọt', names: 'Giấm gạo', place: 'Đà Lạt' };
  const keys = Object.keys(GAME_MINI_COPY) as GameMiniCopyKey[];

  it('không có thuật ngữ cấm', () => {
    for (const key of keys) {
      for (const { pattern, use } of FORBIDDEN_TERMS) expect(GAME_MINI_COPY[key], `${key}: dùng "${use}"`).not.toMatch(pattern);
    }
  });

  it('điền được mọi khoá và không vượt ngân sách độ dài', () => {
    for (const key of keys) {
      const text = gameCopy(key, sample);
      const max = GAME_MINI_COPY_MAX[key];
      if (max) expect(text.length, key).toBeLessThanOrEqual(max);
    }
  });
});

describe('màn lỗi và sheet Kiếm nước', () => {
  it('mỗi lỗi một hành động: mất mạng lúc nộp thì gửi lại (đáp án còn giữ), lúc bắt đầu thì chơi lại', () => {
    expect(miniFailureView('network', 'submit').action).toBe('retry');
    expect(miniFailureView('too_fast', 'submit').action).toBe('retry');
    expect(miniFailureView('network', 'start').action).toBe('new');
    expect(miniFailureView('login_required', 'submit').action).toBe('login');
    expect(miniFailureView('limit', 'start').action).toBe('back');
    expect(miniFailureView('disabled', 'start').action).toBe('back');
    expect(miniFailureView('no_content', 'start').action).toBe('back');
    expect(miniFailureView('already_submitted', 'submit').action).toBe('new');
    expect(miniFailureView('expired', 'submit')).toEqual({ message: gameCopy('expired.body'), action: 'new' });
    expect(miniFailureView('rejected', 'submit').action).toBe('new');
  });
  it('số câu Đố Xanh còn thưởng = lượt còn lại × 3; khách, chạm trần tài khoản hay game tắt thì 0', () => {
    expect(miniEarnQuizLeft(today())).toBe(3);
    expect(miniEarnQuizLeft(today({ rewardEligible: false, noRewardReason: 'NOT_LOGGED_IN' }))).toBe(0);
    expect(miniEarnQuizLeft(today({ caps: { ...today().caps, accountCapReached: true } }))).toBe(0);
    expect(miniEarnQuizLeft(today({ games: today().games.filter((g) => g.game !== 'daily_quiz') }))).toBe(0);
  });
});

describe('màn kết quả: danh sách Vì sao', () => {
  const product = { slug: 'nuoc-rua-chen-bo-ket', name: 'Nước rửa chén bồ kết', imageUrl: null, price: 89_000, inStock: true };
  const quiz = {
    game: 'daily_quiz' as const,
    items: [
      { id: 'q1', prompt: 'Câu 1', options: ['A1', 'B1', 'C1', 'D1'], product: null },
      { id: 'q2', prompt: 'Câu 2', options: ['A2', 'B2', 'C2', 'D2'], product },
      { id: 'q3', prompt: 'Câu 3', options: ['A3', 'B3', 'C3', 'D3'], product: null },
    ],
  };
  const base = { explanation: 'Vì vậy', sourceUrl: 'https://example.vn/a', productSlug: null };

  it('Đố Xanh: máy chủ trả chỉ số, dòng ghi chữ của lựa chọn; bỏ trống là "skipped" không có đáp án đã chọn', () => {
    const rows = miniReviewRows(
      {
        game: 'daily_quiz',
        items: [
          { ...base, contentId: 'q1', prompt: 'Câu 1', correct: true, given: 0, expected: 0 },
          { ...base, contentId: 'q2', prompt: 'Câu 2', correct: false, given: 1, expected: 2 },
          { ...base, contentId: 'q3', prompt: 'Câu 3', correct: false, given: null, expected: 3 },
        ],
      },
      quiz,
    );
    expect(rows.map((r) => [r.state, r.given, r.expected])).toEqual([
      ['correct', 'A1', 'A1'],
      ['wrong', 'B2', 'C2'],
      ['skipped', null, 'D3'],
    ]);
  });

  it('Đúng Thùng: tên thùng lấy từ chữ game mini', () => {
    const rows = miniReviewRows(
      { game: 'sort', items: [{ contentId: 's1', label: 'Vỏ chuối', correct: false, given: 'recycle', expected: 'food', explanation: 'Hữu cơ', sourceUrl: '' }] },
      { game: 'sort', bins: ['recycle', 'food', 'other'], items: [{ id: 's1', label: 'Vỏ chuối', emoji: null }] },
    );
    expect(rows[0]).toMatchObject({ state: 'wrong', given: gameCopy('sort.bin.recycle'), expected: gameCopy('sort.bin.food') });
  });

  it('thẻ sản phẩm là sản phẩm của câu cuối có gắn sản phẩm; game khác không có thẻ', () => {
    expect(miniQuizProduct(quiz)?.slug).toBe(product.slug);
    expect(miniQuizProduct({ game: 'sort', bins: ['recycle'], items: [] })).toBeNull();
    expect(miniQuizProduct(undefined)).toBeNull();
  });

  it('thẻ sản phẩm vẽ bằng thẻ line chung: giá đang bán, không giá gạch, hết hàng ghi rõ', () => {
    const view = miniProductView({ slug: 'nuoc-rua-chen', name: 'Nước rửa chén', imageUrl: null, price: 59_000, inStock: true }, 0);
    expect(view).toMatchObject({ slug: 'nuoc-rua-chen', name: 'Nước rửa chén', price: 59_000, compareAt: null, stock: 'in', label: null });
    expect(miniProductView({ slug: 'x', name: 'X', imageUrl: null, price: 10_000, inStock: false }, 0).stock).toBe('out');
  });
});

describe('phiên hết hạn ở route game mini (máy chủ coi token hết hạn là khách, không 401)', () => {
  const answers = (...reasons: Array<'NOT_LOGGED_IN' | null>) => {
    let i = 0;
    return vi.fn(async () => ({ noRewardReason: reasons[Math.min(i++, reasons.length - 1)]! }));
  };

  it('có phiên mà nhận câu trả lời của khách: làm mới phiên rồi gọi lại đúng một lần', async () => {
    const load = answers('NOT_LOGGED_IN', null);
    const refresh = vi.fn(async () => true);
    expect(await withFreshSession(load, true, refresh)).toEqual({ noRewardReason: null });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('khách thật, hoặc làm mới phiên thất bại: giữ câu trả lời đầu, không gọi lại', async () => {
    const guest = answers('NOT_LOGGED_IN');
    const refresh = vi.fn(async () => true);
    expect(await withFreshSession(guest, false, refresh)).toEqual({ noRewardReason: 'NOT_LOGGED_IN' });
    expect(refresh).not.toHaveBeenCalled();
    const dead = answers('NOT_LOGGED_IN');
    expect(await withFreshSession(dead, true, async () => false)).toEqual({ noRewardReason: 'NOT_LOGGED_IN' });
    expect(dead).toHaveBeenCalledTimes(1);
  });

  it('query "Chơi hôm nay" của thành viên không giữ bản của khách khi token đã hết hạn', async () => {
    const fresh = { ...today(), noRewardReason: null };
    const get = vi.fn().mockResolvedValueOnce({ ...today(), rewardEligible: false, noRewardReason: 'NOT_LOGGED_IN' }).mockResolvedValueOnce(fresh);
    const q = miniTodayQuery({ get, post: vi.fn() } as never, true, async () => true);
    expect(await q.queryFn()).toBe(fresh);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
