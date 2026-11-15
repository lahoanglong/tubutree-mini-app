import type { WasteHomePickupDTO, WastePickupQuoteResponse, WasteRequestDetailDTO, WasteRequestSummaryDTO } from '@tubutree/shared-types';
import type { AddressDTO } from '@/lib/shop-client';
import { makeRequestDetail, makeRequestSummary } from './recycle-fixtures';

export function makeAddress(over: Partial<AddressDTO> = {}): AddressDTO {
  return {
    id: 'addr-1',
    recipient: 'Nguyễn Văn An',
    phone: '0901234567',
    province: 'TP. Hồ Chí Minh',
    district: '',
    ward: 'Phường Bến Thành',
    street: '12 Lê Lợi',
    provinceCode: '84_VN_79',
    districtCode: '',
    wardCode: '84_VN_79_26734',
    isDefault: true,
    ...over,
  };
}

/** Báo phí đủ Điểm Xanh trả: phí 25.000đ, khách có 40.000 điểm, trừ 25.000, không còn thiếu. */
export function makeQuote(over: Partial<WastePickupQuoteResponse> = {}): WastePickupQuoteResponse {
  return {
    shipFeeVnd: 25_000,
    estimated: false,
    estimatedPoints: 6000,
    minPoints: 5000,
    pointsAvailable: 40_000,
    pointsApplicable: 25_000,
    remainingFeeVnd: 0,
    addressOk: true,
    addressMessage: null,
    blocked: null,
    ...over,
  };
}

export function makeHomePickup(over: Partial<WasteHomePickupDTO> = {}): WasteHomePickupDTO {
  return {
    gomdonStatus: '1',
    statusText: 'Đã tạo đơn, chờ bưu tá tới lấy rác',
    shipFeeVnd: 25_000,
    shipFeePointsUsed: 25_000,
    shipFeeCodVnd: 0,
    shipFeePointsRefunded: 0,
    declaredWeightGrams: 2000,
    pickupAddressText: '12 Lê Lợi, Phường Bến Thành, TP. Hồ Chí Minh',
    timeline: [{ at: '2026-10-17T03:00:00.000Z', text: 'Đã tạo đơn thu gom' }],
    ...over,
  };
}

export function makeHomePickupRequest(over: Partial<WasteRequestDetailDTO> = {}): WasteRequestDetailDTO {
  return makeRequestDetail({
    method: 'HOME_PICKUP',
    point: null,
    pointAvailable: false,
    pointName: 'Kho Tubu HCM',
    editable: false,
    cancellable: true,
    homePickup: makeHomePickup(),
    ...over,
  });
}

export function makeHomePickupSummary(over: Partial<WasteRequestSummaryDTO> = {}): WasteRequestSummaryDTO {
  return makeRequestSummary({ id: 'r-home', code: 'TR-HOME1', method: 'HOME_PICKUP', status: 'OPEN', pointName: 'Kho Tubu HCM', homePickup: makeHomePickup(), ...over });
}
