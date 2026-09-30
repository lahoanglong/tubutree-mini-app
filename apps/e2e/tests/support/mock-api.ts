import { test as base, expect, type Request, type Route } from '@playwright/test';
import type { AuthUser, LoginResponse, OrderDTO } from '@tubutree/shared-types';
import type { MeProfile } from '../../../miniapp/src/services/account-api';

/**
 * Mock API cho các spec Zalo Mini App (`*.miniapp.spec.ts`) — KHÔNG cần API/DB thật.
 *
 * Vì sao không dùng `page.route('**\/api/xxx*')` rải rác như trước:
 *   - Glob `*` không khớp dấu `/` → `'**\/api/me*'` KHÔNG bắt `/api/me/wallet`; mock sai đường
 *     (vd `/account/loyalty` — route không tồn tại trong NestJS) im lặng không bao giờ khớp.
 *   - Request không có mock rò ra mạng thật: miniapp mặc định gọi http://localhost:3001/api (cổng
 *     API dev local — xem apps/miniapp/src/services/api.ts). API dev trả 401 cho token giả →
 *     interceptor refresh thất bại → store/auth.ts xoá phiên → màn hình kẹt, test chập chờn.
 *   - `route.continue()` cho method không mock cũng gửi thẳng request ra API thật.
 *
 * Ở đây MỌI request có pathname bắt đầu bằng `/api/` (bất kể host: :3001, proxy /api của Vite
 * :3113 → api.tubutree.com, …) đi qua MỘT bộ định tuyến:
 *   - Khớp mock (method + path kiểu NestJS `/orders/:code`, KHÔNG gồm tiền tố /api) → trả mock.
 *   - Không khớp → trả 404 `E2E_UNMOCKED` (không phải 401: 401 kích hoạt refresh + xoá phiên) và
 *     ghi lại. Cuối test, fixture FAIL nếu có lời gọi chưa mock mà spec không khai báo
 *     `api.allowUnmocked(...)` — mock sai đường sẽ lộ ngay thay vì âm thầm pass.
 * Request ra host ngoài (Google Fonts, ảnh VietQR, Zalo…) bị abort để test không phụ thuộc mạng.
 *
 * Mọi path mock phải khớp route thật trong apps/api/src/modules/** (global prefix 'api', main.ts)
 * và service tương ứng trong apps/miniapp/src/services/**.
 */

export interface MockCall {
  method: string;
  /** Path KHÔNG gồm tiền tố /api, vd `/checkout/place-order`. */
  path: string;
  query: URLSearchParams;
  /** Body JSON đã parse (hoặc chuỗi thô nếu không phải JSON; undefined nếu không có body). */
  body: unknown;
  headers: Record<string, string>;
}

export interface MockContext {
  call: MockCall;
  /** Tham số path, vd `{ code: 'TUBU-1' }` cho `/orders/:code`. */
  params: Record<string, string>;
  request: Request;
}

const REPLY = Symbol('mock-reply');
export interface MockReply {
  [REPLY]: true;
  status: number;
  json: unknown;
}

/** Trả status khác 200 (vd lỗi nghiệp vụ 400 với message tiếng Việt như NestJS). */
export function reply(status: number, json?: unknown): MockReply {
  return { [REPLY]: true, status, json: json ?? null };
}

function isReply(v: unknown): v is MockReply {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[REPLY] === true;
}

type HandlerFn = (ctx: MockContext) => unknown;
/** Giá trị JSON (200) | reply(status, json) | hàm (ctx) => một trong hai (có thể async). */
export type MockHandler = HandlerFn | object | string | number | boolean | null;

interface RouteDef {
  method: string;
  pattern: string;
  regex: RegExp;
  keys: string[];
  /** Số đoạn path cố định (không phải `:param`) — route cụ thể hơn thắng route có `:param` cùng dạng path. */
  literals: number;
  handler: MockHandler;
}

