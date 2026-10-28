import type { CheckInResult } from '@tubutree/app-core/api/loyalty';
import { api } from './api';

export interface GameProfile {
  totalSeeds: number;
  streakDays: number;
  treeStage: number;
  treeHealth?: 'HEALTHY' | 'WILTED' | 'DEAD';
  streakFreezes: number;
  lastDewAt: string | null;
  lastCheckInAt: string | null;
  ecoImpact: { progress: number; target: number; treeType: string; treesPlanted: number } | null;
  /** §streak-repair: chuỗi vừa mất, còn trong cửa sổ hồi sinh (xem streakRepairable). */
  brokenStreakDays?: number;
  streakRepairCost?: number;
  streakRepairable?: boolean;
  /** Giá các món tiêu giọt nước/Điểm Xanh — BE là nguồn chân lý, FE chỉ hiển thị (không chép cứng). */
  streakFreezeCost?: number;
  /** Điểm Xanh cho 1 lượt góp quỹ trồng cây. */
  treePointsPrice?: number;
  tankCapacity?: number;
  /** Điểm Xanh cho 1 lượt quay (game.spin_buy_cost_points). */
  spinCostPoints?: number;
  /** 💧 mỗi lần điểm danh, hứng sương, thưởng ngày 7 của chuỗi, câu đố trả lời sai: hiện trước khi khách bấm. */
  dailyLoginSeeds?: number;
  dewSeeds?: number;
  streak7Seeds?: number;
  quizWrongSeeds?: number;
  /** Số câu đố đã làm hôm nay (giờ VN): phân biệt "đã làm xong" với "chưa có câu" khi danh sách câu rỗng. */
  quizAnsweredToday?: number;
  /** 💧 quà một lần của lần điểm danh đầu tiên; 0 khi đã điểm danh. */
  firstCheckinBonus?: number;
  /** 💧 cần để thu hoạch cây đang trồng, và cây kế tiếp sau khi thu hoạch (thang game.tree_target_ladder). */
  currentTreeTarget?: number;
  nextTreeTarget?: number;
  /** Cây đã đủ nước từ trước (hồ sơ cũ tưới vượt đích): thu hoạch bằng `waterTree(0)`. */
  harvestReady?: boolean;
  /** Nước thưởng đơn giao thành công: số giọt mỗi đơn, trần tuần (giờ VN) và phần đã nhận tuần này. null = tắt hoặc API cũ. */
  orderWater?: { perOrder: number; weeklyCap: number; weeklyGranted: number; claimedNow?: number } | null;
}
export type { CheckInResult };
export interface QuizItem {
  id: string;
  question: string;
  options: string[];
  category: string;
  difficulty: number;
  waterReward: number;
}
export interface AnswerResult {
  isCorrect: boolean;
  correct: number;
  waterEarned: number;
  explanation: string | null;
}
export interface DewResult {
  seedsEarned: number;
  totalSeeds: number;
}
export interface StreakFreezeResult {
  streakFreezes: number;
  totalSeeds: number;
}
export interface StreakRepairResult {
  repaired: boolean;
  streakDays: number;
  totalSeeds: number;
}
export interface SpinResult {
  prize: {
    id: string;
    name: string;
    rewardType: string;
    value: number;
    coupon?: { code: string; minOrder: number; expiresAt: string };
  };
}
export interface LeaderRow {
  rank: number;
  nickname: string;
  streak: number;
  treesPlanted: number;
}
export interface MissionItem {
  code: string;
  /** Loại nhiệm vụ để chọn nút "Làm ngay" cho nhiệm vụ quản trị thêm (mã của chúng không cố định). */
  kind?: 'CHECKIN_STREAK' | 'ORDER_COUNT' | 'REVIEW_COUNT' | 'INVITE_COUNT' | null;
  title: string;
  description?: string;
  rewardPoints: number;
  progress: number;
  goal: number;
  completed: boolean;
  /** A1-02: đã nhận thưởng cho chu kỳ hiện tại chưa (mission_progress). */
  claimed: boolean;
}
export interface ClaimMissionResult {
  claimed: boolean;
  rewardPoints: number;
  couponCode: string | null;
}

