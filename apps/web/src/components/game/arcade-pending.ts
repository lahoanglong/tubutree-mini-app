import { ARCADE_GAME_IDS, type ArcadeGameId } from '@tubutree/app-core/arcade/arcade-config';

/** Ván của khách vừa bấm "Đăng nhập lưu kỷ lục": giữ qua vòng đăng nhập để ván không mất. */
export interface PendingArcade {
  gameId: ArcadeGameId;
  score: number;
  durationMs: number;
  /** Mã ván lấy lúc khách bấm Chơi (`arcade-start`, công khai nên khách xin được): đăng nhập xong mới có người nhận thưởng. */
  runId: string;
  endedAt: number;
}

export const ARCADE_PENDING_KEY = 'tubu.arcade.pending';
export const ARCADE_PENDING_TTL_MS = 10 * 60_000;
// Cùng giới hạn của DTO `arcade-complete` ở máy chủ.
const MAX_RUN_ID_LENGTH = 200;
// Đồng hồ máy lệch nhẹ vẫn nhận; lệch xa về tương lai là dữ liệu hỏng, không gửi.
const FUTURE_SKEW_MS = 60_000;

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null, now: number): PendingArcade | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingArcade> | null;
    if (!v || typeof v !== 'object') return null;
    const { gameId, score, durationMs, runId, endedAt } = v;
    if (!ARCADE_GAME_IDS.includes(gameId as ArcadeGameId)) return null;
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 0) return null;
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) return null;
    if (typeof runId !== 'string' || runId === '' || runId.length > MAX_RUN_ID_LENGTH) return null;
    if (typeof endedAt !== 'number' || !Number.isFinite(endedAt)) return null;
    if (now - endedAt > ARCADE_PENDING_TTL_MS || endedAt - now > FUTURE_SKEW_MS) return null;
    return { gameId: gameId as ArcadeGameId, score, durationMs, runId, endedAt };
  } catch {
    return null;
  }
}

/** Ghi ván chờ trước khi khách rời sang trang đăng nhập; storage hỏng thì bỏ qua (ván vẫn hiện đúng, chỉ không được nhớ qua đăng nhập). */
export function rememberPendingArcade(run: Omit<PendingArcade, 'endedAt'> & { endedAt?: number }, now = Date.now()): void {
  try {
    store()?.setItem(ARCADE_PENDING_KEY, JSON.stringify({ gameId: run.gameId, score: run.score, durationMs: run.durationMs, runId: run.runId, endedAt: run.endedAt ?? now }));
  } catch {
    /* khách tự chơi lại sau khi đăng nhập */
  }
}

/** Xoá khoá chờ. */
export function clearPendingArcade(): void {
  try {
    store()?.removeItem(ARCADE_PENDING_KEY);
  } catch {
    /* không có storage thì không có gì để xoá */
  }
}

/**
 * Lấy ván chờ còn hợp lệ (chưa quá 10 phút) và XOÁ khoá ngay trong lần gọi này, trước khi nơi gọi gửi máy chủ: hai nơi cùng lấy
 * (Strict Mode, hai lần dựng) thì chỉ một nơi nhận được ván. Ván quá hạn hay hỏng bị xoá và trả null.
 */
export function takePendingArcade(now = Date.now()): PendingArcade | null {
  const s = store();
  if (!s) return null;
  let raw: string | null = null;
  try {
    raw = s.getItem(ARCADE_PENDING_KEY);
  } catch {
    return null;
  }
  clearPendingArcade();
  return parse(raw, now);
}
