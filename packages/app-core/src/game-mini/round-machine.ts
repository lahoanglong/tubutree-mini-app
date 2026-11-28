import { MINI_MIN_ROUND_MS, MINI_ROUND_TTL_MS, miniMinRoundMs, type MiniStartResponse, type MiniSubmitResponse } from '@tubutree/shared-types';
import type { RoundFailure } from './api';

/**
 * Máy trạng thái của một ván game mini, dùng chung Mini App và web (app chỉ nối `dispatch` với lệnh gọi API):
 *
 * idle → starting → playing → submitting → result
 *            ↘ error     ↘ expired   ↘ error | expired
 *
 * Nộp bài hỏng vì mạng thì máy tự gửi lại tối đa `SUBMIT_RETRIES` lần, đáp án giữ trong bộ nhớ; hết lượt gửi lại thì sang `error` vẫn giữ
 * đáp án để khách bấm "Thử lại". Ván quá hạn (10 phút từ lúc phát) không chấm, không thưởng, không tính lượt.
 *
 * Hạn ván tính theo đồng hồ của máy khách: `receivedAt` (lúc nhận đề) + độ dài hạn máy chủ cấp (`expiresAt − issuedAt`), để giờ máy lệch
 * không làm ván hết hạn sớm hay muộn.
 */
export type RoundPhase = 'idle' | 'starting' | 'playing' | 'submitting' | 'result' | 'error' | 'expired';

export interface RoundState {
  phase: RoundPhase;
  round: MiniStartResponse | null;
  receivedAt: number | null;
  deadline: number | null;
  answers: unknown[] | null;
  /** Lần gửi thứ mấy của đợt nộp hiện tại (1 = lần đầu). */
  attempts: number;
  result: MiniSubmitResponse | null;
  failure: RoundFailure | null;
  failedStep: 'start' | 'submit' | null;
}

export type RoundEvent =
  | { type: 'start' }
  | { type: 'started'; round: MiniStartResponse; now: number }
  | { type: 'start_failed'; failure: RoundFailure }
  | { type: 'finish'; answers: unknown[]; now: number }
  | { type: 'submitted'; result: MiniSubmitResponse }
  | { type: 'submit_failed'; failure: RoundFailure; now: number }
  | { type: 'retry'; now: number }
  | { type: 'expire' }
  | { type: 'reset' };

/** Số lần tự gửi lại sau lần nộp đầu (mất mạng, 5xx, 429). */
export const SUBMIT_RETRIES = 2;
/** Chờ giữa hai lần gửi lại. */
export const SUBMIT_BACKOFF_MS = [1_500, 3_000] as const;
/** Đệm trên mức tối thiểu của máy chủ: máy chủ đo từ `issuedAt` (sớm hơn lúc máy khách nhận đề), đệm thêm cho chắc. */
const MIN_ROUND_PAD_MS = 500;

export const initialRoundState: RoundState = {
  phase: 'idle',
  round: null,
  receivedAt: null,
  deadline: null,
  answers: null,
  attempts: 0,
  result: null,
  failure: null,
  failedStep: null,
};

const RETRYABLE: ReadonlySet<RoundFailure> = new Set(['network', 'too_fast']);

/** Độ dài hạn máy chủ cấp cho ván; dữ liệu hỏng thì dùng hạn chuẩn 10 phút. */
function ttlOf(round: MiniStartResponse): number {
  const ttl = Date.parse(round.expiresAt) - Date.parse(round.issuedAt);
  return Number.isFinite(ttl) && ttl > 0 ? ttl : MINI_ROUND_TTL_MS;
}

const isExpired = (s: RoundState, now: number) => s.deadline !== null && now >= s.deadline;

export function roundReducer(s: RoundState, e: RoundEvent): RoundState {
  switch (e.type) {
    case 'start':
      // Đang phát đề, đang chơi hay đang nộp: chạm Bắt đầu lần nữa không mở ván thứ hai.
      if (s.phase === 'starting' || s.phase === 'playing' || s.phase === 'submitting') return s;
      return { ...initialRoundState, phase: 'starting' };
    case 'started':
      if (s.phase !== 'starting') return s;
      return { ...s, phase: 'playing', round: e.round, receivedAt: e.now, deadline: e.now + ttlOf(e.round) };
    case 'start_failed':
      if (s.phase !== 'starting') return s;
      return { ...s, phase: 'error', failure: e.failure, failedStep: 'start' };
    case 'finish':
      if (s.phase !== 'playing') return s;
      if (isExpired(s, e.now)) return { ...s, phase: 'expired', answers: e.answers };
      return { ...s, phase: 'submitting', answers: e.answers, attempts: 1, failure: null, failedStep: null };
    case 'submitted':
      if (s.phase !== 'submitting') return s;
      return { ...s, phase: 'result', result: e.result, failure: null, failedStep: null };
    case 'submit_failed':
      if (s.phase !== 'submitting') return s;
      if (e.failure === 'expired' || isExpired(s, e.now)) return { ...s, phase: 'expired', failure: null };
      if (RETRYABLE.has(e.failure) && s.attempts <= SUBMIT_RETRIES) return { ...s, attempts: s.attempts + 1, failure: e.failure };
      return { ...s, phase: 'error', failure: e.failure, failedStep: 'submit' };
    case 'retry':
      if (s.phase !== 'error' || s.failedStep !== 'submit' || s.answers === null) return s;
      if (isExpired(s, e.now)) return { ...s, phase: 'expired', failure: null, failedStep: null };
      return { ...s, phase: 'submitting', attempts: 1, failure: null, failedStep: null };
    case 'expire':
      if (s.round === null || (s.phase !== 'playing' && s.phase !== 'submitting' && !(s.phase === 'error' && s.failedStep === 'submit'))) return s;
      return { ...s, phase: 'expired', failure: null, failedStep: null };
    case 'reset':
      return initialRoundState;
  }
}

/** Chờ bao lâu trước lần gửi thứ `attempts`: lần đầu đợi cho đủ thời gian tối thiểu của máy chủ, lần sau lùi dần. */
export function submitDelayMs(s: RoundState, now: number): number {
  if (s.phase !== 'submitting') return 0;
  if (s.attempts <= 1) {
    if (s.receivedAt === null) return 0;
    // Băng Chuyền Xanh có mức nộp sớm nhất riêng (20 giây), cao hơn mức chung.
    const min = s.round ? miniMinRoundMs(s.round.game) : MINI_MIN_ROUND_MS;
    return Math.max(0, s.receivedAt + min + MIN_ROUND_PAD_MS - now);
  }
  const backoff = SUBMIT_BACKOFF_MS[Math.min(s.attempts - 2, SUBMIT_BACKOFF_MS.length - 1)]!;
  // `too_fast` nghĩa là máy chủ thấy ván ngắn hơn mức tối thiểu: đợi đủ mức đó chứ không chỉ khoảng lùi.
  return s.failure === 'too_fast' ? Math.max(backoff, s.round ? miniMinRoundMs(s.round.game) : MINI_MIN_ROUND_MS) : backoff;
}

/** Mili giây còn lại tới hạn ván (không âm); chưa có ván thì null. */
export function roundMsLeft(s: RoundState, now: number): number | null {
  return s.deadline === null ? null : Math.max(0, s.deadline - now);
}
