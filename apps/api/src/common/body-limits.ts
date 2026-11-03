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

/**
 * Quét thô buffer JSON TRƯỚC JSON.parse: parser chạy trước auth/throttle nên thân 10 MB hàng trăm nghìn khoá của kẻ ẩn danh
 * làm JSON.parse chặn event loop ~1,6 s dù inspectBody sau đó loại nó. Quét O(n) một lượt, bỏ qua nội dung chuỗi, đếm
 * khoá (':'), phần tử mảng (',' trong mảng + '[') và độ sâu; vượt trần thì ném lỗi 400 ngay.
 */
export function scanRawJson(buf: Buffer, maxNodes: number, maxDepth: number): boolean {
  let nodes = 0;
  let depth = 0;
  // Ngăn xếp loại container, chỉ cần biết đỉnh là mảng hay object; độ sâu thật không vượt maxDepth + 1 nên mảng bit nhỏ là đủ.
  const isArray: boolean[] = [];
  let inString = false;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (inString) {
      if (c === 0x5c) i++;
      else if (c === 0x22) inString = false;
      continue;
    }
    switch (c) {
      case 0x22: inString = true; break;
      case 0x7b:
      case 0x5b:
        if (++depth > maxDepth) return false;
        isArray[depth] = c === 0x5b;
        break;
      case 0x7d:
      case 0x5d:
        if (depth > 0) depth--;
        break;
      case 0x3a:
        if (++nodes > maxNodes) return false;
        break;
      case 0x2c:
        if (depth > 0 && isArray[depth] && ++nodes > maxNodes) return false;
        break;
    }
  }
  return true;
}

function rawGuard(maxNodes: number, maxDepth: number) {
  return (_req: unknown, _res: unknown, buf: Buffer): void => {
    if (buf.length > 1024 && !scanRawJson(buf, maxNodes, maxDepth)) {
      throw Object.assign(new Error('body too complex'), { status: 400, type: 'entity.complex' });
    }
  };
}

/** json + urlencoded theo nhóm route; parser dựng một lần cho mỗi mức trần. */
export function createBodyParsers(): RequestHandler[] {
  const tiers = new Map<string, { json: RequestHandler; urlencoded: RequestHandler }>();
  for (const limit of [DEFAULT_BODY_LIMIT, WEBHOOK_BODY_LIMIT, LARGE_BODY_LIMIT]) {
    const verify = limit === WEBHOOK_BODY_LIMIT ? rawGuard(MAX_WEBHOOK_BODY_NODES, WEBHOOK_SHAPE.depth) : rawGuard(MAX_BODY_NODES, MAX_BODY_DEPTH);
    tiers.set(limit, { json: json({ limit, verify }), urlencoded: urlencoded({ limit, extended: true }) });
  }
  const pick = (kind: 'json' | 'urlencoded'): RequestHandler => (req, res, next) => tiers.get(limitFor(req.path))![kind](req, res, next);
  return [pick('json'), pick('urlencoded')];
}

type Violation = 'complex' | 'nul';

interface BodyShapeLimits { depth: number; keys: number; array: number }
const DEFAULT_SHAPE: BodyShapeLimits = { depth: MAX_BODY_DEPTH, keys: MAX_KEYS_PER_OBJECT, array: MAX_ARRAY_LENGTH };
/** Webhook do bên ngoài định dạng và body của nó không qua ValidationPipe: chỉ giữ trần tổng nút, để 1 đơn lớn không bị 400 rồi mất đồng bộ. */
const WEBHOOK_SHAPE: BodyShapeLimits = { depth: 64, keys: MAX_WEBHOOK_BODY_NODES, array: MAX_WEBHOOK_BODY_NODES };

/** Duyệt lặp (không đệ quy: thân lồng sâu không làm tràn stack). Trả vi phạm đầu tiên hoặc null. */
export function inspectBody(body: unknown, maxNodes: number, limits: BodyShapeLimits = DEFAULT_SHAPE): Violation | null {
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
    if (depth > limits.depth) return 'complex';
    if (Array.isArray(value)) {
      if (value.length > limits.array) return 'complex';
      nodes += value.length;
      if (nodes > maxNodes) return 'complex';
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    let keys = 0;
    for (const key in value as Record<string, unknown>) {
      if (++keys > limits.keys) return 'complex';
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
  const violation = WEBHOOK_ROUTE.test(req.path)
    ? inspectBody(req.body, MAX_WEBHOOK_BODY_NODES, WEBHOOK_SHAPE)
    : inspectBody(req.body, MAX_BODY_NODES);
  if (violation === 'nul') return reject(res, 400, NUL_CHAR_MESSAGE);
  if (violation === 'complex') return reject(res, 400, BODY_TOO_COMPLEX_MESSAGE);
  next();
};

/** body-parser ném PayloadTooLargeError (413) / lỗi JSON (400): trả JSON cùng dạng với lỗi Nest thay vì trang HTML của Express. */
export const bodyParserErrorHandler: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  const e = err as { type?: string; status?: number; statusCode?: number } | undefined;
  const status = e?.status ?? e?.statusCode;
  if (e?.type === 'entity.too.large') return reject(res, 413, BODY_TOO_LARGE_MESSAGE);
  if (e?.type === 'entity.complex') return reject(res, 400, BODY_TOO_COMPLEX_MESSAGE);
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
