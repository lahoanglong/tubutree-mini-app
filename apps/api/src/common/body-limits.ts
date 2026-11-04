import { json, urlencoded } from 'express';
import { safeEqualStrings } from './safe-equal';
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
// Pancake gửi nguyên object đơn (dòng hàng + variation_info + customer + histories). Đơn lớn mà bị 400/413 thì sự kiện không được lưu
// và reconcile không cứu được; token đã kiểm trước khi parse (mọi method) nên người ẩn danh không tới được trần này.
export const PANCAKE_WEBHOOK_BODY_LIMIT = '10mb';

/** Nhóm route nhận ảnh base64 hoặc CSV: đối chiếu với DTO dùng IsUploadedImage/IsImageRef/IMAGE_MAX/*_CSV_MAX_LENGTH. */
const LARGE_BODY_ROUTES: readonly RegExp[] = [
  /^\/api\/admin(\/|$)/i,
  /^\/api\/merchant(\/|$)/i,
  /^\/api\/storefront(\/|$)/i,
  /^\/api\/brand(\/|$)/i,
  /^\/api\/dealer(\/|$)/i,
  /^\/api\/staff(\/|$)/i,
  /^\/api\/feed(\/|$)/i,
  /^\/api\/orders\/[^/]+\/return/i,
  /^\/api\/returns(\/|$)/i,
  /^\/api\/products\/[^/]+\/reviews(\/|$)/i,
  /^\/api\/reviews(\/|$)/i,
];
// Cờ i: Express định tuyến không phân biệt hoa thường, /api/Admin/... vẫn tới controller admin.
const WEBHOOK_ROUTE = /^\/api\/webhooks(\/|$)/i;
const PANCAKE_WEBHOOK_ROUTE = /^\/api\/webhooks\/pancake(\/|$)/i;

export const MAX_BODY_DEPTH = 10;
export const MAX_KEYS_PER_OBJECT = 200;
export const MAX_ARRAY_LENGTH = 500;
/** Tổng khoá + phần tử. Mảng hợp lệ lớn nhất của DTO là 500 chuỗi (productIds, ids đổi rác: ArrayMaxSize(500)) hoặc 200 object vài trường (itemIds, lượt chat) — dưới 1 500 nút; 6 000 là dư. */
export const MAX_BODY_NODES = 6_000;
/** Payload webhook do bên ngoài định dạng nên trần nới hơn (đơn Pancake nhiều dòng hàng + lịch sử). */
export const MAX_WEBHOOK_BODY_NODES = 20_000;
/** Riêng webhook Pancake (thân tới 10 MB, chỉ nhận sau khi qua token). */
export const MAX_PANCAKE_WEBHOOK_BODY_NODES = 200_000;
export const MAX_WEBHOOK_BODY_DEPTH = 64;

export const BODY_TOO_LARGE_MESSAGE = 'Dữ liệu gửi lên quá lớn. Bạn thử lại nhé.';
export const BODY_TOO_COMPLEX_MESSAGE = 'Dữ liệu gửi lên quá phức tạp. Bạn kiểm tra lại nhé.';
export const NUL_CHAR_MESSAGE = 'Dữ liệu gửi lên có ký tự không hợp lệ.';

type BodyTier = 'default' | 'webhook' | 'pancake' | 'large';