function compile(pattern: string): { regex: RegExp; keys: string[] } {
  if (!pattern.startsWith('/')) throw new Error(`Path mock phải bắt đầu bằng "/": ${pattern}`);
  if (pattern.startsWith('/api/')) throw new Error(`Path mock KHÔNG gồm tiền tố /api: ${pattern}`);
  const keys: string[] = [];
  const src = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${src}/?$`), keys };
}

/** Số đoạn path cố định (không phải `:param`) của path mẫu. */
function literalCount(pattern: string): number {
  return pattern.split('/').filter((seg) => seg !== '' && !seg.startsWith(':')).length;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

export class MockApi {
  private readonly routes: RouteDef[] = [];
  private readonly allowed = new Set<string>();
  private readonly waiters: { method: string; regex: RegExp; resolve: (c: MockCall) => void }[] = [];
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  /** Độ cụ thể (số đoạn cố định) của route ĐÃ trả lời mỗi lời gọi — để callsTo không đếm nhầm. */
  private readonly servedLiterals = new WeakMap<MockCall, number>();
  /** Mọi lời gọi ĐÃ được mock trả lời (theo thứ tự). */
  readonly calls: MockCall[] = [];
  /** Lời gọi không có mock (đã trả 404 E2E_UNMOCKED), dạng "GET /path". */
  readonly unmocked: string[] = [];
  /** Lỗi ném ra từ chính hàm mock (bug của spec) — fixture fail nếu khác rỗng. */
  readonly handlerErrors: string[] = [];

  /**
   * Đăng ký mock. Route CỤ THỂ HƠN thắng (nhiều đoạn path cố định hơn: `/orders/active-count` thắng
   * `/orders/:code` dù đăng ký trước hay sau); cùng độ cụ thể thì đăng ký SAU thắng (ghi đè mặc định
   * của beforeEach trong từng test).
   */
  on(method: string, pattern: string, handler: MockHandler): this {
    const { regex, keys } = compile(pattern);
    const literals = literalCount(pattern);
    this.routes.push({ method: method.toUpperCase(), pattern, regex, keys, literals, handler });
    return this;
  }
  get(pattern: string, handler: MockHandler): this {
    return this.on('GET', pattern, handler);
  }
  post(pattern: string, handler: MockHandler): this {
    return this.on('POST', pattern, handler);
  }
  patch(pattern: string, handler: MockHandler): this {
    return this.on('PATCH', pattern, handler);
  }
  delete(pattern: string, handler: MockHandler): this {
    return this.on('DELETE', pattern, handler);
  }

  /**
   * Khai báo lời gọi mà trang CÓ gọi nhưng spec cố ý để 404 (không liên quan tới luồng đang test).
   * Dạng "GET /flash-sales/active" (path mẫu như on()). Chỉ để các lời gọi này không làm fail test.
   */
  allowUnmocked(...specs: string[]): this {
    for (const s of specs) this.allowed.add(s);
    return this;
  }

  /**
   * Các lời gọi đã mock khớp method + path mẫu (vd `callsTo('POST', '/orders/:code/cancel')`).
   * Lời gọi do route CỤ THỂ HƠN trả lời (vd `/orders/active-count` so với `/orders/:code`) không tính.
   */
  callsTo(method: string, pattern: string): MockCall[] {
    const { regex } = compile(pattern);
    const m = method.toUpperCase();
    const literals = literalCount(pattern);
    return this.calls.filter((c) => c.method === m && regex.test(c.path) && (this.servedLiterals.get(c) ?? 0) <= literals);
  }

  /**
   * Chờ lời gọi (đã mock) kế tiếp khớp method + path — gọi TRƯỚC thao tác kích hoạt nó.
   * Nếu đã có lời gọi khớp từ trước thì KHÔNG tính (chỉ lời gọi mới).
   */
  waitForCall(method: string, pattern: string, timeoutMs = 10_000): Promise<MockCall> {
    const { regex } = compile(pattern);
    const m = method.toUpperCase();
    const p = new Promise<MockCall>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Hết ${timeoutMs}ms mà chưa thấy ${m} ${pattern}. Đã gọi: ${this.describeCalls()}`)),
        timeoutMs,
      );
      this.timers.add(timer);
      this.waiters.push({
        method: m,
        regex,
        resolve: (c) => {
          clearTimeout(timer);
          this.timers.delete(timer);
          resolve(c);
        },
      });
    });
    // Test fail TRƯỚC khi kịp await (vd click lỗi) → không để reject muộn thành unhandled rejection.
    p.catch(() => undefined);
    return p;
  }

  /** Huỷ các waitForCall còn treo (fixture gọi khi test kết thúc). */
  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.waiters.length = 0;
  }

  /** Lời gọi chưa mock mà spec không khai báo allowUnmocked — fixture sẽ fail nếu khác rỗng. */
  unexpectedUnmocked(): string[] {
    const allowed = [...this.allowed].map((s) => {
      const [method = '', pattern = ''] = s.split(' ');
      return { method: method.toUpperCase(), regex: compile(pattern).regex };
    });
    return [...new Set(this.unmocked)].filter((u) => {
      const [method = '', path = ''] = u.split(' ');
      return !allowed.some((a) => a.method === method && a.regex.test(path));
    });
  }

  describeCalls(): string {
    return this.calls.map((c) => `${c.method} ${c.path}`).join(', ') || '(chưa có)';
  }

  /** Route khớp method + path: nhiều đoạn cố định nhất, hoà thì đăng ký sau cùng. */
  private pickRoute(method: string, path: string): { route: RouteDef; match: RegExpExecArray } | undefined {
    let best: { route: RouteDef; match: RegExpExecArray } | undefined;
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const match = r.regex.exec(path);
      if (match && (!best || r.literals >= best.route.literals)) best = { route: r, match };
    }
    return best;
  }

  async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const headers = request.headers();
    const cors = corsHeaders(headers);

    // Preflight CORS (miniapp :3113 gọi API :3001 kèm Authorization / Idempotency-Key).
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }

    const path = url.pathname.replace(/^\/api(?=\/)/, '');
    let body: unknown;
    const raw = request.postData();
    if (raw != null && raw !== '') {
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        body = raw;
      }
    }
    const call: MockCall = { method, path, query: url.searchParams, body, headers };

    const best = this.pickRoute(method, path);
    if (best) {
      const { route: r, match } = best;
      const params: Record<string, string> = {};
      r.keys.forEach((k, idx) => {
        params[k] = decodeURIComponent(match[idx + 1] ?? '');
      });
      let out: unknown;
      try {
        out = typeof r.handler === 'function' ? await (r.handler as HandlerFn)({ call, params, request }) : r.handler;
      } catch (err) {
        // Không throw trong route handler (thành unhandled rejection) — ghi lại để fixture fail rõ ràng.
        this.handlerErrors.push(`${method} ${r.pattern}: ${String(err)}`);
        await route.fulfill({
          status: 500,
          headers: { ...cors, 'content-type': 'application/json' },
          body: JSON.stringify({ message: `[E2E] mock ${method} ${r.pattern} lỗi: ${String(err)}` }),
        });
        return;
      }
      const res = isReply(out) ? out : { status: 200, json: out };
      this.calls.push(call);
      this.servedLiterals.set(call, r.literals);
      for (let w = this.waiters.length - 1; w >= 0; w--) {
        const waiter = this.waiters[w]!;
        if (waiter.method === method && waiter.regex.test(path)) {
          this.waiters.splice(w, 1);
          waiter.resolve(call);
        }
      }
      await route.fulfill({
        status: res.status,
        headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(res.json ?? null),
      });
      return;
    }

    this.unmocked.push(`${method} ${path}`);
    await route.fulfill({
      status: 404,
      headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ statusCode: 404, error: 'E2E_UNMOCKED', message: `[E2E] Chưa mock ${method} ${path}` }),
    });
  }
}

