import { api } from './api';

export interface GameProfile {
  totalSeeds: number;
  streakDays: number;
  treeStage: number;
  treeHealth?: 'HEALTHY' | 'WILTED' | 'DEAD';
  ecoImpact: { progress: number; target: number; treeType: string; treesPlanted: number } | null;
}
export interface CheckInResult {
  seedsEarned: number;
  pointsEarned: number;
  streakDays: number;
  totalSeeds: number;
  bonusNote: string;
}
export interface QuizItem {
  id: string;
  question: string;
  options: string[];
  rewardPts: number;
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
export const spin = () => api.post<SpinResult>('/game/spin').then((r) => r.data);
export const getTodayQuiz = () => api.get<QuizItem[]>('/game/quiz/today').then((r) => r.data);
export const answerQuiz = (id: string, choice: number) =>
  api.post<{ isCorrect: boolean; correct: number; pointsEarned: number }>(
    `/game/quiz/${id}/answer`,
    { choice },
  ).then((r) => r.data);
export const waterTree = (drops: number) =>
  api.post<{
    progress: number;
    target: number;
    harvested: boolean;
    treesPlanted: number;
    reward?: { coupon?: string; certificate?: string };
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