export const getGameProfile = () => api.get<GameProfile>('/game/profile').then((r) => r.data);
export const checkIn = () => api.post<CheckInResult>('/me/daily-check-in').then((r) => r.data);
export const collectDew = () => api.post<DewResult>('/game/dew/collect').then((r) => r.data);
export const buyStreakFreeze = () =>
  api.post<StreakFreezeResult>('/game/streak-freeze/buy').then((r) => r.data);
export const repairStreak = () =>
  api.post<StreakRepairResult>('/game/streak/repair').then((r) => r.data);
export const spin = () => api.post<SpinResult>('/game/spin').then((r) => r.data);
export const getTodayQuiz = () => api.get<QuizItem[]>('/game/quiz/today').then((r) => r.data);
export const answerQuiz = (id: string, choice: number) =>
  api.post<AnswerResult>(`/game/quiz/${id}/answer`, { choice }).then((r) => r.data);
export interface HarvestSpecies {
  name: string;
  emoji: string;
  rarity: 'COMMON' | 'RARE' | 'LEGENDARY';
  ecoFact: string | null;
}
/** 'OFF': admin tắt mã thu hoạch (trần ngày hoặc tháng bằng 0). */
export type HarvestCouponCap = 'DAY' | 'MONTH' | 'OFF';
export interface HarvestCouponTerms {
  code: string;
  /** Giá trị giảm (đ). */
  value: number;
  /** Đơn tối thiểu (đ) để dùng mã. */
  minOrder: number;
  /** Hạn dùng, ISO. */
  expiresAt: string;
}
export interface HarvestReward {
  coupon?: string;
  /** Mệnh giá, đơn tối thiểu và hạn của từng mã (API cũ không trả). */
  couponTerms?: HarvestCouponTerms[];
  certificate?: string;
  species?: HarvestSpecies;
  /** Điểm Xanh thưởng cây mầm (lần thu hoạch đầu tiên); lần đó không có mã và không ghi góp quỹ cây. */
  points?: number;
  /** Lần tưới có thu hoạch cây mầm. Cây có `certificate` là cây góp quỹ thật. */
  sprout?: boolean;
}
export const waterTree = (drops: number) =>
  api.post<{
    progress: number;
    target: number;
    harvested: boolean;
    treesPlanted: number;
    revivedFromDead?: boolean;
    /** Lần thu hoạch có cây nhưng không cấp mã vì chạm trần mã theo ngày hoặc theo tháng. */
    couponCapped?: HarvestCouponCap;
    reward?: HarvestReward;
  }>('/game/tree/water', { drops }).then((r) => r.data);
/**
 * Góp 1 cây vào quỹ trồng cây (PlantedTree) bằng Điểm Xanh: BE lấy điểm thường trước, thiếu thì lấy điểm không hết hạn.
 * Mỗi lượt góp là một lần trừ điểm thật, nên kèm Idempotency-Key: gửi lại cùng key (chạm đúp, thử lại sau lỗi mạng
 * khi server đã xử lý xong) nhận lại đúng kết quả cũ thay vì trừ điểm lần nữa.
 */
