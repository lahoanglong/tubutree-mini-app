// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  rememberCheckoutSelection,
  recallCheckoutSelection,
  clearCheckoutSelection,
  reconcileSelection,
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

  it('null (toàn giỏ) đọc lại vẫn là null, KHÔNG thành undefined', () => {
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
  it('không có lựa chọn → toàn giỏ', () => {
    expect(reconcileSelection(undefined, ['a'])).toBeUndefined();
    expect(reconcileSelection(null, ['a'])).toBeUndefined();
  });

  it('giữ đúng các dòng còn tồn tại', () => {
    expect(reconcileSelection(['a', 'b'], ['a', 'b', 'c'])).toEqual(['a', 'b']);
  });

  it('dòng đã bị xoá thì bỏ qua, phần còn lại vẫn thanh toán được', () => {
    expect(reconcileSelection(['a', 'gone'], ['a', 'c'])).toEqual(['a']);
  });

  it('không còn dòng nào → toàn giỏ (không tạo đơn rỗng)', () => {
    expect(reconcileSelection(['gone'], ['a', 'c'])).toBeUndefined();
  });

  it('lựa chọn hết hạn thì DỌN LUÔN bộ nhớ, không để lần sau phải đối chiếu danh sách chết', () => {
    rememberCheckoutSelection(['gone']);
    expect(reconcileSelection(['gone'], ['a'])).toBeUndefined();
    expect(recallCheckoutSelection()).toBeUndefined();
  });
});
