import { ApiError, GENERIC_ERROR } from '@/lib/client-api';
import { actionErrorText as baseActionErrorText, isBusinessMessage, loadErrorText as baseLoadErrorText } from '@/lib/error-text';

/**
 * Chữ báo lỗi cho trang Quản trị. Khác bản của khách ở một chỗ: 5xx mang lời tiếng Việt của máy chủ (vd "Pancake chưa được cấu hình",
 * "Không cộng được Điểm Xanh, đã báo quản trị viên") giữ nguyên lời thay vì câu chung "Máy chủ đang bận", vì nhân viên cần biết bước nào
 * hỏng để xử lý. Còn lại (lời tiếng Anh của framework, 429, 401, mất mạng, hết giờ) theo đúng luật của error-text.ts.
 */
function adminOverride(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const message = error.message.trim();
  if (!message || message === GENERIC_ERROR) return null;
  if (error.status >= 500 && isBusinessMessage(message)) return message;
  return null;
}

export const actionErrorText = (error: unknown): string => adminOverride(error) ?? baseActionErrorText(error);
export const loadErrorText = (error: unknown): string => adminOverride(error) ?? baseLoadErrorText(error);
