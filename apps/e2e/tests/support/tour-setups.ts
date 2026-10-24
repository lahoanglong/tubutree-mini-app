import type { RewardCatalogDTO, RewardItemDTO } from '@tubutree/shared-types';
import { CTV_DASHBOARD } from './affiliate-mocks';
import { mockAffiliateDashboard } from './affiliate-mocks';
import { BANK_QR } from './checkout-mocks';
import { publicConfig, type MockApi } from './mock-api';
import { wasteDetail, wastePoint, mockDeskStaff, mockWasteCustomer, WASTE_ITEMS } from './waste-mocks';
import { PERSONA, TOUR_PRODUCT_SLUG, seedCatalog, productCard, tourCart, tourOrder } from './tour-world';

const NOW = '2026-10-18T08:00:00.000Z';
const BANK_CODE = 'TUBU20261019003';

function catalogCards() {
  return seedCatalog().slice(0, 6).map(productCard);
}

const rewardBase = {
  description: 'Miễn phí vận chuyển cho 1 đơn từ 99.000đ.', label: 'Phổ biến', imageUrl: null, stockRemaining: null, soldOut: false,
  canRedeem: true, claimInstructions: null,
} as const;
const REWARDS: RewardItemDTO[] = [
  { ...rewardBase, id: 'reward-freeship', kind: 'VOUCHER', name: 'Miễn phí vận chuyển', pointsCost: 20_000, voucher: { type: 'FREESHIP', value: 0, minOrder: 99000, maxDiscount: null, validDays: 30 }, sortOrder: 10 },
  { ...rewardBase, id: 'reward-50k', kind: 'VOUCHER', name: 'Giảm 50.000đ', pointsCost: 50_000, canRedeem: false, voucher: { type: 'AMOUNT', value: 50000, minOrder: 300000, maxDiscount: null, validDays: 30 }, sortOrder: 20 },
  { ...rewardBase, id: 'gift-tree', kind: 'TREE', name: 'Góp quỹ trồng cây', pointsCost: 50_000, voucher: null, sortOrder: 50, canRedeem: false },
] as RewardItemDTO[];
const REDEMPTION = {
  id: 'gr-1', giftId: 'reward-freeship', giftKind: 'VOUCHER', giftName: 'Miễn phí vận chuyển', pointsCost: 20_000, status: 'FULFILLED', code: null,
  claimExpiresAt: null, claimPoint: null, fulfilledAt: NOW, cancelledAt: null, cancelReason: null, refundedPoints: null, couponCode: 'FS-AN123', createdAt: NOW,
};
function rewardCatalog(): RewardCatalogDTO {
  const points = PERSONA.pointsBalance + PERSONA.pointsConvertedBalance;
  return {
    pointsBalance: PERSONA.pointsBalance, pointsConvertedBalance: PERSONA.pointsConvertedBalance, lockedPoints: 0, redeemablePoints: points, giftClaimDays: 60,
    claimPoint: { name: 'Kho Tubu TP.HCM', addressLine: '1 Đường A', communeName: 'Phường B', provinceName: 'TP. Hồ Chí Minh', openingHours: {} },
    rewards: REWARDS,
  } as RewardCatalogDTO;
}

const POST = (id: string, author: string, over: Record<string, unknown> = {}) => ({
  id, kind: 'TIP', status: 'APPROVED', title: `Mẹo của ${author}`, body: `Nội dung ${id}`, images: [], meta: null, createdAt: NOW,
  author, avatar: null, badge: null, authorLevel: 1, category: null, productTags: [], tags: [], isPinned: false,
  likeCount: 3, commentCount: 1, liked: false, bestCommentId: null, isOwner: false, ...over,
});

