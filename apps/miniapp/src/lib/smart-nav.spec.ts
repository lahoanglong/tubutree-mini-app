// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canPop, historyIdx, isRootPath, previousPath, recordVisit, resetNavTrail, smartBack, smartNavigate, type NavigateLike } from './smart-nav';

/** Lịch sử giả: `idx` đúng như react-router ghi vào `history.state`. */
function setIdx(idx: number | undefined) {
  window.history.replaceState(idx === undefined ? null : { idx, key: `k${idx}`, usr: null }, '');
}
const fakeNavigate = () => vi.fn() as unknown as NavigateLike & ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetNavTrail();
  setIdx(0);
});

describe('isRootPath', () => {
  it('đúng 5 tab gốc của thanh đáy', () => {
    for (const p of ['/', '/browse', '/game', '/offers', '/profile']) expect(isRootPath(p)).toBe(true);
    for (const p of ['/wallet', '/cart', '/orders', '/offers/x', '/vouchers']) expect(isRootPath(p)).toBe(false);
  });
});

describe('historyIdx / canPop', () => {
  it('state rỗng hoặc idx 0 = mở thẳng, không có lịch sử', () => {
    setIdx(undefined);
    expect(historyIdx()).toBe(0);
    expect(canPop()).toBe(false);
    setIdx(0);
    expect(canPop()).toBe(false);
  });
  it('idx > 0 = còn lịch sử trong phiên', () => {
    setIdx(3);
    expect(historyIdx()).toBe(3);
    expect(canPop()).toBe(true);
  });
});

describe('smartBack', () => {
  it('Hồ sơ → Ví → Lùi: lùi thật một mục, không đẩy Hồ sơ lần nữa', () => {
    setIdx(2);
    const navigate = fakeNavigate();
    smartBack(navigate, '/profile');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(-1);
  });
  it('mở thẳng từ deep-link (idx 0): đi tới trang dự phòng bằng replace', () => {
    setIdx(0);
    const navigate = fakeNavigate();
    smartBack(navigate, '/cart');
    expect(navigate).toHaveBeenCalledWith('/cart', { replace: true });
  });
  it('không có state lịch sử: trang dự phòng mặc định là trang chủ', () => {
    setIdx(undefined);
    const navigate = fakeNavigate();
    smartBack(navigate);
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });
});

describe('smartNavigate: tab gốc', () => {
  it('chuyển từ tab gốc này sang tab gốc khác: replace, lịch sử không chồng thêm', () => {
    setIdx(1);
    const navigate = fakeNavigate();
    smartNavigate(navigate, '/', '/browse');
    expect(navigate).toHaveBeenCalledWith('/browse', { replace: true });
  });
  it('bấm lại đúng trang đang mở: replace, không nhân đôi', () => {
    const navigate = fakeNavigate();
    smartNavigate(navigate, '/offers', '/offers');
    expect(navigate).toHaveBeenCalledWith('/offers', { replace: true });
  });
  it('từ trang con vào tab gốc: đẩy như thường (Back còn về trang con)', () => {
    const navigate = fakeNavigate();
    smartNavigate(navigate, '/product/a', '/offers');
    expect(navigate).toHaveBeenCalledWith('/offers');
  });
  it('người gọi ghi rõ replace:false thì giữ đúng ý', () => {
    const navigate = fakeNavigate();
    smartNavigate(navigate, '/', '/browse', { replace: false });
    expect(navigate).toHaveBeenCalledWith('/browse', { replace: false });
  });
});

describe('smartNavigate: đích chính là trang ngay trước', () => {
  it('Giỏ → Thanh toán → bấm "Quay lại giỏ hàng": lùi một mục thay vì đẩy Giỏ thứ hai', () => {
    setIdx(1);
    recordVisit('/cart');
    setIdx(2);
    recordVisit('/checkout');
    expect(previousPath()).toBe('/cart');
    const navigate = fakeNavigate();
    smartNavigate(navigate, '/checkout', '/cart');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(-1);
  });
  it('Giỏ → Sản phẩm → bấm giỏ: lùi, không chồng Giỏ', () => {
    setIdx(1);
    recordVisit('/cart');
    setIdx(2);
    recordVisit('/product/rau-muong');
    const navigate = fakeNavigate();
    smartNavigate(navigate, '/product/rau-muong', '/cart');
    expect(navigate).toHaveBeenCalledWith(-1);
  });
  it('CTV → Học viện → bấm về CTV: lùi', () => {
    setIdx(1);
    recordVisit('/affiliate');
    setIdx(2);
    recordVisit('/academy');
    const navigate = fakeNavigate();
    smartNavigate(navigate, '/academy', '/affiliate');
    expect(navigate).toHaveBeenCalledWith(-1);
  });
  it('trang trước có query, đích không query: vẫn khớp theo pathname', () => {
    setIdx(1);
    recordVisit('/cart?x=1');
    setIdx(2);
    recordVisit('/checkout');
    const navigate = fakeNavigate();
    smartNavigate(navigate, '/checkout', '/cart');
    expect(navigate).toHaveBeenCalledWith(-1);
  });
  it('đích có query khác trang trước: không lùi nhầm sang tab khác, đẩy mới', () => {
    setIdx(1);
    recordVisit('/offers?tab=deals');
    setIdx(2);
    recordVisit('/loyalty');
    const navigate = fakeNavigate();
    smartNavigate(navigate, '/loyalty', '/offers?tab=wallet');
    expect(navigate).toHaveBeenCalledWith('/offers?tab=wallet');
  });
  it('đích khác trang trước: đẩy trang mới', () => {
    setIdx(1);
    recordVisit('/browse');
    setIdx(2);
    recordVisit('/product/a');
    const navigate = fakeNavigate();
    smartNavigate(navigate, '/product/a', '/cart');
    expect(navigate).toHaveBeenCalledWith('/cart');
  });
  it('mở thẳng (idx 0) dù vết còn cũ: đẩy trang mới, không lùi ra khỏi Mini App', () => {
    recordVisit('/cart');
    setIdx(0);
    const navigate = fakeNavigate();
    smartNavigate(navigate, '/checkout', '/cart', { prevPath: '/cart' });
    expect(navigate).toHaveBeenCalledWith('/cart');
  });
  it('có state cần mang theo: không lùi (state sẽ mất), đẩy mới', () => {
    setIdx(2);
    const navigate = fakeNavigate();
    smartNavigate(navigate, '/cart', '/checkout', { prevPath: '/checkout', state: { itemIds: ['a'] } });
    expect(navigate).toHaveBeenCalledWith('/checkout', { state: { itemIds: ['a'] } });
  });
  it('replace tường minh (sau đặt đơn): replace, không lùi', () => {
    setIdx(2);
    const navigate = fakeNavigate();
    smartNavigate(navigate, '/checkout', '/bank-payment/X1', { prevPath: '/bank-payment/X1', replace: true });
    expect(navigate).toHaveBeenCalledWith('/bank-payment/X1', { replace: true });
    expect(navigate).toHaveBeenCalledTimes(1);
  });
  it('prevPath truyền tay thắng vết (state.prevPath)', () => {
    setIdx(1);
    const navigate = fakeNavigate();
    smartNavigate(navigate, '/checkout', '/cart', { prevPath: '/cart' });
    expect(navigate).toHaveBeenCalledWith(-1);
  });
});
