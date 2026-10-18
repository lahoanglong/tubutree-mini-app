// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  clearDraft,
  loadDraft,
  saveDraft,
  savePointsNav,
  loadPointsNav,
  saveReturn,
  takeReturn,
  toLineInputs,
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
