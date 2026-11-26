import { describe, expect, it } from 'vitest';
import type { OrderEditRefusalReason, ShippingAddressSnapshot } from '@tubutree/shared-types';
import { ORDER_EDIT_MAX, orderEditRefusalMessage } from '../../../apps/api/src/modules/orders/order-customer-edit';
import { canEditOrder } from './api/order-edit';
import {
  ORDER_EDIT_COPY,
  orderEditAddressEditable,
  orderEditBody,
  orderEditFormOf,
  orderEditLinkAria,
  orderEditProvinceLine,
  orderEditRefusalText,
  orderEditSaved,
  orderEditsLeftText,
} from './order-edit-copy';

const SNAP: ShippingAddressSnapshot = {
  recipient: 'Nguyễn An',
  phone: '0901234567',
  province: 'Hà Nội',
  district: '',
  ward: 'Phường Ba Đình',
  street: '12 Phan Đình Phùng',
  provinceCode: '84_VN01',
  districtCode: '',
  wardCode: '84_VN0100004',
};

const REASONS: OrderEditRefusalReason[] = [
  'DISABLED',
  'NOT_ELIGIBLE',
  'NOT_EDITABLE_STATUS',
  'HANDED_OVER',
  'PACKING_ON_PANCAKE',
  'PANCAKE_UNREACHABLE',
  'SYNCING',
  'EDIT_LIMIT',
  'PROVINCE_CHANGED',
  'PROVINCE_LOCKED',
];

describe('order-edit-copy', () => {
  it('câu từ chối theo lý do trùng chữ với máy chủ (kể cả tên tỉnh và số lần tối đa)', () => {
    for (const r of REASONS) expect([r, orderEditRefusalText(r, 'Hà Nội')]).toEqual([r, orderEditRefusalMessage(r, 'Hà Nội')]);
    expect(orderEditRefusalText('PROVINCE_CHANGED')).toBe(orderEditRefusalMessage('PROVINCE_CHANGED'));
    expect(orderEditRefusalText('EDIT_LIMIT')).toContain(`${ORDER_EDIT_MAX} lần`);
  });

  it('chữ cố định của lối vào và tấm sửa', () => {
    expect(ORDER_EDIT_COPY.link).toBe('Sửa');
    expect(ORDER_EDIT_COPY.title).toBe('Sửa địa chỉ và ghi chú');
    expect(ORDER_EDIT_COPY.save).toBe('Lưu thay đổi');
    expect(orderEditLinkAria('TB123')).toBe('Sửa địa chỉ và ghi chú đơn TB123');
    expect(orderEditProvinceLine('Hà Nội')).toBe('Tỉnh/thành: Hà Nội (không đổi được)');
    expect(orderEditSaved('TB123')).toBe('Đã cập nhật đơn TB123');
    expect(orderEditsLeftText(2)).toBe('Còn 2 lần sửa cho đơn này.');
    expect(orderEditsLeftText(0)).toBe('Đơn đã hết lượt tự sửa.');
  });

  it('chỉ hiện lối "Sửa" khi máy chủ báo canEdit === true', () => {
    expect(canEditOrder({ canEdit: true })).toBe(true);
    expect(canEditOrder({ canEdit: false })).toBe(false);
    expect(canEditOrder({})).toBe(false);
  });

  it('địa chỉ sửa được chỉ khi đơn đã theo địa giới mới', () => {
    expect(orderEditAddressEditable(SNAP)).toBe(true);
    expect(orderEditAddressEditable({ provinceCode: '' })).toBe(false);
    expect(orderEditAddressEditable({ provinceCode: '79' })).toBe(false);
  });

  it('không đổi gì: null; chỉ khác khoảng trắng cũng là không đổi', () => {
    expect(orderEditBody(SNAP, 'Gọi trước', orderEditFormOf(SNAP, 'Gọi trước'))).toBeNull();
    expect(orderEditBody(SNAP, 'Gọi trước', { ...orderEditFormOf(SNAP, 'Gọi trước'), street: ' 12 Phan Đình Phùng ', note: 'Gọi trước ' })).toBeNull();
  });

  it('đổi địa chỉ: gửi đủ 7 trường, tỉnh lấy từ đơn; không gửi ghi chú khi ghi chú giữ nguyên', () => {
    const body = orderEditBody(SNAP, null, { ...orderEditFormOf(SNAP, null), ward: 'Phường Hoàn Kiếm', wardCode: '84_VN0100070', street: '5 Tràng Tiền' });
    expect(body).toEqual({
      address: {
        recipient: 'Nguyễn An',
        phone: '0901234567',
        ward: 'Phường Hoàn Kiếm',
        street: '5 Tràng Tiền',
        provinceCode: '84_VN01',
        districtCode: '',
        wardCode: '84_VN0100070',
      },
    });
  });

  it('chỉ đổi ghi chú: không gửi địa chỉ; xoá ghi chú gửi null', () => {
    expect(orderEditBody(SNAP, 'cũ', { ...orderEditFormOf(SNAP, 'cũ'), note: 'mới' })).toEqual({ note: 'mới' });
    expect(orderEditBody(SNAP, 'cũ', { ...orderEditFormOf(SNAP, 'cũ'), note: '  ' })).toEqual({ note: null });
  });

  it('đổi địa chỉ mà bỏ trống ô bắt buộc: REQUIRED', () => {
    expect(orderEditBody(SNAP, null, { ...orderEditFormOf(SNAP, null), recipient: '' })).toBe('REQUIRED');
    expect(orderEditBody(SNAP, null, { ...orderEditFormOf(SNAP, null), ward: '', wardCode: '' })).toBe('REQUIRED');
  });

  it('đơn địa giới cũ: bỏ qua ô địa chỉ, chỉ gửi ghi chú', () => {
    const old = { ...SNAP, provinceCode: '' };
    expect(orderEditBody(old, null, { ...orderEditFormOf(old, null), street: 'khác', note: 'x' })).toEqual({ note: 'x' });
  });
});
