import { describe, it, expect } from 'vitest';
import {
  intervalLabel,
  personLabel,
  reviewStarCount,
  safeHttpsLink,
  subscriptionStatusLabel,
  tierOptionLabel,
  userOptionLabel,
  variationLabel,
  variationOptionLabel,
} from './admin-pickers';

describe('variationOptionLabel', () => {
  it('ghép biến thể, SKU, giá đang bán và tồn kho', () => {
    expect(variationOptionLabel({ id: 'v1', name: 'Chai 500ml', sku: 'NRC-500', price: 80_000, stock: 5, isActive: true })).toBe(
      'Chai 500ml · NRC-500 · 80.000đ · tồn 5',
    );
  });

  it('biến thể đang ẩn / hết hàng nói rõ để admin không thêm nhầm vào Flash Sale', () => {
    expect(variationOptionLabel({ id: 'v1', name: 'Chai', sku: 'A', price: 1000, stock: 0, isActive: false })).toBe(
      'Chai · A · 1.000đ · hết hàng · đang ẩn',
    );
  });
});

describe('variationLabel', () => {
  it('nhãn đầy đủ "Sản phẩm · Biến thể (SKU)" cho Variation ID đã lưu', () => {
    expect(variationLabel({ id: 'v1', name: 'Chai 500ml', sku: 'NRC-500', productId: 'p1', productName: 'Nước rửa chén' })).toBe(
      'Nước rửa chén · Chai 500ml (NRC-500)',
    );
  });

  it('id không tra được (đã xoá) → nói rõ thay vì in mỗi id trần', () => {
    expect(variationLabel(undefined, 'cmabc123')).toBe('Biến thể không còn tồn tại (cmabc123)');
  });
});

describe('userOptionLabel', () => {
  it('tên + SĐT; thiếu thì có chữ thay thế', () => {
    expect(userOptionLabel({ id: 'u1', fullName: 'Nguyễn An', phone: '0900000001', role: 'CUSTOMER', pointsBalance: 0, createdAt: '' })).toBe(
      'Nguyễn An · 0900000001',
    );
    expect(userOptionLabel({ id: 'u2', fullName: null, phone: null, role: 'CUSTOMER', pointsBalance: 0, createdAt: '' })).toBe(
      'Chưa có tên · chưa có SĐT',
    );
  });
});

describe('personLabel', () => {
  it('chữ thay thế cho tên tuỳ ngữ cảnh (nhân viên / thành viên)', () => {
    expect(personLabel(null, null, 'Thành viên')).toBe('Thành viên · chưa có SĐT');
    expect(personLabel('  Thu Hà ', '0900000002')).toBe('Thu Hà · 0900000002');
  });
});

describe('tierOptionLabel', () => {
  it('tên bậc, mốc doanh số, hạn mức công nợ và kỳ hạn', () => {
    expect(
      tierOptionLabel({ id: 'dealer_l3', name: 'Đại lý cấp 3', minOrderVolume: 50_000_000, creditLimit: 20_000_000, paymentTerms: 'NET30' }),
    ).toBe('Đại lý cấp 3 · từ 50.000.000đ · hạn mức công nợ 20.000.000đ · NET30');
  });

  it('bậc không cấp công nợ không in hạn mức 0đ', () => {
    expect(tierOptionLabel({ id: 't', name: 'Bậc 1', minOrderVolume: 0, creditLimit: 0, paymentTerms: null })).toBe('Bậc 1 · từ 0đ · không cấp công nợ');
  });
});

describe('safeHttpsLink', () => {
  it('chỉ nhận https; javascript:/data:/http bị bỏ (video do khách gửi)', () => {
    expect(safeHttpsLink('https://cdn.example.com/v.mp4')).toBe('https://cdn.example.com/v.mp4');
    expect(safeHttpsLink('javascript:alert(1)')).toBeNull();
    expect(safeHttpsLink('http://x.vn/a')).toBeNull();
    expect(safeHttpsLink('data:text/html,<script>')).toBeNull();
    expect(safeHttpsLink(' https://x.vn')).toBeNull();
    expect(safeHttpsLink(null)).toBeNull();
  });
});

describe('reviewStarCount', () => {
  it('số sao tô đầy, kẹp trong 0..5 và làm tròn', () => {
    expect(reviewStarCount(3)).toBe(3);
    expect(reviewStarCount(9)).toBe(5);
    expect(reviewStarCount(-1)).toBe(0);
    expect(reviewStarCount(3.6)).toBe(4);
  });
});

describe('subscription labels', () => {
  it('trạng thái và chu kỳ bằng tiếng Việt', () => {
    expect(subscriptionStatusLabel('ACTIVE')).toBe('Đang chạy');
    expect(subscriptionStatusLabel('PAUSED')).toBe('Tạm dừng');
    expect(subscriptionStatusLabel('CANCELLED')).toBe('Đã huỷ');
    expect(subscriptionStatusLabel('LẠ')).toBe('LẠ');
    expect(intervalLabel(4)).toBe('4 tuần/lần');
  });
});
