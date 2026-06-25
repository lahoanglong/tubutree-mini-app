import { api } from './api';

export interface BetaFeature {
  key: string;
  title: string;
  desc: string;
}

export interface BetaStatus {
  enrolled: boolean;
  joinedAt: string | null;
  features: BetaFeature[];
}

export const getBetaStatus = () => api.get<BetaStatus>('/beta/me').then((r) => r.data);
export const joinBeta = () => api.post<BetaStatus>('/beta/join').then((r) => r.data);
export const leaveBeta = () => api.post<{ enrolled: boolean }>('/beta/leave').then((r) => r.data);
export const sendBetaFeedback = (message: string) =>
  api.post<{ ok: boolean }>('/beta/feedback', { message }).then((r) => r.data);
