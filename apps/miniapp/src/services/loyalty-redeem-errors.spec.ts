import { describe, it, expect } from 'vitest';
import { getErrorMessage, HttpError, RATE_LIMITED_MESSAGE } from './api';
import { vi as viCopy } from '../i18n/vi';

const httpError = (status: number, message: unknown, code?: string) => new HttpError('boom', undefined, { status, data: { message, ...(code ? { code } : {}) } });

const hasEnglishTechnical = (text: string) => /\b(bad request|not found|forbidden|conflict|unauthorized|throttler|internal server error|network error)\b/i.test(text);

/**
 * Câu từ chối của POST /loyalty/rewards/:id/redeem (loyalty.service.ts runRedeem + controller requireIdempotencyKey),
 * chép nguyên văn để chứng minh Mini hiện thẳng lời máy chủ chứ không đổi sang câu chung.
 */
describe('đổi quà: mọi lý do máy chủ từ chối hiện tiếng Việt cho khách', () => {
  it.each([
    ['404 quà không tồn tại', 404, 'Phần thưởng "reward-x" không tồn tại.'],
    ['400 quà trồng cây', 400, 'Quà góp quỹ trồng cây đổi bằng nút Góp cây ở Vườn Xanh.'],
    ['400 hết hoặc ngừng đổi', 400, 'Quà này đã hết hoặc đã ngừng đổi'],
    ['400 thiếu điểm', 400, 'Bạn cần 500 Điểm Xanh để đổi ưu đãi này (hiện có 120 điểm).'],
    ['400 điểm đang khoá', 400, 'Bạn cần 500 Điểm Xanh dùng được để đổi ưu đãi này — hiện dùng được 100/600 điểm: 500 điểm từ đơn mới giao sẽ dùng được sau ngày 17/11/2026 (hết hạn đổi/trả hàng).'],
    ['403 khách chưa đăng nhập Zalo', 403, 'Ưu đãi này chỉ dành cho tài khoản đã đăng nhập Zalo. Bạn đăng nhập bằng Zalo rồi thử lại nhé.'],
    ['409 khoá đã dùng cho quà khác', 409, 'Idempotency-Key này đã dùng cho một lượt đổi quà khác, hãy tạo khoá khác.'],
    ['400 thiếu khoá', 400, 'Thiếu Idempotency-Key: cần 8 đến 128 ký tự gồm chữ cái, chữ số, dấu gạch dưới (_) hoặc gạch nối (-).'],
  ])('%s', (_label, status, message) => {
    expect(getErrorMessage(httpError(status, message))).toBe(message);
  });

  it('429 của bộ giới hạn tốc độ (không mã) là câu đợi vài giây', () => {
    expect(getErrorMessage(httpError(429, 'ThrottlerException: Too Many Requests'))).toBe(RATE_LIMITED_MESSAGE);
  });

  it.each([
    ['404 mặc định của Nest', 404, 'Not Found'],
    ['400 mặc định của Nest', 400, 'Bad Request'],
    ['403 mặc định của Nest', 403, 'Forbidden'],
    ['409 mặc định của Nest', 409, 'Conflict'],
    ['400 kiểm tra dữ liệu tiếng Anh', 400, ['idempotencyKey must be a string']],
  ])('%s không lộ chữ tiếng Anh', (_label, status, message) => {
    const out = getErrorMessage(httpError(status, message));
    expect(out).toBe(viCopy.errors.generic);
    expect(hasEnglishTechnical(out)).toBe(false);
  });

  it('5xx và mất mạng dùng câu tiếng Việt của Mini', () => {
    const server = getErrorMessage(new HttpError('boom', undefined, { status: 500, data: { message: 'Internal server error' } }));
    expect(server).toBe(viCopy.errors.server);
    const network = getErrorMessage(new HttpError('Network Error', 'ERR_NETWORK', undefined));
    expect(hasEnglishTechnical(network)).toBe(false);
    expect(network).toBe(viCopy.errors.network);
  });
});
