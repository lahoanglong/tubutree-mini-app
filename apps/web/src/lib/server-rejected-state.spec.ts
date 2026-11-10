import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '@/lib/client-api';
import { serverRejectedState } from './server-rejected-state';

describe('serverRejectedState: chỉ 400/404/409/422 mới đáng tải lại', () => {
  it.each([400, 404, 409, 422])('ApiError %i: có', (status) => {
    expect(serverRejectedState(new ApiError('x', status))).toBe(true);
  });

  it.each([401, 403, 408, 410, 429, 500, 502, 503, 504])('ApiError %i: không', (status) => {
    expect(serverRejectedState(new ApiError('x', status))).toBe(false);
  });

  it('lệnh có ô nhập của người dùng: 400 là lỗi nhập liệu nên không tải lại, 404/409/422 vẫn tải lại', () => {
    expect(serverRejectedState(new ApiError('x', 400), { userInput: true })).toBe(false);
    expect(serverRejectedState({ response: { status: 400 } }, { userInput: true })).toBe(false);
    for (const status of [404, 409, 422]) expect(serverRejectedState(new ApiError('x', status), { userInput: true })).toBe(true);
    for (const status of [401, 403, 429, 500, 503]) expect(serverRejectedState(new ApiError('x', status), { userInput: true })).toBe(false);
    expect(serverRejectedState(new NetworkError(false), { userInput: true })).toBe(false);
  });

  it('userInput: false giống không truyền', () => {
    expect(serverRejectedState(new ApiError('x', 400), { userInput: false })).toBe(true);
  });

  it('mất mạng, lỗi thường, giá trị lạ: không', () => {
    expect(serverRejectedState(new NetworkError(false))).toBe(false);
    expect(serverRejectedState(new Error('boom'))).toBe(false);
    expect(serverRejectedState(null)).toBe(false);
    expect(serverRejectedState('400')).toBe(false);
  });

  it('lỗi kiểu axios của Mini App (response.status) cũng đọc được', () => {
    expect(serverRejectedState({ response: { status: 409 } })).toBe(true);
    expect(serverRejectedState({ response: { status: 503 } })).toBe(false);
  });
});
