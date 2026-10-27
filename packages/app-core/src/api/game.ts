import type { HttpClient } from '../http';
import type { CheckInResult } from './loyalty';

export interface GameProfile {
  totalSeeds: number;
  streakDays: number;
  treeStage: number;
  treeHealth?: 'HEALTHY' | 'WILTED' | 'DEAD';
  streakFreezes: number;
  lastDewAt: string | null;
  lastCheckInAt: string | null;
  /** Target đã chuẩn hoá như lúc tưới: hồ sơ cũ chưa tưới giọt nào hiện bậc đầu của thang, không phải 600. */
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
  /** 💧 quà một lần của lần điểm danh đầu tiên; 0 khi đã điểm danh. */
  firstCheckinBonus?: number;
  /** 💧 cần để thu hoạch cây đang trồng, và cây kế tiếp sau khi thu hoạch (thang game.tree_target_ladder). */
  currentTreeTarget?: number;
  nextTreeTarget?: number;
  /** Cây đã đủ nước từ trước (hồ sơ cũ tưới vượt đích): thu hoạch bằng `waterTree(0)`, không cần thêm giọt nào. */
  harvestReady?: boolean;
  /** Nước thưởng đơn giao thành công: số giọt mỗi đơn, trần tuần (giờ VN, thứ Hai đến Chủ nhật) và phần đã nhận tuần này. null/thiếu = API cũ. */
  orderWater?: { perOrder: number; weeklyCap: number; weeklyGranted: number } | null;
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

export const getGameProfile = (http: HttpClient) => http.get<GameProfile>('/game/profile');
/** Một nút cho cả Điểm Xanh và giọt nước: cùng POST /me/daily-check-in với trang Điểm Xanh. */
export const checkIn = (http: HttpClient) => http.post<CheckInResult>('/me/daily-check-in');
export const collectDew = (http: HttpClient) => http.post<DewResult>('/game/dew/collect');
export const buyStreakFreeze = (http: HttpClient) =>
  http.post<StreakFreezeResult>('/game/streak-freeze/buy');
export const repairStreak = (http: HttpClient) =>
  http.post<StreakRepairResult>('/game/streak/repair');
export const spin = (http: HttpClient) => http.post<SpinResult>('/game/spin');
export const getTodayQuiz = (http: HttpClient) => http.get<QuizItem[]>('/game/quiz/today');
export const answerQuiz = (http: HttpClient, id: string, choice: number) =>
  http.post<AnswerResult>(`/game/quiz/${id}/answer`, { choice });
export interface HarvestSpecies {
  name: string;
  emoji: string;
  rarity: 'COMMON' | 'RARE' | 'LEGENDARY';
  ecoFact: string | null;
}
/** 'OFF': admin tắt mã thu hoạch (trần ngày hoặc tháng bằng 0), không phải "hôm nay/tháng này đã đủ". */
export type HarvestCouponCap = 'DAY' | 'MONTH' | 'OFF';
/** Lý do không phát thưởng thu hoạch: 'GUEST' = chưa đăng nhập Zalo/SĐT nên không nhận mã và điểm cây mầm. */
export type HarvestRewardBlocked = 'GUEST';
export interface HarvestReward {
  coupon?: string;
  /** Mọi mã cấp trong lần tưới (một lần tưới có thể thu hoạch nhiều cây); `coupon` là mã đầu tiên. */
  coupons?: string[];
  certificate?: string;
  species?: HarvestSpecies;
  /** Điểm Xanh thưởng cây mầm (lần thu hoạch đầu tiên); lần đó không có mã và không ghi góp quỹ cây. */
  points?: number;
  /** Lần tưới có thu hoạch cây mầm (cây đầu tiên, nhận điểm thay mã, không góp quỹ cây). Cây có `certificate` là cây góp quỹ thật. */
  sprout?: boolean;
}
export interface ShareHarvestResult {
  shared: true;
  alreadyShared: boolean;
}
/** Khách tự chia sẻ thành tích thu hoạch lên Cộng đồng (chỉ web); nội dung do máy chủ dựng. */
export const shareHarvest = (http: HttpClient) => http.post<ShareHarvestResult>('/game/harvest/share');
export const waterTree = (http: HttpClient, drops: number) =>
  http.post<{
    progress: number;
    target: number;
    harvested: boolean;
    treesPlanted: number;
    revivedFromDead?: boolean;
    /** Lần thu hoạch có cây nhưng không cấp mã vì chạm trần mã theo ngày hoặc theo tháng, hoặc mã đang tắt. */
    couponCapped?: HarvestCouponCap;
    rewardBlocked?: HarvestRewardBlocked;
    reward?: HarvestReward;
  }>('/game/tree/water', { drops });
/**
 * Góp 1 cây vào quỹ trồng cây (PlantedTree) bằng Điểm Xanh: BE lấy điểm có hạn trước, thiếu thì lấy điểm không hết hạn.
 * Mỗi lượt góp là một lần trừ điểm thật, nên kèm Idempotency-Key: gửi lại cùng key (chạm đúp, thử lại sau lỗi mạng
 * khi server đã xử lý xong) nhận lại đúng kết quả cũ thay vì trừ điểm lần nữa.
 */
export const buyTree = (http: HttpClient, idempotencyKey: string) =>
  http.post<{
    certificateCode: string;
    treeType: string;
    cost: number;
    pointsUsed: number;
    pointsUsedConverted: number;
  }>('/game/tree/buy', undefined, { headers: { 'Idempotency-Key': idempotencyKey } });
export const getLeaderboard = (http: HttpClient) => http.get<LeaderRow[]>('/game/leaderboard');
export const getMissions = (http: HttpClient) => http.get<MissionItem[]>('/game/missions');
/** A1-02: nhận thưởng nhiệm vụ đã đạt điều kiện (idempotent — server chặn nhận trùng). */
export const claimMission = (http: HttpClient, code: string) =>
  http.post<ClaimMissionResult>(`/game/missions/${code}/claim`);

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
export const getForest = (http: HttpClient) => http.get<Forest>('/game/forest');

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
export const getCommunity = (http: HttpClient) => http.get<CommunityState>('/game/community');

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
export const getCollection = (http: HttpClient) => http.get<CodexEntry[]>('/game/collection');

export interface Season {
  id: string;
  name: string;
  theme: string | null;
  region: string | null;
  startAt: string;
  endAt: string;
  featuredSpecies: {
    id: string;
    name: string;
    emoji: string;
    rarity: 'COMMON' | 'RARE' | 'LEGENDARY';
  }[];
}
export interface SeasonLeaderRow {
  rank: number;
  nickname: string;
  drops: number;
}
export const getSeason = (http: HttpClient) => http.get<Season | null>('/game/season');
export const getSeasonLeaderboard = (http: HttpClient) =>
  http.get<SeasonLeaderRow[]>('/game/season/leaderboard');

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
export const getGarden = (http: HttpClient) => http.get<Garden>('/game/garden');
/** Mở lô đất bằng giọt nước — mở bằng xu cũ đã ngừng (đã gộp vào Điểm Xanh). */
export const unlockPlot = (http: HttpClient, slot?: number) =>
  http.post<GardenPlot>('/game/garden/unlock', { currency: 'SEEDS', ...(slot ? { slot } : {}) });
export const waterPlot = (http: HttpClient, plotId: string, drops: number) =>
  http.post<{
    progress: number;
    target: number;
    harvested: boolean;
    treesPlanted: number;
    revivedFromDead: boolean;
    couponCapped?: HarvestCouponCap;
    rewardBlocked?: HarvestRewardBlocked;
    reward?: HarvestReward;
  }>(`/game/garden/plot/${plotId}/water`, { drops });

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
export const fetchSeasonPass = (http: HttpClient) => http.get<SeasonPassState>('/game/season-pass');
export const claimSeasonPass = (http: HttpClient, tier: number, track: 'free' | 'premium') =>
  http.post<{ claimed: boolean; reward: SeasonPassReward }>('/game/season-pass/claim', {
    tier,
    track,
  });

export interface Friend {
  id: string;
  nickname: string;
  giftedToday: boolean;
}
export const getFriends = (http: HttpClient) => http.get<Friend[]>('/game/friends');
export const giftWater = (http: HttpClient, recipientId: string) =>
  http.post<{ amount: number; recipientId: string }>(`/game/gift/${recipientId}`);
