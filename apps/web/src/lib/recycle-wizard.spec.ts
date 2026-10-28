// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  clearDraft,
  clearPointsNav,
  clearWizardStorage,
  markResume,
  takeResume,
  peekResume,
  loadDraft,
  saveDraft,
  savePointsNav,
  loadPointsNav,
  saveReturn,
  takeReturn,
  toLineInputs,
  markSubmitted,
  takeSubmitted,
  clearSubmitted,
} from './recycle-wizard';

const DRAFT = { ...EMPTY_DRAFT, lines: { 'item-carton': 3 }, method: 'DROP_OFF' as const, pointId: 'pt-1' };

beforeEach(() => window.sessionStorage.clear());

describe('nháp Đổi rác trong sessionStorage (thay navigation state của Mini App)', () => {
  it('lưu rồi đọc lại, xoá thì về rỗng', () => {
    expect(loadDraft()).toBeNull();
    saveDraft(DRAFT);
    expect(loadDraft()).toEqual(DRAFT);
    clearDraft();
    expect(loadDraft()).toBeNull();
  });
  it('dữ liệu hỏng hoặc sai hình dạng coi như không có nháp', () => {
    window.sessionStorage.setItem('tubu_recycle_draft', '{không phải json');
    expect(loadDraft()).toBeNull();
    window.sessionStorage.setItem('tubu_recycle_draft', JSON.stringify({ lines: { a: 'x' } }));
    expect(loadDraft()).toBeNull();
    window.sessionStorage.setItem('tubu_recycle_draft', JSON.stringify({ ...DRAFT, method: 'FLY' }));
    expect(loadDraft()).toBeNull();
  });
  it('sang trang chọn điểm: nav đọc lại được, returnTo ngoài site bị bỏ', () => {
    savePointsNav({ returnTo: '/doi-rac/tao?step=method', draft: DRAFT, selectedItemIds: ['item-carton'] });
    expect(loadPointsNav()).toEqual({ returnTo: '/doi-rac/tao?step=method', draft: DRAFT, selectedItemIds: ['item-carton'] });
    savePointsNav({ returnTo: 'https://evil.example/x', draft: DRAFT, selectedItemIds: [] });
    expect(loadPointsNav()).toBeNull();
    savePointsNav({ returnTo: '//evil.example', draft: DRAFT, selectedItemIds: [] });
    expect(loadPointsNav()).toBeNull();
  });
  it('nháp trả về từ trang chọn điểm chỉ lấy được một lần', () => {
    saveReturn(DRAFT);
    expect(takeReturn()).toEqual(DRAFT);
    expect(takeReturn()).toBeNull();
  });
  it('toLineInputs bỏ số lượng 0 và xếp theo itemId', () => {
    expect(toLineInputs({ 'item-milk': 2, 'item-carton': 0, 'item-battery': 1 })).toEqual([
      { itemId: 'item-battery', declaredQty: 1 },
      { itemId: 'item-milk', declaredQty: 2 },
    ]);
  });
});

describe('cờ tiếp tục wizard và dọn khoá', () => {
  it('markResume bật cờ, peek không xoá, take đọc rồi xoá', () => {
    expect(peekResume()).toBe(false);
    markResume();
    expect(peekResume()).toBe(true);
    expect(takeResume()).toBe(true);
    expect(peekResume()).toBe(false);
  });
  it('clearPointsNav xoá khoá điều hướng chọn điểm', () => {
    savePointsNav({ returnTo: '/doi-rac/tao?step=method', draft: DRAFT, selectedItemIds: ['a'] });
    clearPointsNav();
    expect(loadPointsNav()).toBeNull();
  });
  it('clearWizardStorage xoá nháp, điều hướng, nháp trả về và cờ', () => {
    saveDraft(DRAFT);
    savePointsNav({ returnTo: '/doi-rac/tao?step=method', draft: DRAFT, selectedItemIds: ['a'] });
    saveReturn(DRAFT);
    markResume();
    clearWizardStorage();
    expect(loadDraft()).toBeNull();
    expect(loadPointsNav()).toBeNull();
    expect(takeReturn()).toBeNull();
    expect(peekResume()).toBe(false);
  });
});

describe('cờ "vừa gửi yêu cầu" (Quay lại từ trang yêu cầu không về form trống)', () => {
  it('đọc một lần rồi mất; chưa đánh dấu thì không có', () => {
    expect(takeSubmitted()).toBe(false);
    markSubmitted();
    expect(takeSubmitted()).toBe(true);
    expect(takeSubmitted()).toBe(false);
  });
  it('về trang Đổi rác (clearSubmitted) thì lần vào mới không bị đưa về', () => {
    markSubmitted();
    clearSubmitted();
    expect(takeSubmitted()).toBe(false);
  });
  it('quá 30 phút thì bỏ', () => {
    window.sessionStorage.setItem('tubu_recycle_submitted', JSON.stringify(Date.now() - 31 * 60_000));
    expect(takeSubmitted()).toBe(false);
  });
});
