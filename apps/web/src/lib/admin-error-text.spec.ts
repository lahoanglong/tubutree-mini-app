import { describe, expect, it } from 'vitest';
import { ApiError, GENERIC_ERROR, NetworkError } from '@/lib/client-api';
import { actionErrorText, loadErrorText } from '@/lib/admin-error-text';

describe('admin-error-text', () => {
  it('5xx có lời tiếng Việt của máy chủ: giữ lời để nhân viên biết bước nào hỏng', () => {
    expect(actionErrorText(new ApiError('Pancake chưa được cấu hình (PANCAKE_API_KEY/SHOP_ID).', 503))).toBe(
      'Pancake chưa được cấu hình (PANCAKE_API_KEY/SHOP_ID).',
    );
    expect(loadErrorText(new ApiError('Không cộng được Điểm Xanh, đã báo quản trị viên.', 500))).toBe(
      'Không cộng được Điểm Xanh, đã báo quản trị viên.',
    );
  });

  it('5xx câu chung của máy chủ (lỗi cơ sở dữ liệu, thử lại sau): câu chung của web', () => {
    for (const m of ['Lỗi cơ sở dữ liệu.', 'Đã có lỗi xảy ra, bạn thử lại sau nhé.', 'Hệ thống đang bận, bạn thử lại sau ít giây nhé.']) {
      expect(actionErrorText(new ApiError(m, 500))).toBe('Máy chủ đang bận, thử lại nhé.');
      expect(loadErrorText(new ApiError(m, 503))).toBe('Máy chủ đang bận, thử lại nhé.');
    }
  });

  it('5xx lời mặc định tiếng Anh của Nest: câu chung, không lộ "Internal server error"', () => {
    expect(actionErrorText(new ApiError('Internal server error', 500))).toBe('Máy chủ đang bận, thử lại nhé.');
  });

  it('400 lời class-validator tiếng Anh: câu chung như luật của khách', () => {
    expect(actionErrorText(new ApiError('rewardPoints must not be greater than 100000', 400))).toBe('Có chút trục trặc, thử lại nhé');
  });

  it('400 lời nghiệp vụ tiếng Việt: giữ nguyên', () => {
    expect(actionErrorText(new ApiError('Số tiền vượt dư nợ hiện tại.', 400))).toBe('Số tiền vượt dư nợ hiện tại.');
  });

  it('câu chung của apiFetch, 429, hết giờ: theo luật chung', () => {
    expect(actionErrorText(new ApiError(GENERIC_ERROR, 500))).toBe('Máy chủ đang bận, thử lại nhé.');
    expect(actionErrorText(new ApiError('ThrottlerException: Too Many Requests', 429))).toBe(
      'Bạn thao tác hơi nhanh, đợi vài giây rồi thử lại nhé.',
    );
    expect(actionErrorText(new NetworkError(true))).toBe('Mạng chậm, chưa rõ đã xong chưa. Bạn kiểm tra lại rồi thử lại nhé.');
  });
});
