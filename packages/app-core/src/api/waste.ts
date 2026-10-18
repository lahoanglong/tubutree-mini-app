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
import type { HttpClient } from '../http';

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

/** Khoá cần làm mới sau khi ghi đổi rác; đổi quà làm mới thêm điểm thưởng và mã giảm giá, nếu thiếu thì số dư Điểm Xanh cũ. */
export const WASTE_WRITE_INVALIDATE_KEYS = [['waste'], ['loyalty'], ['points-txn'], ['game']] as const;
export const WASTE_REDEEM_INVALIDATE_KEYS = [...WASTE_WRITE_INVALIDATE_KEYS, ['loyalty-rewards'], ['coupons']] as const;

export const getWasteMe = (http: HttpClient) => http.get<WasteMeDTO>('/waste/me');
export const getWasteItems = (http: HttpClient) => http.get<WasteItemDTO[]>('/waste/items');
export const getWastePoints = (http: HttpClient, provinceCode?: string) =>
  http.get<WastePointDTO[]>('/waste/points', { query: provinceCode ? { provinceCode } : {} });
export const getNearbyWastePoints = (http: HttpClient, body: WasteNearbyRequest) =>
  http.post<WastePointDTO[]>('/waste/points/nearby', body);
export const previewWaste = (http: HttpClient, body: WastePreviewRequest) => http.post<WastePreviewDTO>('/waste/preview', body);
export const createWasteRequest = (http: HttpClient, body: WasteCreateRequest, idempotencyKey: string) =>
  http.post<WasteRequestDetailDTO>('/waste/requests', body, { headers: { 'Idempotency-Key': idempotencyKey } });
export const editWasteRequest = (http: HttpClient, id: string, body: WasteEditRequest) =>
  http.patch<WasteRequestDetailDTO>(`/waste/requests/${enc(id)}`, body);
export const setWasteTracking = (http: HttpClient, id: string, body: WasteTrackingRequest) =>
  http.put<WasteRequestDetailDTO>(`/waste/requests/${enc(id)}/tracking`, body);
export const cancelWasteRequest = (http: HttpClient, id: string) => http.post<WasteRequestDetailDTO>(`/waste/requests/${enc(id)}/cancel`);
export const listWasteRequests = (http: HttpClient) => http.get<WasteRequestSummaryDTO[]>('/waste/requests');
export const getWasteRequest = (http: HttpClient, id: string) => http.get<WasteRequestDetailDTO>(`/waste/requests/${enc(id)}`);
export const getWasteRequestByOrder = (http: HttpClient, orderId: string) =>
  http.get<WasteRequestDetailDTO>(`/waste/requests/by-order/${enc(orderId)}`);
export const getWasteRules = (http: HttpClient) => http.get<WasteRulesDTO>('/waste/rules');
export const getDeskPoints = (http: HttpClient) => http.get<WasteDeskPointDTO[]>('/waste/desk/points');
export const deskLookup = (http: HttpClient, code: string) => http.post<WasteDeskLookupDTO>('/waste/desk/lookup', { code: code.trim() });
export const deskConfirm = (http: HttpClient, id: string, body: WasteConfirmRequest) =>
  http.post<WasteConfirmResultDTO>(`/waste/desk/requests/${enc(id)}/confirm`, body);
export const deskReject = (http: HttpClient, id: string, body: WasteRejectRequest) =>
  http.post<WasteRejectResultDTO>(`/waste/desk/requests/${enc(id)}/reject`, body);
export const deskFulfilGift = (http: HttpClient, body: WasteDeskGiftFulfilRequest) =>
  http.post<GiftRedemptionDTO>('/waste/desk/gifts/fulfil', body);
export const getDeskPointReport = (http: HttpClient, pointId: string, month: string) =>
  http.get<WastePointMonthlyReportDTO>(`/waste/desk/points/${enc(pointId)}/report`, { query: { month } });
export const submitDeskPerk = (http: HttpClient, pointId: string, body: WastePerkSubmitRequest) =>
  http.put<WasteDeskPointDTO>(`/waste/desk/points/${enc(pointId)}/perk`, body);
