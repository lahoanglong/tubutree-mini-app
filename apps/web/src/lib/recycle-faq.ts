import { getPublicConfig } from '@tubutree/app-core/api/config';
import { getWasteCatalogue, getWasteWarehouses } from '@tubutree/app-core/api/waste';
import type { HttpClient } from '@tubutree/app-core/http';
import { wasteFaq, type WasteFaqItem } from '@tubutree/app-core/waste-faq';
import { ApiUnavailableError } from './api';
import { ApiNotFoundError } from './core-http-server';

/**
 * 404 là API cũ chưa có route (ví dụ /waste/warehouses khi web lên trước API): bỏ phần dùng tới nó. Lỗi tạm lúc runtime phải ném để Next
 * giữ bản /doi-rac đã render, không lưu bản thiếu FAQ tới hết revalidate; riêng `next build` (API thường chưa lên) thì bỏ qua để build không hỏng.
 */
async function unlessMissing<T>(load: Promise<T>): Promise<T | undefined> {
  try {
    return await load;
  } catch (err) {
    if (err instanceof ApiNotFoundError) return undefined;
    if (err instanceof ApiUnavailableError && process.env.NEXT_PHASE === 'phase-production-build') return undefined;
    throw err;
  }
}

/**
 * Câu hỏi thường gặp của /doi-rac từ dữ liệu thật, đọc ở máy chủ. Không có cấu hình công khai thì không có FAQ (không đoán cách giao nào
 * đang mở). Không có kho hay danh mục món thì chỉ bỏ phần dùng tới chúng: câu chung về điểm nhận, không câu về món, chứ không bịa giờ hay món.
 */
export async function loadRecycleFaq(http: HttpClient): Promise<WasteFaqItem[]> {
  const [config, warehouses, items] = await Promise.all([
    unlessMissing(getPublicConfig(http)),
    unlessMissing(getWasteWarehouses(http)),
    unlessMissing(getWasteCatalogue(http)),
  ]);
  const flags = config?.waste;
  if (!flags) return [];
  return wasteFaq({ flags, warehouses: Array.isArray(warehouses) ? warehouses : [], items: Array.isArray(items) ? items : undefined });
}