function corsHeaders(reqHeaders: Record<string, string>): Record<string, string> {
  const origin = reqHeaders['origin'];
  if (!origin) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    // Phải liệt kê rõ (wildcard "*" không phủ header Authorization).
    'access-control-allow-headers':
      reqHeaders['access-control-request-headers'] ?? 'authorization,content-type,idempotency-key',
    vary: 'Origin',
  };
}

/**
 * `test` dùng cho MỌI spec miniapp. Fixture `api` là auto: kể cả test không nhận `api`, bộ chặn
 * /api/** và host ngoài vẫn được cài trước khi trang mở.
 */
export const test = base.extend<{ api: MockApi }>({
  api: [
    async ({ page }, use, testInfo) => {
      const api = new MockApi();
      // Đăng ký TRƯỚC → ưu tiên THẤP NHẤT (Playwright chạy route đăng ký sau trước).
      await page.route(
        (url) => !LOCAL_HOSTS.has(url.hostname),
        (route) => route.abort('blockedbyclient'),
      );
      await page.route(
        (url) => url.pathname.startsWith('/api/'),
        (route) => api.handle(route),
      );
      await use(api);
      api.dispose();
      expect(api.handlerErrors, 'Hàm mock ném lỗi').toEqual([]);
      if (api.unmocked.length > 0) {
        await testInfo.attach('unmocked-api-calls.txt', {
          body: [...new Set(api.unmocked)].join('\n'),
          contentType: 'text/plain',
        });
      }
      expect(
        api.unexpectedUnmocked(),
        'Có lời gọi API chưa mock (đã chặn, trả 404) — mock đúng route NestJS hoặc khai báo api.allowUnmocked()',
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// ─────────────────────────── Dữ liệu mẫu dùng chung ───────────────────────────

export const E2E_TOKENS = { accessToken: 'e2e-access-token', refreshToken: 'e2e-refresh-token' } as const;

export function makeUser(over: Partial<AuthUser> & Pick<AuthUser, 'id'>): AuthUser {
  return {
    role: 'CUSTOMER',
    fullName: 'Khách E2E',
    phone: '0901234567',
    referralCode: 'E2EREF',
    pointsBalance: 0,
    walletBalance: 0,
    coinsBalance: 0,
    ...over,
  };
}

/**
 * Phiên đăng nhập giả: mọi đường restore() có thể đi (refresh token đã lưu, Zalo silent login,
 * guest fallback — xem apps/miniapp/src/store/auth.ts) đều ra CÙNG user, và GET /me trả
 * onboarded:true để OnboardingGate không che màn hình.
 */
export function mockSession(api: MockApi, user: AuthUser): AuthUser {
  const login: LoginResponse = { ...E2E_TOKENS, user };
  api.post('/auth/guest', login);
  api.post('/auth/zalo-mini-app', login);
  api.post('/auth/refresh', login);
  const me: MeProfile = {
    id: user.id,
    fullName: user.fullName ?? null,
    email: null,
    avatarUrl: null,
    dob: null,
    onboarded: true,
    segments: [],
  };
  api.get('/me', me);
  // Mặc định cho khối dùng chung toàn app (dự án 4a): badge tab Đơn hàng gọi ở MỌI trang gốc.
  // Spec cần số khác thì đăng ký lại SAU (đăng ký sau thắng) — và phải đăng ký SAU mọi mock
  // '/orders/:code' vì pattern đó cũng khớp '/orders/active-count'.
  api.get('/orders/active-count', { count: 0 });
  // Kệ "Mua lại" (Home + tab Đơn hàng) — mặc định khách chưa mua gì.
  api.get('/me/purchased-items', { items: [], nextCursor: null });
  return user;
}

const NOW_ISO = '2026-09-20T08:00:00.000Z';

/** OrderDTO đầy đủ field bắt buộc (packages/shared-types/src/order.ts) — ghi đè phần cần test. */
export function makeOrder(over: Partial<OrderDTO> & Pick<OrderDTO, 'code'>): OrderDTO {
  return {
    id: `id-${over.code}`,
    type: 'RETAIL',
    status: 'CONFIRMED',
    subtotal: 130000,
    discount: 0,
    shippingFee: 19000,
    total: 149000,
    pointsEarned: 14,
    pointsUsed: 0,
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    shippingAddress: {
      recipient: 'Nguyễn Văn A',
      phone: '0901234567',
      province: 'TP. Hồ Chí Minh',
      district: 'Quận 1',
      ward: 'Phường Bến Nghé',
      street: '123 Lê Lợi',
      provinceCode: '79',
      districtCode: '760',
      wardCode: '26734',
    },
    shippingPartner: null,
    shippingCode: null,
    shippingStatus: null,
    trackingLink: null,
    shippingHistory: [],
    hasRecyclingPickup: false,
    recyclingNote: null,
    gomdonOrderId: null,
    gomdonPartnerCode: null,
    gomdonStatus: null,
    gomdonCancelStatus: null,
    items: [
      {
        id: `item-${over.code}`,
        variationId: 'var-1',
        productName: 'Nước Rửa Chén Sinh Học Tubu 500ml',
        productSlug: 'nuoc-rua-chen-tubu',
        variationName: 'Hương Chanh Gừng',
        unitPrice: 65000,
        quantity: 2,
        backorderedQty: 0,
        total: 130000,
      },
    ],
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...over,
  };
}
