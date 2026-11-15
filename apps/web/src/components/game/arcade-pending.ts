import { ARCADE_GAME_IDS, type ArcadeGameId } from '@tubutree/app-core/arcade/arcade-config';

/** Mã ván máy chủ cấp ở `arcade-start` kèm giờ hết hạn máy chủ tính từ lúc CẤP mã (epoch ms, từ `expiresAt` của lời đáp). */
export interface ArcadeRunTicket {
  runId: string;
  expiresAt: number;
}

/** Ván của khách vừa bấm "Đăng nhập lưu kỷ lục": giữ qua vòng đăng nhập để ván không mất. */
export interface PendingArcade extends ArcadeRunTicket {
  gameId: ArcadeGameId;
  score: number;
  durationMs: number;
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
    const { gameId, score, durationMs, runId, expiresAt, endedAt } = v;
    if (!ARCADE_GAME_IDS.includes(gameId as ArcadeGameId)) return null;
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 0) return null;
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) return null;
    if (typeof runId !== 'string' || runId === '' || runId.length > MAX_RUN_ID_LENGTH) return null;
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
    if (typeof endedAt !== 'number' || !Number.isFinite(endedAt)) return null;
    // Máy chủ đếm hạn từ lúc cấp mã, không từ lúc ván xong: mã cấp lúc bấm Chơi đã hết hạn thì gửi chỉ nhận 400.
    if (now >= expiresAt) return null;
    if (now - endedAt > ARCADE_PENDING_TTL_MS || endedAt - now > FUTURE_SKEW_MS) return null;
    return { gameId: gameId as ArcadeGameId, score, durationMs, runId, expiresAt, endedAt };
  } catch {
    return null;
  }
}

/** Ghi ván chờ trước khi khách rời sang trang đăng nhập; storage hỏng thì bỏ qua (ván vẫn hiện đúng, chỉ không được nhớ qua đăng nhập). */
export function rememberPendingArcade(run: Omit<PendingArcade, 'endedAt'> & { endedAt?: number }, now = Date.now()): void {
  try {
    store()?.setItem(
      ARCADE_PENDING_KEY,
      JSON.stringify({ gameId: run.gameId, score: run.score, durationMs: run.durationMs, runId: run.runId, expiresAt: run.expiresAt, endedAt: run.endedAt ?? now }),
    );
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
 * Lấy ván chờ còn hợp lệ (chưa tới giờ hết hạn của mã ván, và chưa quá 10 phút từ lúc ván xong) và XOÁ khoá ngay trong lần gọi này, trước khi nơi gọi
 * gửi máy chủ: hai nơi cùng lấy (Strict Mode, hai lần dựng) thì chỉ một nơi nhận được ván. Ván quá hạn hay hỏng bị xoá và trả null.
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
