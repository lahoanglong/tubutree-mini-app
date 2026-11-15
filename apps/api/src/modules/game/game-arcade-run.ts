import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ARCADE_GAME_IDS, type ArcadeGameId } from './game-arcade.constants';

/**
 * Chỉ dùng khi chưa cấu hình bí mật (máy dev, test). Production luôn có JWT_ACCESS_SECRET (env.validation đòi tối thiểu 16 ký tự)
 * nên nhánh này không bao giờ chạy ở đó.
 */
const DEV_SECRET = 'dev-only-arcade-run-secret';
const VERSION = 'r1';

/** Nội dung mã ván: ván của game nào, máy chủ cấp lúc nào. */
export interface ArcadeRun {
  gameId: ArcadeGameId;
  issuedAt: number;
}

/** Khoá riêng cho mục đích này, suy ra từ bí mật gốc để một chữ ký không dùng chéo sang chỗ khác (cùng cách `hashIp`). */
function key(secret: string | undefined): Buffer {
  return createHmac('sha256', secret || DEV_SECRET).update('arcade-run|v1').digest();
}

function sign(body: string, secret: string | undefined): string {
  return createHmac('sha256', key(secret)).update(body).digest('base64url');
}

/**
 * Cấp mã ván không trạng thái: `r1.<gameId>.<issuedAt>.<nonce>.<chữ ký>`. Chữ ký HMAC phủ cả bốn phần đầu nên khách không đổi được game
 * hay giờ cấp. Mã không ghi vào DB; dùng một lần được chốt bằng thứ tự thời gian ở `GameArcadeService.complete` (mã cấp trước lúc
 * người nhận ghi ván gần nhất thì coi là đã dùng). `nonce` làm hai mã cấp cùng mili giây khác nhau.
 */
export function signArcadeRun(gameId: ArcadeGameId, issuedAt: number, secret: string | undefined, nonce: string = randomBytes(9).toString('base64url')): string {
  const body = `${VERSION}.${gameId}.${issuedAt}.${nonce}`;
  return `${body}.${sign(body, secret)}`;
}

/** Đọc và kiểm chữ ký mã ván; null khi sai định dạng, sai chữ ký hay game lạ. Không kiểm hạn: nơi gọi tự so `issuedAt` với đồng hồ. */
export function readArcadeRun(runId: unknown, secret: string | undefined): ArcadeRun | null {
  if (typeof runId !== 'string') return null;
  const parts = runId.split('.');
  if (parts.length !== 5 || parts[0] !== VERSION) return null;
  const [, gameId, issued, nonce, sig] = parts as [string, string, string, string, string];
  if (!ARCADE_GAME_IDS.includes(gameId as ArcadeGameId) || !/^\d{10,15}$/.test(issued) || nonce === '' || sig === '') return null;
  const expected = Buffer.from(sign(`${VERSION}.${gameId}.${issued}.${nonce}`, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { gameId: gameId as ArcadeGameId, issuedAt: Number(issued) };
}
