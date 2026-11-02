import type { FlashAllowanceResponse } from '@tubutree/shared-types';
import type { HttpClient } from '../http';

/** Đường dẫn hỏi số suất Giờ vàng của khách đang đăng nhập cho các suất (flashSaleItemId) đang vẽ; endpoint cần phiên và tối đa 50 id. */
export const flashAllowancePath = (itemIds: readonly string[]) => `/flash-sales/me/allowance?items=${itemIds.map(encodeURIComponent).join(',')}`;

export const fetchFlashAllowance = (http: HttpClient, itemIds: readonly string[]) => http.get<FlashAllowanceResponse>(flashAllowancePath(itemIds));
