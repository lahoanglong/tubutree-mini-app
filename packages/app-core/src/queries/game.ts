import type { HttpClient } from '../http';
import {
  fetchSeasonPass,
  getCollection,
  getCommunity,
  getFriends,
  getForest,
  getGameProfile,
  getGarden,
  getLeaderboard,
  getMissions,
  getSeason,
  getSeasonLeaderboard,
  getTodayQuiz,
} from '../api/game';

export const gameProfileQuery = (http: HttpClient) => ({
  queryKey: ['game', 'profile'] as const,
  queryFn: () => getGameProfile(http),
});
export const gameQuizQuery = (http: HttpClient) => ({
  queryKey: ['game', 'quiz'] as const,
  queryFn: () => getTodayQuiz(http),
});
export const gameBoardQuery = (http: HttpClient) => ({
  queryKey: ['game', 'board'] as const,
  queryFn: () => getLeaderboard(http),
});
export const gameMissionsQuery = (http: HttpClient) => ({
  queryKey: ['game', 'missions'] as const,
  queryFn: () => getMissions(http),
});
export const gameForestQuery = (http: HttpClient) => ({
  queryKey: ['game', 'forest'] as const,
  queryFn: () => getForest(http),
});
export const gameCommunityQuery = (http: HttpClient) => ({
  queryKey: ['game', 'community'] as const,
  queryFn: () => getCommunity(http),
});
export const gameCollectionQuery = (http: HttpClient) => ({
  queryKey: ['game', 'collection'] as const,
  queryFn: () => getCollection(http),
});
export const gameSeasonQuery = (http: HttpClient) => ({
  queryKey: ['game', 'season'] as const,
  queryFn: () => getSeason(http),
});
export const gameSeasonBoardQuery = (http: HttpClient) => ({
  queryKey: ['game', 'seasonBoard'] as const,
  queryFn: () => getSeasonLeaderboard(http),
});
export const gameFriendsQuery = (http: HttpClient) => ({
  queryKey: ['game', 'friends'] as const,
  queryFn: () => getFriends(http),
});
export const gameGardenQuery = (http: HttpClient) => ({
  queryKey: ['game', 'garden'] as const,
  queryFn: () => getGarden(http),
});
export const gameSeasonPassQuery = (http: HttpClient) => ({
  queryKey: ['game', 'seasonPass'] as const,
  queryFn: () => fetchSeasonPass(http),
});
