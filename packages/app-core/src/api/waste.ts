import type {
  GiftRedemptionDTO,
  ReturnPackagingResponse,
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
  WastePickupQuoteRequest,
  WastePickupQuoteResponse,
  WastePointDTO,
  WastePointMonthlyReportDTO,
  WastePreviewDTO,
  WastePreviewRequest,
  WastePublicWarehouseDTO,
  WasteRejectRequest,
  WasteRejectResultDTO,
  WasteRequestDetailDTO,
  WasteRequestSummaryDTO,
  WasteRulesDTO,
  WasteTrackingRequest,
} from '@tubutree/shared-types';
import type { HttpClient } from '../http';
import { syncServerClock } from '../server-clock';
import type { BankQr } from './payment';

const enc = encodeURIComponent;

export const WASTE_QUERY_KEYS = {
  all: ['waste'],
  me: ['waste', 'me'],
  items: ['waste', 'items'],
  points: (province: string | null) => ['waste', 'points', province] as const,
  requests: ['waste', 'requests'],
  request: (id: string) => ['waste', 'request', id] as const,
  feeQr: (id: string) => ['waste', 'fee-qr', id] as const,
  returnPackaging: (orderCode: string) => ['waste', 'return-packaging', orderCode] as const,
  desk: ['waste', 'desk'],
  rewards: ['loyalty-rewards'],
  rewardsMine: ['loyalty-rewards', 'mine'],
} as const;

/** Khoá cần làm mới sau khi ghi đổi rác; đổi quà làm mới thêm điểm thưởng và mã giảm giá, nếu thiếu thì số dư Điểm Xanh / Ví cũ. */
export const WASTE_WRITE_INVALIDATE_KEYS = [['waste'], ['loyalty'], ['points-txn'], ['game'], ['wallet']] as const;
export const WASTE_REDEEM_INVALIDATE_KEYS = [...WASTE_WRITE_INVALIDATE_KEYS, ['loyalty-rewards'], ['coupons']] as const;

export const getWasteMe = (http: HttpClient) => http.get<WasteMeDTO>('/waste/me');
/** Bao bì của một đơn đã giao để điền sẵn gói gửi lại (cờ `checkout.return_packaging_nudge_enabled`; tắt thì `suggestion: null`). */
export const getReturnPackaging = (http: HttpClient, orderCode: string) =>
  http.get<ReturnPackagingResponse>('/waste/return-packaging', { query: { orderCode } });
/** Công khai: khách chưa đăng nhập xem món nhận và mức điểm. */
export const getWasteCatalogue = (http: HttpClient) => http.get<WasteItemDTO[]>('/waste/catalogue');
/** Kho Tubu đang nhận rác (tên, tỉnh, giờ mở cửa), công khai: trang /doi-rac dựng mục Câu hỏi thường gặp ở máy chủ. */
export const getWasteWarehouses = (http: HttpClient) => http.get<WastePublicWarehouseDTO[]>('/waste/warehouses');
export const getWasteItems = (http: HttpClient) => http.get<WasteItemDTO[]>('/waste/items');
export const getWastePoints = (http: HttpClient, provinceCode?: string) =>
  http.get<WastePointDTO[]>('/waste/points', { query: provinceCode ? { provinceCode } : {} });
export const getNearbyWastePoints = (http: HttpClient, body: WasteNearbyRequest) =>
  http.post<WastePointDTO[]>('/waste/points/nearby', body);
export const previewWaste = (http: HttpClient, body: WastePreviewRequest) => http.post<WastePreviewDTO>('/waste/preview', body);
/** Báo phí shipper lấy rác tận nhà (HOME_PICKUP): phí thật hoặc ước lượng, Điểm Xanh trừ được, điều kiện chặn. Không ghi gì. */
export const getWastePickupQuote = (http: HttpClient, body: WastePickupQuoteRequest) =>
  http.post<WastePickupQuoteResponse>('/waste/pickup-quote', body);
export const createWasteRequest = (http: HttpClient, body: WasteCreateRequest, idempotencyKey: string) =>
  http.post<WasteRequestDetailDTO>('/waste/requests', body, { headers: { 'Idempotency-Key': idempotencyKey } });
export const editWasteRequest = (http: HttpClient, id: string, body: WasteEditRequest) =>
  http.patch<WasteRequestDetailDTO>(`/waste/requests/${enc(id)}`, body);
export const setWasteTracking = (http: HttpClient, id: string, body: WasteTrackingRequest) =>
  http.put<WasteRequestDetailDTO>(`/waste/requests/${enc(id)}/tracking`, body);
export const cancelWasteRequest = (http: HttpClient, id: string) => http.post<WasteRequestDetailDTO>(`/waste/requests/${enc(id)}/cancel`);
export const listWasteRequests = (http: HttpClient) => http.get<WasteRequestSummaryDTO[]>('/waste/requests');
export const getWasteRequest = (http: HttpClient, id: string) => http.get<WasteRequestDetailDTO>(`/waste/requests/${enc(id)}`);
export const getWasteFeeQr = async (http: HttpClient, id: string) => {
  const qr = await http.get<BankQr>(`/waste/requests/${enc(id)}/fee-qr`);
  syncServerClock(qr?.serverNow);
  return qr;
};
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
