/**
 * Chế độ "đã đăng nhập" của lab-vitals.mjs: dựng một khách có phiên mà không cần tài khoản hay token thật.
 *
 * - Máy có cờ `tubu_web_session` (localStorage) và cookie cùng tên, như khách vừa đăng nhập trên web: middleware phục vụ bản thường của
 *   /gio-hang và /vuon-xanh (không phải bản dựng sẵn cho khách) và trang khôi phục phiên bằng POST /auth/refresh.
 * - POST /auth/refresh và các GET cần phiên trả dữ liệu giả sau `mockMs` ms: route.fulfill đi tắt qua phần bóp mạng của DevTools, nên độ trễ
 *   của một vòng mạng Fast 4G (RTT ~165 ms) cộng thời gian máy chủ được thêm bằng tay. Preflight CORS tới API chờ một RTT.
 * - GET công khai vẫn lấy hộ từ API thật, bỏ header Authorization giả. Đường cần phiên chưa có dữ liệu giả thì API thật trả 401; tên đường
 *   được in cuối lần đo để bổ sung.
 *
 * Giỏ có ba dòng lấy ảnh và tên của ba sản phẩm thật đầu danh mục, để phần tử LCP là ảnh thật tải qua mạng bị bóp như khách thật.
 */
const RTT_MS = 165;

const USER = {
  id: 'lab-u1', fullName: 'Khách Đo', referralCode: 'LAB1', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 1681, pointsConvertedBalance: 0, walletBalance: 0, avatarUrl: null,
};

const PROFILE = {
  totalSeeds: 1250, streakDays: 3, treeStage: 1, treeHealth: 'HEALTHY', streakFreezes: 1, lastDewAt: null, lastCheckInAt: null,
  ecoImpact: { progress: 600, target: 1000, treeType: 'Cây Sưa', treesPlanted: 2 }, streakFreezeCost: 80, treePointsPrice: 20000, spinCostPoints: 10,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cartLines(api) {
  const res = await fetch(`${api}/products?limit=3&page=1`).then((r) => r.json());
  const products = (res?.data ?? []).slice(0, 3);
  if (products.length === 0) throw new Error('Không lấy được sản phẩm thật nào để dựng giỏ giả (GET /products).');
  return products.map((p, i) => {
    const unitPrice = p.salePrice ?? p.basePrice ?? 65000;
    return {
      id: `lab-line-${i + 1}`, variationId: `lab-var-${i + 1}`, slug: p.slug, productName: p.name, variationName: null,
      thumbnail: p.thumbnail ?? null, unitPrice, listUnitPrice: p.basePrice ?? unitPrice, quantity: 1, stock: 50, weight: 500, total: unitPrice,
    };
  });
}

export async function createSignedIn({ api, mockMs }) {
  const items = await cartLines(api);
  const subtotal = items.reduce((s, l) => s + l.total, 0);
  const cart = { items, couponCode: null, subtotal, discount: 0, comboDiscount: 0, freeship: subtotal >= 500000, freeshipThreshold: 500000, itemCount: items.length };
  const fixtures = {
    '/cart': cart,
    '/me': USER,
    '/game/profile': PROFILE,
    '/game/quiz/today': [{ id: 'q1', question: 'Cây nào hấp thụ nhiều CO₂?', options: ['Sưa', 'Tre', 'Cỏ', 'Rêu'], category: 'cay', difficulty: 2, waterReward: 10 }],
    '/game/missions': [{ code: 'REVIEW_3', title: 'Đánh giá 3 sản phẩm', rewardPoints: 30, progress: 1, goal: 3, completed: false, claimed: false }],
    '/me/daily-check-in': { checkedInToday: false, pointsDone: false, waterDone: false, streakDays: 3, currentCycleDay: 3, todayPoints: 10, todayWater: 10, rewards: [] },
    '/me/loyalty': { pointsBalance: 1681, redeemablePoints: 1681, redeemableTotal: 1681, tier: null, nextTier: null, tiers: [] },
    '/me/coupons': [],
    '/me/summary': { orders: { pending_payment: 0, processing: 1, shipping: 0, delivered: 5, closed: 0, active: 1 }, unreadNotifications: 2, activeSubscriptions: 0 },
    '/game/daily': { enabled: false, dayKey: null, missions: [], water: 0, bonusPoints: 0, bonusClaimed: false, pointsBlocked: false, waterLeft: 0, pointsLeft: 0, quizPending: false },
    '/game/arcade/status': { games: {}, window: null, windowBonus: false, nextWindowAt: null, quizClaimed: false },
  };
  const missing = new Set();
  let t0 = Date.now();
  let timeline = [];
  const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

  return {
    async prepare(context, base) {
      await context.addCookies([{ name: 'tubu_web_session', value: '1', url: base }]);
      await context.addInitScript(() => {
        try {
          localStorage.setItem('tubu_web_session', '1');
        } catch {}
      });
    },
    /** Phản hồi giả cho request tới API, hoặc null để lab-vitals lấy hộ từ API thật. */
    async handle(req, url) {
      const path = url.pathname.replace(/^\/api/, '');
      timeline.push(`${req.method()} ${path} +${Date.now() - t0}`);
      if (req.method() === 'OPTIONS') {
        await sleep(RTT_MS);
        return { status: 204, headers: {} };
      }
      if (req.method() === 'POST' && path === '/auth/refresh') {
        await sleep(mockMs);
        return json({ accessToken: 'lab-access-token', refreshToken: '', user: USER });
      }
      // Sổ game tắt như PROD (cờ game.album_enabled): 404, trang giữ bố cục cũ.
      if (req.method() === 'GET' && path === '/game/album') {
        await sleep(mockMs);
        return json({ statusCode: 404, code: 'GAME_DISABLED', message: 'Not Found' }, 404);
      }
      if (req.method() === 'GET' && path in fixtures) {
        await sleep(mockMs);
        return json(fixtures[path]);
      }
      return null;
    },
    /**
     * GET công khai lấy hộ từ API thật trả lời như với khách. Route dùng OptionalJwtAuthGuard (game mini) trả `NOT_LOGGED_IN` thì trang tưởng
     * token hết hạn và refresh thêm một lượt, điều người đăng nhập thật không gặp: sửa thành câu trả lời của thành viên. null = giữ nguyên.
     */
    async patchPublic(url, res) {
      if (url.pathname.replace(/^\/api/, '') !== '/game/mini/today' || res.status() !== 200) return null;
      try {
        const body = JSON.parse((await res.body()).toString('utf8'));
        if (body?.noRewardReason !== 'NOT_LOGGED_IN') return null;
        return JSON.stringify({ ...body, rewardEligible: true, noRewardReason: null });
      } catch {
        return null;
      }
    },
    publicHeaders(headers) {
      const { authorization: _a, ...rest } = headers;
      return rest;
    },
    missing(path) {
      missing.add(path.replace(/^\/api/, ''));
    },
    /** Gọi ngay trước page.goto: mốc của dòng thời gian request (ms kể từ lúc điều hướng). */
    mark() {
      t0 = Date.now();
      timeline = [];
    },
    /** Request tới API của lần đo vừa xong, theo thứ tự bắt đầu, kèm ms kể từ lúc điều hướng. */
    timeline() {
      return timeline.join(', ');
    },
    report() {
      return missing.size ? `401 chưa có dữ liệu giả: ${[...missing].join(', ')}` : 'mọi request cần phiên đều có dữ liệu giả';
    },
  };
}