function tierFor(path: string): BodyTier {
  if (PANCAKE_WEBHOOK_ROUTE.test(path)) return 'pancake';
  if (LARGE_BODY_ROUTES.some((re) => re.test(path))) return 'large';
  if (WEBHOOK_ROUTE.test(path)) return 'webhook';
  return 'default';
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

export const CHARSET_UNSUPPORTED_MESSAGE = 'Dữ liệu gửi lên phải dùng mã hoá UTF-8.';
export const ENCODING_UNSUPPORTED_MESSAGE = 'Dữ liệu gửi lên dùng kiểu nén không hỗ trợ.';

/**
 * body-parser nhận mọi charset bắt đầu bằng `utf-` (utf-7, utf-16le...) và giải mã đồng bộ bằng iconv SAU verify;
 * giải mã 10 MB utf-7 chặn event loop hàng chục giây và buffer thô không còn các byte 0x22/0x3a để quét. Verify chạy
 * trước bước giải mã nên chặn ở đây là chặn luôn chi phí đó.
 */
function rawGuard(maxNodes: number, maxDepth: number) {
  return (_req: unknown, _res: unknown, buf: Buffer, encoding?: string): void => {
    if (String(encoding ?? 'utf-8').toLowerCase() !== 'utf-8') {
      throw Object.assign(new Error('charset'), { status: 415, type: 'charset.unsupported' });
    }
    if (buf.length > 1024 && !scanRawJson(buf, maxNodes, maxDepth)) {
      throw Object.assign(new Error('body too complex'), { status: 400, type: 'entity.complex' });
    }
  };
}

/** Parser riêng của /api/events: cùng chốt charset và quét thô (rawGuard) như các route khác, trần dung lượng riêng 512 KB. */
export function eventsBodyParser(): RequestHandler {
  return json({ limit: '512kb', verify: rawGuard(MAX_BODY_NODES, MAX_BODY_DEPTH) });
}

/**
 * Webhook ký trên byte gốc (Zalo OA: chữ ký tính trên thân như nhận được): giữ buffer ở `req.rawBody` (dạng `RawBodyRequest` của Nest),
 * vì JSON.stringify lại thân đã parse làm mất `\/` và `\uXXXX` nên chữ ký lệch.
 */
function keepRawBody(verify: ReturnType<typeof rawGuard>): ReturnType<typeof rawGuard> {
  return (req, res, buf, encoding) => {
    verify(req, res, buf, encoding);
    (req as { rawBody?: Buffer }).rawBody = buf;
  };
}

/** json + urlencoded theo nhóm route; parser dựng một lần cho mỗi mức trần. */
export function createBodyParsers(): RequestHandler[] {
  const specs: Record<BodyTier, { limit: string; verify: ReturnType<typeof rawGuard> }> = {
    default: { limit: DEFAULT_BODY_LIMIT, verify: rawGuard(MAX_BODY_NODES, MAX_BODY_DEPTH) },
    webhook: { limit: WEBHOOK_BODY_LIMIT, verify: keepRawBody(rawGuard(MAX_WEBHOOK_BODY_NODES, MAX_WEBHOOK_BODY_DEPTH)) },
    pancake: { limit: PANCAKE_WEBHOOK_BODY_LIMIT, verify: rawGuard(MAX_PANCAKE_WEBHOOK_BODY_NODES, MAX_WEBHOOK_BODY_DEPTH) },
    large: { limit: LARGE_BODY_LIMIT, verify: rawGuard(MAX_BODY_NODES, MAX_BODY_DEPTH) },
  };
  const tiers = new Map<BodyTier, { json: RequestHandler; urlencoded: RequestHandler }>();
  for (const [tier, { limit, verify }] of Object.entries(specs) as Array<[BodyTier, (typeof specs)[BodyTier]]>) {
    tiers.set(tier, { json: json({ limit, verify }), urlencoded: urlencoded({ limit, extended: true }) });
  }
  const pick = (kind: 'json' | 'urlencoded'): RequestHandler => (req, res, next) => tiers.get(tierFor(req.path))![kind](req, res, next);
  return [pick('json'), pick('urlencoded')];
}

type Violation = 'complex' | 'nul';

interface BodyShapeLimits { depth: number; keys: number; array: number }
const DEFAULT_SHAPE: BodyShapeLimits = { depth: MAX_BODY_DEPTH, keys: MAX_KEYS_PER_OBJECT, array: MAX_ARRAY_LENGTH };
/** Webhook do bên ngoài định dạng và body của nó không qua ValidationPipe: chỉ giữ trần tổng nút, để 1 đơn lớn không bị 400 rồi mất đồng bộ. */
const WEBHOOK_SHAPE: BodyShapeLimits = { depth: MAX_WEBHOOK_BODY_DEPTH, keys: MAX_WEBHOOK_BODY_NODES, array: MAX_WEBHOOK_BODY_NODES };
const PANCAKE_SHAPE: BodyShapeLimits = { depth: MAX_WEBHOOK_BODY_DEPTH, keys: MAX_PANCAKE_WEBHOOK_BODY_NODES, array: MAX_PANCAKE_WEBHOOK_BODY_NODES };

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

const STATUS_NAMES: Record<number, string> = { 401: 'Unauthorized', 413: 'Payload Too Large', 415: 'Unsupported Media Type' };

function reject(res: Response, status: number, message: string): void {
  res.status(status).json({ statusCode: status, message, error: STATUS_NAMES[status] ?? 'Bad Request' });
}

// %00 trong URL (đường dẫn, query) đã giải mã thành NUL; Postgres từ chối NUL nên Prisma trả 500 thay vì 400.
const NUL_IN_URL = /%00/i;

/** Chặn NUL ở URL và thân, và thân quá nhiều khoá/phần tử/tầng lồng, trước ValidationPipe. */
export const requestInputGuard: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (NUL_IN_URL.test(req.url)) return reject(res, 400, NUL_CHAR_MESSAGE);
  const violation = PANCAKE_WEBHOOK_ROUTE.test(req.path)
    ? inspectBody(req.body, MAX_PANCAKE_WEBHOOK_BODY_NODES, PANCAKE_SHAPE)
    : WEBHOOK_ROUTE.test(req.path)
      ? inspectBody(req.body, MAX_WEBHOOK_BODY_NODES, WEBHOOK_SHAPE)
      : inspectBody(req.body, MAX_BODY_NODES);
  if (violation === 'nul') return reject(res, 400, NUL_CHAR_MESSAGE);
  if (violation === 'complex') return reject(res, 400, BODY_TOO_COMPLEX_MESSAGE);
  next();
};

