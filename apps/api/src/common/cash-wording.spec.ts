import { CASH_WORDING_MESSAGE, cashWordingMessage, findCashWording } from '@tubutree/shared-types';

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
    'tặng 10000',
    'Tặng khách hàng 10k',
    'Tặng mỗi khách 10k',
    'Cộng 10k vào ví',
    'ck 10k',
    'Momo 10k',
    'Lixi 10k',
    'Lì xì 20k',
    'Tặng 5 USD',
    'Tặng năm mươi nghìn',
    'Tặng hai trăm nghìn cho khách mới',
    'Chuyển 50k vào số tài khoản',
    'Nạp thẻ cào 20k',
    'Hoàn 5% giá trị đơn',
    'hoàn ví 5%',
    'Hoàn vào ví 10k',
    'Tặng phiếu mua hàng 50.000đ',
    'Tặng phiếu mua hàng cho khách quen',
    'Thưởng 2 củ',
    'Tặng năm chục',
    'Tặng 50 cành',
    'Thưởng 2 củ cho người mang nhiều vỏ nhất',
    'Cho khách 20k',
    'Tặng thẻ quà tặng 100k',
    'Chuyển thưởng vào ngân hàng của bạn',
    'Tặng 5 chục nghìn',
    'Tặng 5 đô',
    'Biếu 1 trăm',
    'Tặng mệnh giá 50k',
    'Tặng phong bao 50k',
    'Quà 50k',
    'Tặng 🎁 10k',
    'Trả 10k cho mỗi kg giấy',
    'Tặng thẻ cào 10k',
    'Nhận tiền 50k mỗi tháng',
    'Hoàn 5% khi mua đơn đầu',
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
    'Hoàn tiền cọc vỏ chai',
    'Trả lại tiền cọc khi mang vỏ chai về',
    'Cộng 100 điểm cho mỗi vỏ chai',
    'Cộng 2k điểm thành viên',
    'Tặng 10000 điểm',
    'Tặng năm hạt giống rau',
    'Tặng 1 năm bảo hành',
    'Nhắn 0901234567 để đặt lịch',
    'Gọi hoặc nhắn 0909 123 456',
    'Gọi 0909.123.456 hoặc nhắn Zalo +84 909 123 456',
    'Giảm 5% cho 1.000 khách đầu tiên',
    'Giảm 10% cho 2000 người đăng ký đầu',
    'Không phải trả tiền ship',
    'Miễn trả tiền vận chuyển',
    'Thanh toán qua thẻ ngân hàng',
    'Tặng 2 củ cải trắng',
    'Tặng 1 chục trứng gà',
    'Hoàn 5% giá trị đơn bằng điểm Xanh',
    'Tặng 1 gói trà thượng hạng',
    'Mua 2 ly trà 25k tặng 1 ly',
    'Đồng giá trà 20k',
    'Mua 1 chục trứng tặng 1 chục',
    'Mua 2 củ tặng 1 củ',
    'Tặng 5 cành cho khách nữ',
    'Tặng 1.000 túi vải',
    'Tặng 1000 cây xanh',
    'Tặng 1.500 túi',
    'Ưu đãi có thể cao hơn vào cuối tuần',
    'Nhân tiện ghé quán',
    'Khách trả tiền khi nhận hàng',
    'Hoàn 100% nếu hàng lỗi',
    'Tặng voucher 50k cho lần mua sau',
    'Tặng 50k voucher',
  ])('cho qua: %s', (text) => {
    expect(findCashWording(text)).toBeNull();
  });

  it('lời nhắn nêu đúng đoạn chữ đại lý đã viết (giữ dấu) để biết sửa chỗ nào', () => {
    expect(findCashWording('Mang vỏ chai về nhận Tặng 10K ngay nhé')).toBe('Tặng 10K');
    expect(cashWordingMessage('Chúng tôi Hoàn Tiền mặt tại quầy')).toMatch(/^Chữ "Tiền mặt"|^Chữ "Hoàn Tiền"/);
    expect(cashWordingMessage('Thưởng 2 củ')).toContain('Chữ "Thưởng 2 củ"');
    expect(cashWordingMessage('Giảm 10% hoá đơn đầu')).toBe(CASH_WORDING_MESSAGE);
  });

  it('lời nhắn nói bằng chữ thường và gợi ý cách viết khác', () => {
    expect(CASH_WORDING_MESSAGE).toContain('giảm giá hoặc quà');
  });
});
