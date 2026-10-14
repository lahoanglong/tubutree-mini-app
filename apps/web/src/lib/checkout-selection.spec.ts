// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCheckoutSelection,
  reconcileSelection,
  recallCheckoutSelection,
  rememberCheckoutSelection,
} from './checkout-selection';

describe('ghi nhớ lựa chọn thanh toán qua lần tải lại trang', () => {
  beforeEach(() => sessionStorage.clear());

  it('chưa ghi gì → undefined (khác null = cố ý toàn giỏ)', () => {
    expect(recallCheckoutSelection()).toBeUndefined();
  });

  it('nhớ tập con rồi đọc lại đúng danh sách', () => {
    rememberCheckoutSelection(['a', 'b']);
    expect(recallCheckoutSelection()).toEqual(['a', 'b']);
  });

  it('null (toàn giỏ) đọc lại vẫn là null, không thành undefined', () => {
    rememberCheckoutSelection(null);
    expect(recallCheckoutSelection()).toBeNull();
  });

  it('xoá xong quay về undefined', () => {
    rememberCheckoutSelection(['a']);
    clearCheckoutSelection();
    expect(recallCheckoutSelection()).toBeUndefined();
  });

  it('dữ liệu hỏng → undefined chứ không ném lỗi', () => {
    sessionStorage.setItem('tubu_checkout_selection', '{nope');
    expect(recallCheckoutSelection()).toBeUndefined();
    sessionStorage.setItem('tubu_checkout_selection', '{"itemIds":[1,2]}');
    expect(recallCheckoutSelection()).toBeUndefined();
  });
});

describe('reconcileSelection — đối chiếu với giỏ thật', () => {
  beforeEach(() => sessionStorage.clear());

  it('không có lựa chọn → toàn giỏ', () => {
    expect(reconcileSelection(undefined, ['a'])).toBeUndefined();
    expect(reconcileSelection(null, ['a'])).toBeUndefined();
  });

  it('giữ đúng các dòng còn tồn tại, bỏ dòng đã xoá', () => {
    expect(reconcileSelection(['a', 'b'], ['a', 'b', 'c'])).toEqual(['a', 'b']);
    expect(reconcileSelection(['a', 'gone'], ['a', 'c'])).toEqual(['a']);
  });

  it('không còn dòng nào → toàn giỏ và dọn bộ nhớ đã hết hạn', () => {
    rememberCheckoutSelection(['gone']);
    expect(reconcileSelection(['gone'], ['a'])).toBeUndefined();
    expect(recallCheckoutSelection()).toBeUndefined();
  });
});
