import { ConflictException } from '@nestjs/common';
import { assertReachedStatus } from './status-race';

describe('assertReachedStatus', () => {
  it('đã tới đích thì êm', () => {
    expect(() => assertReachedStatus({ status: 'CANCELLED' }, 'CANCELLED')).not.toThrow();
  });

  it('thua race → 409 kèm nhãn trạng thái mới', () => {
    const run = () => assertReachedStatus({ status: 'PACKED', pancakeAttention: null }, 'DELIVERED');
    expect(run).toThrow(ConflictException);
    expect(run).toThrow('Đơn vừa chuyển sang «Đang đóng gói» trong lúc bạn thao tác nên chưa đổi được. Tải lại đơn rồi thử lại.');
  });

  it('huỷ thua mà đơn có cờ Pancake → thêm câu "Cần xử lý Pancake"; đích khác huỷ thì không', () => {
    expect(() => assertReachedStatus({ status: 'CONFIRMED', pancakeAttention: 'x' }, 'CANCELLED')).toThrow(/Đơn đã vào Cần xử lý Pancake\.$/);
    expect(() => assertReachedStatus({ status: 'CANCELLED', pancakeAttention: 'x' }, 'PACKED')).toThrow(/thử lại\.$/);
  });

  it('trạng thái lạ thì in nguyên mã', () => {
    expect(() => assertReachedStatus({ status: 'WEIRD' }, 'CANCELLED')).toThrow('«WEIRD»');
  });
});