function mockGame(api: MockApi) {
  api.get('/game/profile', {
    totalSeeds: 1250, streakDays: 3, treeStage: 1, treeHealth: 'HEALTHY', streakFreezes: 1, lastDewAt: null, lastCheckInAt: null,
    ecoImpact: { progress: 600, target: 1000, treeType: 'Cây Sưa', treesPlanted: 2 }, streakFreezeCost: 80, treePointsPrice: 20000, spinCostPoints: 10,
  });
  api.get('/game/quiz/today', [{ id: 'q1', question: 'Cây nào hấp thụ nhiều CO₂?', options: ['Sưa', 'Tre', 'Cỏ', 'Rêu'], category: 'cay', difficulty: 2, waterReward: 10 }]);
  api.get('/game/missions', [{ code: 'REVIEW_3', title: 'Đánh giá 3 sản phẩm', rewardPoints: 30, progress: 3, goal: 3, completed: true, claimed: false }]);
  api.get('/game/forest', { count: 0, plantedCount: 0, trees: [] });
  api.get('/game/season', null);
  api.get('/game/garden', {
    plots: [
      { id: null, slot: 1, isHome: true, treeType: 'Sưa', speciesId: null, progress: 600, target: 1000, treeStage: 1, treesPlanted: 2, treeHealth: 'HEALTHY' },
      { id: 'p2', slot: 2, isHome: false, treeType: 'Mận', speciesId: null, progress: 5, target: 20, treeStage: 1, treesPlanted: 0, treeHealth: 'HEALTHY' },
    ],
    maxPlots: 3, nextUnlock: { slot: 3, seedCost: 1200 },
  });
  api.get('/game/collection', [
    { id: 'c1', name: 'Sưa đỏ', rarity: 'LEGENDARY', emoji: '🌳', region: null, owned: true, count: 2, story: null, ecoFact: null },
    { id: 'c2', name: 'Lim xanh', rarity: 'RARE', emoji: '🌲', region: null, owned: false, count: 0, story: null, ecoFact: null },
  ]);
  api.get('/game/community', { goal: { id: 'g1', title: 'Rừng Tubu', region: 'Hà Giang', targetDrops: 5000000, currentDrops: 1250000, treesToPlant: 100, status: 'ACTIVE' }, myDrops: 89000, pct: 25 });
  api.get('/game/friends', [{ id: 'f1', nickname: 'Lan', giftedToday: false }, { id: 'f2', nickname: 'Minh', giftedToday: true }]);
  api.get('/game/leaderboard', [{ rank: 1, nickname: 'Nhất', streak: 30, treesPlanted: 9 }, { rank: 2, nickname: 'Nhì', streak: 20, treesPlanted: 7 }]);
  api.get('/game/season/leaderboard', [{ rank: 1, nickname: 'Bạn 1', drops: 2000 }]);
}

function mockFeed(api: MockApi) {
  api.get('/feed/categories', [{ id: 'c1', slug: 'bep', name: 'Nhà bếp', icon: null }, { id: 'c2', slug: 'vuon', name: 'Vườn nhà', icon: null }]);
  api.get('/feed', { posts: [POST('p1', 'Lan Anh', { kind: 'QUESTION', title: 'Rửa bình sữa thế nào?' }), POST('p2', 'Minh Tâm')], nextCursor: null });
  api.get('/feed/public-preview', { posts: [POST('p1', 'Lan Anh'), POST('p2', 'Minh Tâm')], nextCursor: null });
  api.get('/feed/p1', POST('p1', 'Lan Anh', { kind: 'QUESTION', title: 'Rửa bình sữa thế nào?', body: 'Mình cần mẹo rửa bình sữa cho bé', commentCount: 1 }));
  api.get('/feed/p1/comments', {
    items: [{ id: 'c1', body: 'Ngâm nước ấm trước rồi chà bằng bàn chải mềm', author: 'Hạnh', avatar: null, badge: null, authorLevel: 1, isAccepted: false, createdAt: NOW, isOwner: false }],
    nextCursor: null,
  });
  api.get('/feed/leaderboard', [
    { author: 'Lan Anh', avatar: null, reputation: 980, level: 4, levelName: 'Cổ thụ' },
    { author: 'Minh Tâm', avatar: null, reputation: 640, level: 3, levelName: 'Cây trưởng thành' },
    { author: 'Hà My', avatar: null, reputation: 410, level: 2, levelName: 'Cây non' },
  ]);
  const day = 24 * 3600 * 1000;
  api.get('/feed/events', [{ id: 'e1', title: 'Thử thách vườn xanh', description: 'Khoe góc vườn của bạn', coverUrl: null, startAt: new Date(Date.parse(NOW) - day).toISOString(), endAt: new Date(Date.parse(NOW) + 5 * day).toISOString(), rewardPoints: 5, status: 'ACTIVE', winnerUserId: null, createdAt: NOW }]);
  api.get('/feed/events/e1/posts', { posts: [POST('p1', 'Lan Anh')], nextCursor: null });
}

