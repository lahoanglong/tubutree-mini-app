import { api } from './api';

export interface GameProfile {
  totalSeeds: number;
  streakDays: number;
  treeStage: number;
  treeHealth?: 'HEALTHY' | 'WILTED' | 'DEAD';
  streakFreezes: number;
  lastDewAt: string | null;
  ecoImpact: { progress: number; target: number; treeType: string; treesPlanted: number } | null;
}
export interface CheckInResult {
  seedsEarned: number;
  pointsEarned: number;
  streakDays: number;
  totalSeeds: number;
  streakFrozeUsed: boolean;
  bonusNote: string;
}
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
export interface SpinResult {
  prize: { id: string; name: string; rewardType: string; value: number };
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
}

export const getGameProfile = () => api.get<GameProfile>('/game/profile').then((r) => r.data);
export const checkIn = () => api.post<CheckInResult>('/game/check-in').then((r) => r.data);
export const collectDew = () => api.post<DewResult>('/game/dew/collect').then((r) => r.data);
export const buyStreakFreeze = () =>
  api.post<StreakFreezeResult>('/game/streak-freeze/buy').then((r) => r.data);
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
export const waterTree = (drops: number) =>
  api.post<{
    progress: number;
    target: number;
    harvested: boolean;
    treesPlanted: number;
    reward?: { coupon?: string; certificate?: string; species?: HarvestSpecies };
  }>('/game/tree/water', { drops }).then((r) => r.data);
export const getLeaderboard = () => api.get<LeaderRow[]>('/game/leaderboard').then((r) => r.data);
export const getMissions = () => api.get<MissionItem[]>('/game/missions').then((r) => r.data);

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
export const getSeason = () => api.get<Season | null>('/game/season').then((r) => r.data);
export const getSeasonLeaderboard = () =>
  api.get<SeasonLeaderRow[]>('/game/season/leaderboard').then((r) => r.data);