export const PANCAKE_TOKEN_MISSING_SECRET_MESSAGE = 'Webhook chưa cấu hình bí mật ở production.';
export const PANCAKE_TOKEN_INVALID_MESSAGE = 'Token webhook không hợp lệ.';

/**
 * Kiểm token webhook Pancake TRƯỚC body parser: thân tới 10 MB / 200 000 nút chỉ được parse khi đúng token, nên người ẩn danh
 * không bắt server parse 10 MB. Cùng nguồn và cùng hành vi với PancakeWebhookController (controller vẫn kiểm lại, phòng thủ hai lớp).
 */
export const pancakeWebhookTokenGuard: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  // Mọi method: trần 10 MB xếp theo đường dẫn, nên PUT/PATCH/DELETE không token cũng phải dừng ở đây (controller chỉ có POST).
  if (!PANCAKE_WEBHOOK_ROUTE.test(req.path)) return next();
  const secret = process.env.PANCAKE_WEBHOOK_SECRET ?? '';
  if (!secret) {
    if (process.env.NODE_ENV === 'production') return reject(res, 401, PANCAKE_TOKEN_MISSING_SECRET_MESSAGE);
    return next(); // dev/test: bỏ qua như controller
  }
  const header = req.headers['x-webhook-token'];
  const token = Array.isArray(header) ? header[0] : header;
  if (!token || !safeEqualStrings(token, secret)) return reject(res, 401, PANCAKE_TOKEN_INVALID_MESSAGE);
  next();
};

/** body-parser ném PayloadTooLargeError (413) / lỗi JSON (400): trả JSON cùng dạng với lỗi Nest thay vì trang HTML của Express. */
export const bodyParserErrorHandler: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  const e = err as { type?: string; status?: number; statusCode?: number } | undefined;
  const status = e?.status ?? e?.statusCode;
  if (e?.type === 'entity.too.large') return reject(res, 413, BODY_TOO_LARGE_MESSAGE);
  if (e?.type === 'charset.unsupported') return reject(res, 415, CHARSET_UNSUPPORTED_MESSAGE);
  // Content-Encoding lạ (vd br2): trả 415 tại đây, không để Nest ghi stack cho mỗi request ẩn danh lặp lại.
  if (e?.type === 'encoding.unsupported') return reject(res, 415, ENCODING_UNSUPPORTED_MESSAGE);
  if (e?.type === 'entity.complex') return reject(res, 400, BODY_TOO_COMPLEX_MESSAGE);
  // urlencoded: quá 1000 tham số (parameterLimit) hoặc qs ném RangeError khi vượt trần → 400 như thân JSON quá phức tạp.
  if (e?.type === 'parameters.too.many') return reject(res, 400, BODY_TOO_COMPLEX_MESSAGE);
  if (e?.type === 'querystring.parse.rangeError') return reject(res, 400, BODY_TOO_COMPLEX_MESSAGE);
  // Khách đóng kết nối giữa chừng: không còn ai nhận phản hồi, chỉ đóng.
  if (e?.type === 'request.aborted') {
    if (!res.headersSent) res.end();
    return;
  }
  // Mọi lỗi 4xx khác của parser (JSON hỏng, thân gzip/deflate hỏng `Z_*` không có `type`...) là lỗi của request:
  // trả JSON tại đây, không để Nest ghi stack cho mỗi request ẩn danh lặp lại và không lộ chữ của zlib.
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return reject(res, status, 'Dữ liệu gửi lên không đọc được. Bạn kiểm tra lại nhé.');
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
