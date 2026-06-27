import { api } from './api';

export interface OwnedPromotion {
  id: string;
  title: string;
  subtitle: string | null;
  startAt: string;
  endAt: string;
  isActive: boolean;
}
export interface OwnedBrand {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  coverUrl: string | null;
  tagline: string | null;
  story: string | null;
  origin: string | null;
  isVerified: boolean;
  isPublished: boolean;
  followerCount: number;
  promotions: OwnedPromotion[];
}

export const getOwnedBrand = () => api.get('/brand/owner/me').then((r) => r.data as OwnedBrand);
export const updateOwnedBrand = (dto: Partial<Pick<OwnedBrand, 'logoUrl' | 'coverUrl' | 'tagline' | 'story' | 'origin'>>) =>
  api.patch('/brand/owner/me', dto).then((r) => r.data as OwnedBrand);
export const createOwnedPromotion = (dto: { title: string; subtitle?: string; startAt: string; endAt: string }) =>
  api.post('/brand/owner/me/promotions', dto).then((r) => r.data as OwnedPromotion);
export const updateOwnedPromotion = (id: string, dto: { title?: string; subtitle?: string; startAt?: string; endAt?: string; isActive?: boolean }) =>
  api.patch(`/brand/owner/me/promotions/${id}`, dto).then((r) => r.data);
export const deleteOwnedPromotion = (id: string) =>
  api.delete(`/brand/owner/me/promotions/${id}`).then((r) => r.data);
