import type { QueryClient } from '@tanstack/react-query';
import type {
  GiftRedemptionDTO,
  WasteConfirmRequest,
  WasteConfirmResultDTO,
  WasteCreateRequest,
  WasteDeskGiftFulfilRequest,
  WasteDeskLookupDTO,
  WasteDeskPointDTO,
  WasteEditRequest,
  WasteItemDTO,
  WasteMeDTO,
  WasteNearbyRequest,
  WastePerkSubmitRequest,
  WastePointDTO,
  WastePointMonthlyReportDTO,
  WastePreviewDTO,
  WastePreviewRequest,
  WasteRejectRequest,
  WasteRejectResultDTO,
  WasteRequestDetailDTO,
  WasteRequestSummaryDTO,
  WasteRulesDTO,
  WasteTrackingRequest,
} from '@tubutree/shared-types';
import { api } from './api';

const enc = encodeURIComponent;

export const WASTE_QUERY_KEYS = {
  all: ['waste'],
  me: ['waste', 'me'],
  items: ['waste', 'items'],
  points: (province: string | null) => ['waste', 'points', province] as const,
  requests: ['waste', 'requests'],
  request: (id: string) => ['waste', 'request', id] as const,
  desk: ['waste', 'desk'],
  rewards: ['loyalty-rewards'],
  rewardsMine: ['loyalty-rewards', 'mine'],
} as const;

export const getWasteMe = () => api.get<WasteMeDTO>('/waste/me').then((r) => r.data);
export const getWasteCatalogue = () => api.get<WasteItemDTO[]>('/waste/catalogue').then((r) => r.data);
export const getWasteItems = () => api.get<WasteItemDTO[]>('/waste/items').then((r) => r.data);
export const getWastePoints = (provinceCode?: string) =>
  api.get<WastePointDTO[]>('/waste/points', { params: provinceCode ? { provinceCode } : {} }).then((r) => r.data);
export const getNearbyWastePoints = (body: WasteNearbyRequest) =>
  api.post<WastePointDTO[]>('/waste/points/nearby', body).then((r) => r.data);
export const previewWaste = (body: WastePreviewRequest) =>
  api.post<WastePreviewDTO>('/waste/preview', body).then((r) => r.data);
export const createWasteRequest = (body: WasteCreateRequest, idempotencyKey: string) =>
  api
    .post<WasteRequestDetailDTO>('/waste/requests', body, { headers: { 'Idempotency-Key': idempotencyKey } })
    .then((r) => r.data);
export const editWasteRequest = (id: string, body: WasteEditRequest) =>
  api.patch<WasteRequestDetailDTO>(`/waste/requests/${enc(id)}`, body).then((r) => r.data);
export const setWasteTracking = (id: string, body: WasteTrackingRequest) =>
  api.put<WasteRequestDetailDTO>(`/waste/requests/${enc(id)}/tracking`, body).then((r) => r.data);
export const cancelWasteRequest = (id: string) =>
  api.post<WasteRequestDetailDTO>(`/waste/requests/${enc(id)}/cancel`).then((r) => r.data);
export const listWasteRequests = () => api.get<WasteRequestSummaryDTO[]>('/waste/requests').then((r) => r.data);
export const getWasteRequest = (id: string) =>
  api.get<WasteRequestDetailDTO>(`/waste/requests/${enc(id)}`).then((r) => r.data);
export const getWasteRequestByOrder = (orderId: string) =>
  api.get<WasteRequestDetailDTO>(`/waste/requests/by-order/${enc(orderId)}`).then((r) => r.data);
export const getWasteRules = () => api.get<WasteRulesDTO>('/waste/rules').then((r) => r.data);
export const getDeskPoints = () => api.get<WasteDeskPointDTO[]>('/waste/desk/points').then((r) => r.data);
export const deskLookup = (code: string) =>
  api.post<WasteDeskLookupDTO>('/waste/desk/lookup', { code: code.trim() }).then((r) => r.data);
export const deskConfirm = (id: string, body: WasteConfirmRequest) =>
  api.post<WasteConfirmResultDTO>(`/waste/desk/requests/${enc(id)}/confirm`, body).then((r) => r.data);
export const deskReject = (id: string, body: WasteRejectRequest) =>
  api.post<WasteRejectResultDTO>(`/waste/desk/requests/${enc(id)}/reject`, body).then((r) => r.data);
export const deskFulfilGift = (body: WasteDeskGiftFulfilRequest) =>
  api.post<GiftRedemptionDTO>('/waste/desk/gifts/fulfil', body).then((r) => r.data);
export const getDeskPointReport = (pointId: string, month: string) =>
  api
    .get<WastePointMonthlyReportDTO>(`/waste/desk/points/${enc(pointId)}/report`, { params: { month } })
    .then((r) => r.data);
export const submitDeskPerk = (pointId: string, body: WastePerkSubmitRequest) =>
  api.put<WasteDeskPointDTO>(`/waste/desk/points/${enc(pointId)}/perk`, body).then((r) => r.data);

const WRITE_KEYS = [['waste'], ['loyalty'], ['points-txn'], ['game']] as const;

export async function invalidateAfterWasteWrite(qc: QueryClient): Promise<void> {
  await Promise.all(WRITE_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
}

export async function invalidateAfterRedeem(qc: QueryClient): Promise<void> {
  await Promise.all(
    [...WRITE_KEYS, ['loyalty-rewards'], ['coupons']].map((queryKey) => qc.invalidateQueries({ queryKey })),
  );
}