export const buyTree = (idempotencyKey: string) =>
  api
    .post<{ certificateCode: string; treeType: string; cost: number; pointsUsed: number; pointsUsedConverted: number }>(
      '/game/tree/buy',
      undefined,
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    .then((r) => r.data);
export const getLeaderboard = () => api.get<LeaderRow[]>('/game/leaderboard').then((r) => r.data);
export const getMissions = () => api.get<MissionItem[]>('/game/missions').then((r) => r.data);
/** A1-02: nhận thưởng nhiệm vụ đã đạt điều kiện (idempotent — server chặn nhận trùng). */
export const claimMission = (code: string) =>
  api.post<ClaimMissionResult>(`/game/missions/${code}/claim`).then((r) => r.data);

export interface PlantedTreeItem {
  certificateCode: string;
  treeType: string;
  status: 'PLEDGED' | 'PLANTED';
  region: string | null;
  pledgedAt: string;
  plantedAt: string | null;
}
export interface Forest {
  count: number;
  plantedCount: number;
  trees: PlantedTreeItem[];
}
export const getForest = () => api.get<Forest>('/game/forest').then((r) => r.data);

export interface CommunityState {
  goal: {
    id: string;
    title: string;
    region: string;
    targetDrops: number;
    currentDrops: number;
    treesToPlant: number;
    status: 'ACTIVE' | 'FULFILLING' | 'DONE';
  } | null;
  myDrops: number;
  pct: number;
}
export const getCommunity = () => api.get<CommunityState>('/game/community').then((r) => r.data);

export interface CodexEntry {
  id: string;
  name: string;
  rarity: 'COMMON' | 'RARE' | 'LEGENDARY';
  emoji: string;
  region: string | null;
  owned: boolean;
  count: number;
  story: string | null;
  ecoFact: string | null;
}
export const getCollection = () => api.get<CodexEntry[]>('/game/collection').then((r) => r.data);

export interface Season {
  id: string;
  name: string;
  theme: string | null;
  region: string | null;
  startAt: string;
  endAt: string;
  featuredSpecies: { id: string; name: string; emoji: string; rarity: 'COMMON' | 'RARE' | 'LEGENDARY' }[];
}
export interface SeasonLeaderRow {
  rank: number;
  nickname: string;
  drops: number;
}
export const getSeason = () => api.get<Season | null>('/game/season').then((r) => r.data || null);
export const getSeasonLeaderboard = () =>
  api.get<SeasonLeaderRow[]>('/game/season/leaderboard').then((r) => r.data);

export interface GardenPlot {
  id: string | null;
  slot: number;
  isHome: boolean;
  treeType: string;
  speciesId: string | null;
  progress: number;
  target: number;
  treeStage: number;
  treesPlanted: number;
  treeHealth: 'HEALTHY' | 'WILTED' | 'DEAD';
}
export interface Garden {
  plots: GardenPlot[];
  maxPlots: number;
  nextUnlock: { slot: number; seedCost: number } | null;
}
export const getGarden = () => api.get<Garden>('/game/garden').then((r) => r.data);
/** Mở lô đất bằng giọt nước — mở bằng xu cũ đã ngừng (đã gộp vào Điểm Xanh). */
export const unlockPlot = (slot?: number) =>
  api.post<GardenPlot>('/game/garden/unlock', { currency: 'SEEDS', ...(slot ? { slot } : {}) }).then((r) => r.data);
export const waterPlot = (plotId: string, drops: number) =>
  api
    .post<{
      progress: number;
      target: number;
      harvested: boolean;
      treesPlanted: number;
      revivedFromDead: boolean;
      couponCapped?: HarvestCouponCap;
      reward?: HarvestReward;
    }>(`/game/garden/plot/${plotId}/water`, { drops })
    .then((r) => r.data);

export interface SeasonPassReward {
  type: 'SEEDS' | 'POINTS';
  amount: number;
}
export interface SeasonPassTier {
  tier: number;
  xpRequired: number;
  free: SeasonPassReward;
  premium: SeasonPassReward;
  unlocked: boolean;
  claimedFree: boolean;
  claimedPremium: boolean;
}
export interface SeasonPassState {
  active: boolean;
  seasonTitle?: string;
  xp?: number;
  premiumEligible?: boolean;
  tiers?: SeasonPassTier[];
}
export const fetchSeasonPass = () =>
  api.get<SeasonPassState>('/game/season-pass').then((r) => r.data);
export const claimSeasonPass = (tier: number, track: 'free' | 'premium') =>
  api
    .post<{ claimed: boolean; reward: SeasonPassReward }>('/game/season-pass/claim', { tier, track })
    .then((r) => r.data);

export interface Friend {
  id: string;
  nickname: string;
  giftedToday: boolean;
}
export const getFriends = () => api.get<Friend[]>('/game/friends').then((r) => r.data);
export const giftWater = (recipientId: string) =>
  api.post<{ amount: number; recipientId: string }>(`/game/gift/${recipientId}`).then((r) => r.data);
