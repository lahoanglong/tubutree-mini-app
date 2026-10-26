import { CASH_WORDING_MESSAGE, findCashWording } from '@tubutree/shared-types';

describe('Chữ thưởng/trả bằng tiền mặt (ưu đãi riêng của cửa hàng)', () => {
  it.each([
    'Tặng 10k cho khách đầu tiên',
    'tặng ngay 20.000đ khi mang vỏ chai',
    'Thưởng 50 nghìn mỗi tháng',
    'Hoàn tiền 10% cho đơn đầu',
    'Hoàn lại 5.000 đồng',
    'Trả tiền mặt tại quầy khi đổi chai',
    'THANH TOÁN BẰNG TIỀN MẶT',
    'Chuyển khoản lại tiền chai',
    'chuyen khoan 20k',
    'Rút tiền thưởng vào cuối tháng',
    'Nhận tiền thưởng sau 3 lần mang vỏ',
    'Cashback 5%',
    'Tặng 2 triệu cho top 1',
    'tang 10K',
    'Tặng 1.000.000',
  ])('chặn: %s', (text) => {
    expect(findCashWording(text)).not.toBeNull();
  });

  it.each([
    'Giảm 10% hoá đơn đầu',
    'Giảm 10k cho đơn từ 100k',
    'Tặng 1 túi vải tái sử dụng',
    'Tặng 2 đôi đũa tre',
    'Tặng 1.000 điểm thành viên của cửa hàng',
    'Mua 2 tặng 1',
    'Tặng cốc nước miễn phí',
    'Giảm 20.000đ khi mua từ 2 chai',
    'Tặng 500g hạt chia',
    'Tặng 3 sản phẩm dùng thử',
    'Tặng voucher 50k cho lần mua sau',
  ])('cho qua: %s', (text) => {
    expect(findCashWording(text)).toBeNull();
  });

  it('lời nhắn nói bằng chữ thường và gợi ý cách viết khác', () => {
    expect(CASH_WORDING_MESSAGE).toContain('giảm giá hoặc quà');
  });
});
