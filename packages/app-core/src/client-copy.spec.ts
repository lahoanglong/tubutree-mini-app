import { describe, expect, it } from 'vitest';
import * as copy from './client-copy';
import { FORBIDDEN_TERMS } from './shop-copy';

const strings = (): [string, string][] =>
  Object.entries(copy).flatMap(([name, v]) => (typeof v === 'string' ? [[name, v] as [string, string]] : []));

describe('client-copy: chữ dùng chung hai app', () => {
  it('không hằng chữ nào dính thuật ngữ cấm', () => {
    const bad = strings().filter(([, text]) => FORBIDDEN_TERMS.some((t) => t.pattern.test(text))).map(([name]) => name);
    expect(bad).toEqual([]);
  });

  it('hàm chữ không dính thuật ngữ cấm với đầu vào mẫu', () => {
    const texts = [copy.loadMoreFailed('thông báo'), copy.bankCopyFailed('số tài khoản'), copy.returnWindowExpired(7), copy.overStockMessage('Dầu gội', 2), copy.overStockMessage('Dầu gội', 0)];
    const bad = texts.filter((text) => FORBIDDEN_TERMS.some((t) => t.pattern.test(text)));
    expect(bad).toEqual([]);
  });

  it('lỗi chung: nói chuyện gì xảy ra và khách làm gì tiếp', () => {
    expect(copy.ERROR_GENERIC).toBe('Đã có lỗi xảy ra. Bạn thử lại nhé.');
    expect(copy.ERROR_NETWORK).toBe('Mất kết nối. Kiểm tra mạng rồi thử lại.');
    expect(copy.AVATAR_READ_FAILED).toBe('Không tải được ảnh. Thử lại sau ít phút.');
    expect(copy.loadMoreFailed('thông báo')).toBe('Không tải thêm được thông báo. Thử lại sau ít phút.');
  });

  it('nhập tài khoản nhận hoàn tiền và chuyển khoản', () => {
    expect(copy.REQUIRED_FIELD).toBe('Bạn điền giúp Tubu mục này nhé');
    expect(copy.BANK_NAME_REQUIRED).toBe('Nhập tên ngân hàng.');
    expect(copy.ACCOUNT_NAME_REQUIRED).toBe('Nhập tên chủ tài khoản.');
    expect(copy.BANK_TX_FAILED).toBe('Giao dịch không thành công hoặc đã được hoàn lại. Liên hệ Tubu để được hỗ trợ.');
    expect(copy.bankCopyFailed('số tài khoản')).toBe('Không thể sao chép số tài khoản. Bạn chép thủ công nhé.');
    expect(copy.BANK_NOT_RECEIVED).toBe('Chưa thấy tiền về. Ngân hàng thường xử lý trong 30 giây đến 1 phút sau khi chuyển. Bạn kiểm tra lại sau ít phút nhé.');
    expect(copy.BANK_CHECK_NETWORK).toBe('Không kết nối được tới Tubu Tree. Bạn kiểm tra mạng rồi bấm lại nhé.');
  });

  it('đơn hàng và đại lý', () => {
    expect(copy.INVOICE_ISSUE_FAILED).toBe('Phát hành lỗi. Liên hệ Tubu để được hỗ trợ.');
    expect(copy.returnWindowExpired(7)).toBe('Đã quá hạn đổi/trả (7 ngày kể từ khi nhận hàng). Cần hỗ trợ thêm, liên hệ Tubu bên dưới.');
    expect(copy.DEALER_REJECTED_RESUBMIT).toBe('Hồ sơ trước bị từ chối. Kiểm tra lại thông tin rồi nộp lại.');
    expect(copy.DEALER_PRICE_LOADING).toBe('Đang tải bảng giá, đợi chút rồi dán đơn…');
  });

  it('vượt tồn ở thanh toán: còn hàng thì bảo sửa số lượng, hết hàng thì bảo bỏ khỏi giỏ', () => {
    expect(copy.overStockMessage('Dầu gội', 2)).toBe('Sản phẩm "Dầu gội" hiện còn 2 sản phẩm. Sửa số lượng trong giỏ để tiếp tục.');
    expect(copy.overStockMessage('Dầu gội', 0)).toBe('Sản phẩm "Dầu gội" đã hết hàng. Bỏ khỏi giỏ để đặt các món còn lại.');
  });

  it('gian hàng CTV, giới thiệu, hoàn tiền sàn', () => {
    expect(copy.STOREFRONT_TEMPLATE_HINT).toBe('Chọn danh mục gần với sản phẩm bạn muốn giới thiệu. Tubu tự thêm sẵn 8 sản phẩm nổi bật, bạn chỉnh sửa sau cũng được.');
    expect(copy.STOREFRONT_TEMPLATE_BUSY).toBe('Đang dựng…');
    expect(copy.ABOUT_MISSION).toBe('Tubu Tree tin rằng mỗi lựa chọn tiêu dùng nhỏ đều là một hạt mầm cho thiên nhiên. Tubu kết nối bạn với những thương hiệu Việt tử tế — minh bạch nguồn gốc, lành cho da, nhẹ với đất.');
    expect(copy.CASHBACK_REDIRECT).toBe('Đã ghi nhận hoàn tiền! Đang chuyển hướng sang sàn…');
  });

  it('chủ thương hiệu: tiêu đề và huy hiệu dùng "Thương hiệu"', () => {
    expect(copy.BRAND_OWNER_TITLE).toBe('Quản lý thương hiệu');
    expect(copy.BRAND_BADGE).toBe('Thương hiệu trên Tubu Tree');
  });

  it('màn chủ thương hiệu gọi một tên duy nhất: "thương hiệu", không "nhãn" (nhãn còn là nhãn dán ngoài hộp)', () => {
    const owner = strings().filter(([name]) => name.startsWith('BRAND_OWNER_'));
    expect(owner.length).toBeGreaterThan(5);
    expect(owner.filter(([, text]) => /nhãn/i.test(text)).map(([name]) => name)).toEqual([]);
    expect(copy.BRAND_OWNER_VIEW_PAGE).toBe('Xem trang thương hiệu');
    expect(copy.BRAND_OWNER_DRAFT).toBe('Thương hiệu đang là nháp — Tubu duyệt xong khách mới xem được.');
    expect(copy.BRAND_OWNER_SAVED).toBe('Đã lưu thông tin thương hiệu');
  });
});