const GROUP = (id: string) => ({
  id, product: { name: seedCatalog()[0]!.name, slug: seedCatalog()[0]!.slug, thumbnail: null }, targetSize: 3, currentSize: 2, unitPrice: 245_650, basePrice: 289_000,
  discountPct: 15, status: 'OPEN', expiresAt: '2026-10-25T08:00:00.000Z', joined: false,
});

const SF = (over: Record<string, unknown> = {}) => ({
  id: 'sf1', slug: 'ctv-pilot', type: 'CTV', title: 'Cửa hàng Xanh của An', headerNote: 'Sản phẩm thiên nhiên chọn lọc', avatarUrl: null, coverUrl: null, theme: 'default', themeColor: null,
  subdomain: null, isPublished: true, referralCode: 'AN123', subdomainEnabled: false, publicHiddenReason: null, ownerTier: null,
  collections: [
    {
      id: 'c1', title: 'Bán chạy', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, sortOrder: 0,
      items: catalogCards().slice(0, 4).map((p, i) => ({ id: `it-${i}`, note: null, variationId: null, productId: p.id, product: { ...p, ratingAvg: 4.5, reviewCount: 8 } })),
    },
  ],
  ...over,
});

const OWNER_BRAND = {
  id: 'b1', slug: 'visante', name: 'Visante', logoUrl: null, coverUrl: null, tagline: 'Mỹ phẩm thiên nhiên', story: null, origin: 'Việt Nam',
  isVerified: true, isPublished: true, followerCount: 12,
  promotions: [{ id: 'p1', title: 'MUA 2 TẶNG 1', subtitle: null, couponCode: 'TUBU20', startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-30T00:00:00.000Z', isActive: true }],
};

const INBOX = {
  generatedAt: NOW,
  items: [
    { key: 'communityPending', count: 2 },
    { key: 'payouts', count: 1 },
    { key: 'wasteToCount', count: 3 },
    { key: 'invoicePending', count: 0 },
  ],
};

const DEALER_ME = { isDealer: true, status: 'APPROVED', tier: { id: 't1', name: 'Bạc', creditLimit: 50_000_000 }, currentDebt: 1_000_000 };

function wasteCustomer(api: MockApi) {
  const open = wasteDetail({ id: 'wr-1', code: 'TR-7K3QP', method: 'DROP_OFF', status: 'OPEN' });
  const done = wasteDetail({ id: 'wr-done-1', code: 'TR-9XLMA', method: 'DROP_OFF', status: 'COMPLETED', pointsAwarded: 3000, completedAt: NOW, editable: false, cancellable: false });
  mockWasteCustomer(api, {
    me: { balance: { pointsBalance: PERSONA.pointsBalance, pointsConvertedBalance: PERSONA.pointsConvertedBalance, redeemablePoints: PERSONA.pointsBalance + PERSONA.pointsConvertedBalance } },
    points: [wastePoint({ id: 'wp-q1' }), wastePoint({ id: 'wp-q2', name: 'Cửa hàng Xanh Quận 3', addressLine: '45 Võ Văn Tần', communeName: 'Phường Võ Thị Sáu' })], requests: [open, done] });
  api.get('/me/loyalty/rewards', rewardCatalog());
  api.get('/waste/rules', { text: 'Điểm Xanh là ưu đãi cho khách, không đổi ra tiền. Chỉ nhận vật phẩm sạch, khô; không nhận vật phẩm nguy hại.' });
}

/** Mock riêng của từng màn, theo route Mini App. Gọi SAU mockTourWorld nên đăng ký sau thắng. */
export const SETUPS: Record<string, (api: MockApi) => void> = {
  '/checkout': (api) => {
    api.post('/checkout/quote', { subtotal: tourCart().subtotal, discount: 0, comboDiscount: 0, pointsUsed: 0, pointsDiscount: 0, shippingFee: 0, total: tourCart().subtotal, pointsEarned: 11, pointsBalance: 1800 });
    api.get('/me/wallet', { walletBalance: 350_000, cashbackPending: 0, commissionApproved: 0, commissionPending: 0, withdrawMin: 100_000, withdrawFee: 3_000 });
  },
  '/bank-payment/:code': (api) => {
    api.get('/payments/bank-qr/:code', { ...BANK_QR, orderCode: BANK_CODE, memo: BANK_CODE, amount: 578_000 });
    api.get('/orders/:code', ({ params }) => ({ ...tourOrder(params.code!, 'SHIPPING'), status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', paymentMethod: 'BANK_TRANSFER' }));
  },
  '/wishlist': (api) => {
    api.get('/me/wishlist', catalogCards().slice(0, 3));
    api.get('/me/wishlist/ids', catalogCards().slice(0, 3).map((p) => p.id));
  },
  '/chat': (api) => {
    const at = (m: number) => `2026-10-18T07:${String(m).padStart(2, '0')}:00.000Z`;
    const msg = (id: string, sender: string, body: string, m: number) => ({ id, sender, body, imageUrl: null, context: null, clientMsgId: null, createdAt: at(m) });
    api.get('/me/support-chat', {
      code: 'K7Q3', blocked: false, enabled: true, slow: true, hasMore: false,
      messages: [
        msg('c1', 'CUSTOMER', 'Cho mình hỏi đơn này bao giờ giao ạ?', 10),
        msg('c2', 'SYSTEM', 'Tubu Tree trả lời từ 8:00 đến 21:00. Tin của bạn đã được ghi lại.', 10),
        msg('c3', 'STAFF', 'Dạ chào bạn, đơn của bạn đang trên đường giao, dự kiến chiều nay đến nơi ạ.', 14),
        msg('c4', 'CUSTOMER', 'Cảm ơn shop nhé', 15),
      ],
    });
    api.post('/me/support-chat/read', { ok: true });
    api.get('/me/support-chat/summary', { unreadCount: 0 });
    api.get('/config/public', publicConfig({ chat: { enabled: true, hours: { start: '08:00', end: '21:00' } }, support: { hotline: '0984 606 774', email: 'tubutree@gmail.com', zaloOaName: null } } as never));
  },
  '/group-buy': (api) => api.get('/group-buy', [GROUP('g1'), GROUP('g2')]),
  '/group-buy/:id': (api) => {
    api.get('/group-buy', [GROUP('g1')]);
    api.get('/group-buy/:id', ({ params }) => GROUP(params.id!));
  },
  '/brand/:slug': (api) => {
    api.get('/brand/public/:slug', {
      id: 'b1', slug: 'visante', name: 'Visante', logoUrl: null, coverUrl: null, tagline: 'Mỹ phẩm thiên nhiên từ rau má', story: 'Visante khởi nguồn từ vùng đất Tây Nguyên.', storyImages: [],
      origin: 'Việt Nam', isVerified: true, followerCount: 12, certifications: [{ code: 'VEGAN', label: 'Vegan', proofUrl: null }], promotions: OWNER_BRAND.promotions,
      products: catalogCards().filter((p) => p.brand === 'Visante').map((p) => ({ ...p, ratingAvg: 4.5, reviewCount: 8, sold: 12 })), dealerRewards: [],
    });
    api.get('/brand/:slug/follow-state', { following: false, followerCount: 12 });
    api.get('/brand/:slug/share-to-earn', { eligible: false });
  },
  '/about': (api) => {
    api.get('/faqs', [
      { id: 'f1', category: 'Vận chuyển', question: 'Bao lâu thì nhận hàng?', answer: '2-4 ngày làm việc tuỳ khu vực.' },
      { id: 'f2', category: 'Đổi trả', question: 'Đổi hàng thế nào?', answer: 'Trong 7 ngày kể từ khi nhận hàng.' },
    ]);
    api.get('/config/public', publicConfig({ aiAdvisorEnabled: true, support: { hotline: '0984 606 774', email: 'tubutree@gmail.com', zaloOaName: null } } as never));
  },
  '/subscriptions': (api) => {
    api.get('/me/subscriptions', [{
      id: 'sub-1', quantity: 1, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: '2026-11-15T12:00:00.000Z', addressId: 'addr-1', paymentMethod: 'COD',
      productName: seedCatalog()[0]!.name, variationName: seedCatalog()[0]!.variationName, thumbnail: null, slug: TOUR_PRODUCT_SLUG, unitPrice: seedCatalog()[0]!.basePrice, effectiveDiscountPct: 0.12,
    }]);
  },
  '/rewards': (api) => {
    api.get('/me/loyalty/rewards', rewardCatalog());
    api.get('/me/loyalty/rewards/mine', [REDEMPTION]);
  },
  '/rewards/mine': (api) => {
    api.get('/me/loyalty/rewards', rewardCatalog());
    api.get('/me/loyalty/rewards/mine', [REDEMPTION]);
  },
  '/cashback': (api) => {
    api.get('/cashback/merchants', [
      { id: 'm1', slug: 'shopee', name: 'Shopee', logoUrl: '', category: 'Sàn thương mại', baseRate: '3.5', terms: null },
      { id: 'm2', slug: 'lazada', name: 'Lazada', logoUrl: '', category: 'Sàn thương mại', baseRate: '2.8', terms: null },
    ]);
    api.get('/cashback/transactions', [{ id: 't1', merchantOrderId: 'SP-1001', orderAmount: 420_000, commission: 21_000, userReward: 14_700, status: 'CONFIRMED', confirmedAt: NOW, paidAt: null }]);
  },
  '/game': mockGame,
  '/ai-advisor': (api) => api.allowUnmocked('POST /ai-advisor/chat'),
  '/feed': mockFeed,
  '/feed/leaderboard': mockFeed,
  '/feed/events': mockFeed,
  '/feed/:id': mockFeed,
  '/academy': (api) => {
    api.get('/academy/courses', [
      { id: 'c1', title: 'Khoá bán hàng', description: 'Học cách chốt đơn', coverUrl: null, sortOrder: 1, isPublished: true, lessonCount: 2, completedCount: 1, isCompleted: false },
      { id: 'c2', title: 'Chăm sóc khách hàng', description: 'Giữ chân khách quen', coverUrl: null, sortOrder: 2, isPublished: true, lessonCount: 3, completedCount: 0, isCompleted: false },
    ]);
  },
  '/academy/:courseId': (api) => {
    api.get('/academy/courses/:id', {
      id: 'c1', title: 'Khoá bán hàng', description: 'Học cách chốt đơn', coverUrl: null, isPublished: true, completedLessonIds: ['l1'],
      lessons: [
        { id: 'l1', courseId: 'c1', title: 'Giới thiệu', contentType: 'VIDEO', videoUrl: 'https://video.test/1', body: null, sortOrder: 1 },
        { id: 'l2', courseId: 'c1', title: 'Kịch bản', contentType: 'ARTICLE', videoUrl: null, body: 'Bước 1: chào hỏi', sortOrder: 2 },
      ],
    });
  },
  '/s/:slug': (api) => {
    api.get('/storefront/public/:slug', SF());
  },
  '/affiliate': (api) => {
    mockAffiliateDashboard(api, { me: { referralCode: PERSONA.referralCode, walletBalance: 120_000 } });
    api.get('/affiliate/dashboard', { ...CTV_DASHBOARD });
  },
  '/storefront': (api) => {
    mockAffiliateDashboard(api, { me: { referralCode: PERSONA.referralCode, walletBalance: 120_000 } });
    api.get('/storefront/me', SF());
    api.get('/storefront/me/products', catalogCards().slice(0, 4).map((p) => ({ ...p, maxAffiliateRate: 12 })));
    api.get('/storefront/me/stats', { orders7d: 3, orders30d: 11, revenue30d: 2_450_000, commission30d: 294_000, byProduct: [] });
    api.get('/storefront/me/quests', { quests: [], totalEarnedPoints: 0, level: 1, levelMax: 5 });
  },
  '/dealer': (api) => {
    api.get('/dealer/me', DEALER_ME);
    api.get('/dealer/pricelist', seedCatalog().slice(0, 5).map((p) => ({
      variationId: `var-${p.id}`, sku: `SKU-${p.id}`, product: p.name, brand: p.brand, variation: p.variationName, retailPrice: p.basePrice, dealerPrice: Math.round(p.basePrice * 0.8), discountPct: 20, stock: 40,
    })));
    api.get('/dealer/templates', []);
    api.get('/dealer/orders', []);
    api.get('/dealer/rewards', []);
    api.get('/dealer/credit-ledger', []);
    api.get('/dealer/quarterly-report', null);
  },
  '/staff': (api) => {
    api.get('/staff/attendance/status', { shifts: [], openSession: null });
    api.get('/staff/shift-templates', [{ id: 't1', name: 'Ca sáng', startMin: 480, endMin: 720, active: true, sortOrder: 1 }, { id: 't2', name: 'Ca chiều', startMin: 780, endMin: 1020, active: true, sortOrder: 2 }]);
    api.get('/staff/shifts', []);
  },
  '/my-payroll': (api) => {
    const profile = { hourlyRate: 30000, bankBin: '970407', bankAccountNo: '0123456789', bankAccountName: 'NGUYEN VAN AN', qrImageUrl: null, active: true };
    api.get('/staff/payroll', { month: { year: 2026, month: 10, totalMinutes: 540, gross: 270000, totalFines: 0, net: 270000, status: 'FINALIZED', paidAt: null, proofImageUrl: null, note: null }, days: [], profile });
    api.get('/staff/attendance/history', []);
  },
  '/brand-owner': (api) => {
    api.get('/brand/owner/me', OWNER_BRAND);
  },
  '/admin': (api) => {
    api.get('/admin/ops/inbox', INBOX);
    api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
    api.get('/admin/staff', { members: [], pendingInvites: [] });
  },
  '/admin/community': (api) => {
    api.get('/admin/ops/inbox', INBOX);
    api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
    api.get('/admin/staff', { members: [], pendingInvites: [] });
    api.get('/feed/admin/pending', [
      { id: 'p7', kind: 'TIP', title: 'Mẹo tẩy vết ố', body: 'Ngâm baking soda 15 phút rồi chà nhẹ.', images: [], author: 'Lan Anh', category: 'Nhà bếp', createdAt: NOW },
      { id: 'p8', kind: 'QUESTION', title: 'Nên dùng loại nào cho bé?', body: 'Mình cần gợi ý nước rửa bình sữa.', images: [], author: 'Minh Tâm', category: null, createdAt: NOW },
    ]);
    api.get('/feed/admin/reports', []);
  },
  '/recycle': wasteCustomer,
  '/recycle/rules': wasteCustomer,
  '/recycle/new': wasteCustomer,
  '/recycle/points': wasteCustomer,
  '/recycle/r/:id': wasteCustomer,
  '/recycle/r/:id/edit': (api) => {
    wasteCustomer(api);
    // Trang sửa tự rời về chi tiết nếu dữ liệu yêu cầu về trước cấu hình công khai (cờ waste.enabled); chờ để cấu hình về trước.
    api.get('/waste/requests/:id', async ({ params }) => {
      await new Promise((r) => setTimeout(r, 800));
      return wasteDetail({ id: params.id!, code: 'TR-7K3QP', method: 'DROP_OFF', status: 'OPEN' });
    });
  },
  '/recycle/requests': wasteCustomer,
  '/recycle/done/:id': wasteCustomer,
  '/recycle/desk': (api) => {
    mockDeskStaff(api, {
      points: [{ id: 'wp-q1', kind: 'PARTNER', name: 'Tạp hoá Cô Ba', giftHandoverEnabled: false, myRole: 'OWNER', quota: { limit: 100_000, used: 0, remaining: 100_000 }, perkText: null, perkPendingText: null, staffDailyCapRemaining: 1_000_000 }],
      lookup: { type: 'REQUEST', request: { id: 'wr-desk-1', code: 'TR-7K3QP', method: 'DROP_OFF', status: 'OPEN', pointId: 'wp-q1', customerName: 'K*** An', customerPhone: '090****678', estimatedPoints: 3000, lines: [{ itemId: WASTE_ITEMS[0]!.id, itemName: WASTE_ITEMS[0]!.name, unitLabel: 'thùng', unitsPerPoint: 1, pointsPerGroup: 1000, declaredQty: 3, receivedQty: null, hazardous: false }] } },
    });
  },
};
