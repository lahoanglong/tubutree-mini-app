import { json, urlencoded } from 'express';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Giới hạn thân request trước ValidationPipe. `transform: true` chạy plainToInstance trên TOÀN BỘ thân trước khi
 * class-validator áp trần mảng, và chi phí tăng gần bậc hai theo số khoá (đo: 10 000 khoá ~1,7 s, 40 000 khoá ~19 s),
 * nên một request ẩn danh vài trăm KB đủ làm đứng event loop của tiến trình API duy nhất. Hai lớp chặn: trần dung lượng
 * theo nhóm route, rồi một lượt duyệt O(n) từ chối thân quá nhiều khoá/phần tử/tầng lồng.
 */

export const DEFAULT_BODY_LIMIT = '256kb';
// Webhook đối tác (Pancake, Zalo OA, ngân hàng, ZaloPay): payload do bên ngoài quyết định, để dư hơn route của app.
export const WEBHOOK_BODY_LIMIT = '1mb';
// Ảnh base64 (6 ảnh đổi/trả × 1,5M ký tự là trần lớn nhất của DTO) và CSV import (300 nghìn ký tự).
export const LARGE_BODY_LIMIT = '10mb';

/** Nhóm route nhận ảnh base64 hoặc CSV: đối chiếu với DTO dùng IsUploadedImage/IsImageRef/IMAGE_MAX/*_CSV_MAX_LENGTH. */
const LARGE_BODY_ROUTES: readonly RegExp[] = [
  /^\/api\/admin(\/|$)/,
  /^\/api\/merchant(\/|$)/,
  /^\/api\/storefront(\/|$)/,
  /^\/api\/brand(\/|$)/,
  /^\/api\/dealer(\/|$)/,
  /^\/api\/staff(\/|$)/,
  /^\/api\/feed(\/|$)/,
  /^\/api\/orders\/[^/]+\/return/,
  /^\/api\/returns(\/|$)/,
  /^\/api\/products\/[^/]+\/reviews(\/|$)/,
  /^\/api\/reviews(\/|$)/,
];
const WEBHOOK_ROUTE = /^\/api\/webhooks(\/|$)/;

export const MAX_BODY_DEPTH = 10;
export const MAX_KEYS_PER_OBJECT = 200;
export const MAX_ARRAY_LENGTH = 500;
/** Tổng khoá + phần tử. Hợp lệ lớn nhất: 500 dòng × ~5 trường (admin quà/vật phẩm đổi rác) ≈ 3 000. */
export const MAX_BODY_NODES = 6_000;
/** Payload webhook do bên ngoài định dạng nên trần nới hơn (đơn Pancake nhiều dòng hàng + lịch sử). */
export const MAX_WEBHOOK_BODY_NODES = 20_000;

export const BODY_TOO_LARGE_MESSAGE = 'Dữ liệu gửi lên quá lớn. Bạn thử lại nhé.';
export const BODY_TOO_COMPLEX_MESSAGE = 'Dữ liệu gửi lên quá phức tạp. Bạn kiểm tra lại nhé.';
export const NUL_CHAR_MESSAGE = 'Dữ liệu gửi lên có ký tự không hợp lệ.';

function limitFor(path: string): string {
  if (LARGE_BODY_ROUTES.some((re) => re.test(path))) return LARGE_BODY_LIMIT;
  if (WEBHOOK_ROUTE.test(path)) return WEBHOOK_BODY_LIMIT;
  return DEFAULT_BODY_LIMIT;
}

/** json + urlencoded theo nhóm route; parser dựng một lần cho mỗi mức trần. */
export function createBodyParsers(): RequestHandler[] {
  const tiers = new Map<string, { json: RequestHandler; urlencoded: RequestHandler }>();
  for (const limit of [DEFAULT_BODY_LIMIT, WEBHOOK_BODY_LIMIT, LARGE_BODY_LIMIT]) {
    tiers.set(limit, { json: json({ limit }), urlencoded: urlencoded({ limit, extended: true }) });
  }
  const pick = (kind: 'json' | 'urlencoded'): RequestHandler => (req, res, next) => tiers.get(limitFor(req.path))![kind](req, res, next);
  return [pick('json'), pick('urlencoded')];
}

type Violation = 'complex' | 'nul';

/** Duyệt lặp (không đệ quy: thân lồng sâu không làm tràn stack). Trả vi phạm đầu tiên hoặc null. */
export function inspectBody(body: unknown, maxNodes: number): Violation | null {
  if (body === null || typeof body !== 'object') return null;
  let nodes = 0;
  const stack: Array<{ value: unknown; depth: number }> = [{ value: body, depth: 1 }];
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    if (typeof value === 'string') {
      if (value.includes('\u0000')) return 'nul';
      continue;
    }
    if (value === null || typeof value !== 'object') continue;
    if (depth > MAX_BODY_DEPTH) return 'complex';
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_LENGTH) return 'complex';
      nodes += value.length;
      if (nodes > maxNodes) return 'complex';
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    let keys = 0;
    for (const key in value as Record<string, unknown>) {
      if (++keys > MAX_KEYS_PER_OBJECT) return 'complex';
      if (key.includes('\u0000')) return 'nul';
      stack.push({ value: (value as Record<string, unknown>)[key], depth: depth + 1 });
    }
    nodes += keys;
    if (nodes > maxNodes) return 'complex';
  }
  return null;
}

function reject(res: Response, status: number, message: string): void {
  res.status(status).json({ statusCode: status, message, error: status === 413 ? 'Payload Too Large' : 'Bad Request' });
}

// %00 trong URL (đường dẫn, query) đã giải mã thành NUL; Postgres từ chối NUL nên Prisma trả 500 thay vì 400.
const NUL_IN_URL = /%00/i;

/** Chặn NUL ở URL và thân, và thân quá nhiều khoá/phần tử/tầng lồng, trước ValidationPipe. */
export const requestInputGuard: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (NUL_IN_URL.test(req.url)) return reject(res, 400, NUL_CHAR_MESSAGE);
  const violation = inspectBody(req.body, WEBHOOK_ROUTE.test(req.path) ? MAX_WEBHOOK_BODY_NODES : MAX_BODY_NODES);
  if (violation === 'nul') return reject(res, 400, NUL_CHAR_MESSAGE);
  if (violation === 'complex') return reject(res, 400, BODY_TOO_COMPLEX_MESSAGE);
  next();
};

/** body-parser ném PayloadTooLargeError (413) / lỗi JSON (400): trả JSON cùng dạng với lỗi Nest thay vì trang HTML của Express. */
export const bodyParserErrorHandler: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  const e = err as { type?: string; status?: number; statusCode?: number } | undefined;
  const status = e?.status ?? e?.statusCode;
  if (e?.type === 'entity.too.large') return reject(res, 413, BODY_TOO_LARGE_MESSAGE);
  if (status === 400 && typeof e?.type === 'string' && e.type.startsWith('entity.')) {
    return reject(res, 400, 'Dữ liệu gửi lên không đọc được. Bạn kiểm tra lại nhé.');
  }
  next(err);
};

/**
 * Phản hồi cho request có xác thực mang dữ liệu cá nhân: mặc định `private, no-store`. Route tự khai báo (`@Header`,
 * `@PublicCache`, ảnh có `immutable`) ghi đè vì chúng chạy sau middleware này.
 */
export const privateNoStoreForAuthenticated: RequestHandler = (req, res, next) => {
  if (req.headers.authorization) res.setHeader('Cache-Control', 'private, no-store');
  next();
};
