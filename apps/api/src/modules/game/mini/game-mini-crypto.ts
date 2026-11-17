import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isMiniGameId, type MiniGameId } from '@tubutree/shared-types';

/** Chỉ cho máy dev và test: production luôn có JWT_ACCESS_SECRET (env.validation đòi tối thiểu 16 ký tự). */
const DEV_SECRET = 'dev-only-game-mini-secret';
const TOKEN_VERSION = 'm1';
const MAX_CONTENT_IDS = 20;

/** Khoá riêng theo mục đích, suy từ bí mật gốc, để chữ ký của việc này không dùng chéo sang việc khác (cùng cách mã ván arcade). */
function key(secret: string | undefined, purpose: string): Buffer {
  return createHmac('sha256', secret || DEV_SECRET).update(`game-mini|${purpose}|v1`).digest();
}

function mac(secret: string | undefined, purpose: string, body: string): string {
  return createHmac('sha256', key(secret, purpose)).update(body).digest('base64url');
}

/** Ván của khách chưa đăng nhập: không lưu DB, máy chủ chấm theo danh sách mục nằm trong mã đã ký. */
export interface GuestRound {
  game: MiniGameId;
  issuedAt: number;
  contentIds: string[];
  /** Khoá ván để suy mã thẻ Ghép Cặp. */
  nonce: string;
}

export function signGuestRound(
  round: Omit<GuestRound, 'nonce'>,
  secret: string | undefined,
  nonce: string = randomBytes(9).toString('base64url'),
): { token: string; nonce: string } {
  const body = Buffer.from(JSON.stringify({ g: round.game, i: round.issuedAt, c: round.contentIds, n: nonce })).toString('base64url');
  return { token: `${TOKEN_VERSION}.${body}.${mac(secret, 'guest-round', body)}`, nonce };
}

/** Kiểm chữ ký và hình dạng; null khi sai. Không kiểm hạn: nơi gọi so `issuedAt` với đồng hồ. */
export function readGuestRound(token: unknown, secret: string | undefined): GuestRound | null {
  if (typeof token !== 'string' || token.length > 4000) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const [, body, sig] = parts as [string, string, string];
  const expected = Buffer.from(mac(secret, 'guest-round', body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const p = parsed as { g?: unknown; i?: unknown; c?: unknown; n?: unknown };
  if (!isMiniGameId(p.g) || !Number.isSafeInteger(p.i) || typeof p.n !== 'string' || p.n === '') return null;
  if (!Array.isArray(p.c) || p.c.length === 0 || p.c.length > MAX_CONTENT_IDS || !p.c.every((x) => typeof x === 'string' && x !== '')) {
    return null;
  }
  return { game: p.g, issuedAt: p.i as number, contentIds: p.c as string[], nonce: p.n };
}

/**
 * Mã thẻ Ghép Cặp của một ván. Hai thẻ của cùng một cặp mang mã khác nhau và không chứa id cặp: khách chỉ biết thẻ nào đi với thẻ
 * nào khi lật đúng. Suy lại được lúc chấm nên không cần lưu bảng ánh xạ.
 */
export function matchCardId(secret: string | undefined, roundKey: string, contentId: string, side: 'ingredient' | 'use'): string {
  return mac(secret, 'match-card', `${roundKey}|${contentId}|${side}`).slice(0, 16);
}

/**
 * Băm mã thiết bị trước khi lưu. Mã thiết bị do ứng dụng tự sinh và gửi lên nên giả được: trần theo thiết bị chỉ là lớp ma sát
 * với một máy nhiều tài khoản Zalo. Lớp chặn thật là trần theo tài khoản và ngân sách điểm toàn hệ thống.
 */
export function deviceHash(secret: string | undefined, deviceId: string): string {
  return createHmac('sha256', key(secret, 'device')).update(deviceId).digest('hex');
}
