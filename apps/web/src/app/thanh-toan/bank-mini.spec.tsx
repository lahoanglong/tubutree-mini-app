// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Màn VietQR ở điện thoại phải là Mini App (apps/miniapp/src/pages/bank-payment.tsx): tiêu đề trang, thẻ QR, các dòng kẻ,
// nút sao chép chỉ icon, lời nhắc có icon, các nút ngoài thẻ. jsdom không có media query nên kiểm bằng lớp `max-md:`/`md:`.

const mocks = vi.hoisted(() => ({ saveImage: vi.fn(), deadline: '2099-01-01T00:00:00.000Z' as string | null, qr: 'ok' as 'ok' | 'error' | 'pending', status: 'UNPAID' as string, failRefetch: false, calls: 0 }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({ code: 'TB-9' }), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getBankQr: async (code: string) => {
    if (mocks.qr === 'error') throw new Error('x');
    if (mocks.qr === 'pending') return new Promise<never>(() => {});
    mocks.calls += 1;
    if (mocks.failRefetch && mocks.calls > 1) throw new TypeError('Failed to fetch');
    return {
    orderCode: code, amount: 330000, paymentStatus: mocks.status, paymentDeadline: mocks.deadline,
    bank: { bin: '970407', name: 'Techcombank', accountNo: '9984606774', accountName: 'CONG TY TUBU TREE' },
    memo: code, qrString: 'x', qrImageUrl: 'https://img.vietqr.io/x.png',
    };
  },
}));

vi.mock('@/lib/platform-bridge', () => ({ platformBridge: { saveImage: (...a: unknown[]) => mocks.saveImage(...a) } }));

import BankPaymentPage from './chuyen-khoan/[code]/page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<BankPaymentPage />);
  mounted.push(r);
  await flush(6);
  return r.container;
};
beforeEach(() => {
  mocks.deadline = '2099-01-01T00:00:00.000Z';
  mocks.qr = 'ok';
  mocks.status = 'UNPAID';
  mocks.failRefetch = false;
  mocks.calls = 0;
  mocks.saveImage.mockReset().mockResolvedValue('saved');
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/thanh-toan/chuyen-khoan — chữ như Mini App', () => {
  it('tiêu đề trang "Quét QR để chuyển khoản" kèm phụ đề của Mini App, không lặp lại trong thẻ', async () => {
    const c = await mount();
    expect(c.querySelectorAll('h1')).toHaveLength(1);
    expect(c.querySelector('h1')!.textContent).toBe('Quét QR để chuyển khoản');
    expect(c.textContent).toContain('Lưu mã QR rồi mở app ngân hàng, chọn quét từ ảnh. Hoặc chép số tài khoản bên dưới.');
    expect(c.textContent!.match(/Quét QR để chuyển khoản/g)).toHaveLength(1);
  });

  it('nút chính "Tôi đã chuyển khoản — Kiểm tra" và nút phụ "Để sau / Xem đơn hàng"', async () => {
    const c = await mount();
    const buttons = Array.from(c.querySelectorAll<HTMLElement>('button, a'));
    expect(buttons.find((b) => b.textContent === 'Tôi đã chuyển khoản — Kiểm tra')).toBeDefined();
    expect(buttons.find((b) => b.textContent === 'Để sau / Xem đơn hàng')).toBeDefined();
  });
});

describe('/thanh-toan/chuyen-khoan — bố cục như Mini App ở điện thoại', () => {
  it('thẻ QR là một thẻ riêng; dòng chờ, nút chính và nút phụ nằm ngoài thẻ', async () => {
    const c = await mount();
    const card = c.querySelector<HTMLElement>('[data-bank-card]')!;
    expect(card.className).toMatch(/\bmax-md:rounded-card\b/);
    expect(card.querySelector('img[alt="VietQR"]')).not.toBeNull();
    const wait = c.querySelector<HTMLElement>('[data-testid="bank-poll-status"]')!;
    const primary = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Tôi đã chuyển khoản — Kiểm tra')!;
    expect(card.contains(wait)).toBe(false);
    expect(card.contains(primary)).toBe(false);
    expect(primary.className).toMatch(/\bw-full\b/);
    expect(c.querySelector('section')!.className).toMatch(/\bmax-md:contents\b/);
  });

  it('số tiền màu xanh, có nút Lưu mã QR ở điện thoại (R-8)', async () => {
    const c = await mount();
    const money = c.querySelector<HTMLElement>('[data-bank-card] p.font-bold')!;
    expect(money.className).toMatch(/\bmax-md:text-success-fg\b/);
    const save = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('Lưu mã QR'))!;
    expect(save.className).not.toMatch(/\bmax-md:hidden\b/);
  });

  it('các dòng thông tin có đường kẻ phía trên; sao chép chỉ là icon', async () => {
    const c = await mount();
    const rows = Array.from(c.querySelectorAll<HTMLElement>('[data-bank-row]'));
    expect(rows.length).toBe(5);
    for (const r of rows) expect(r.className).toMatch(/\bmax-md:border-t\b/);
    const icon = c.querySelector<HTMLElement>('button[aria-label="Sao chép số tài khoản"]')!;
    expect(icon.textContent).toBe('');
    expect(icon.className).toMatch(/\bmd:hidden\b/);
    expect(c.querySelector('button[aria-label="Sao chép: 9984606774"]')!.parentElement!.className).toMatch(/\bmax-md:hidden\b/);
  });

  it('lời nhắc giữ nội dung có icon cảnh báo và căn trái', async () => {
    const c = await mount();
    const note = c.querySelector<HTMLElement>('[data-testid="memo-note"]')!;
    expect(note.textContent).toMatch(/^Giữ nguyên nội dung/);
    expect(note.querySelector('svg')).not.toBeNull();
    expect(note.className).toMatch(/\btext-left\b/);
  });

  it('hạn chuyển khoản là hộp nền cảnh báo ngoài thẻ', async () => {
    const c = await mount();
    const note = c.querySelector<HTMLElement>('[role="note"]')!;
    expect(note.parentElement!.className).toMatch(/\bmax-md:bg-\[var\(--color-status-warning-bg\)\]/);
    expect(c.querySelector('[data-bank-card]')!.contains(note)).toBe(false);
  });
});

describe('/thanh-toan/chuyen-khoan — tiêu đề khi chưa có QR để quét', () => {
  it('QR không tải được: h1 trung tính, không phụ đề "quét mã VietQR bên dưới"', async () => {
    mocks.qr = 'error';
    const c = await mount();
    expect(c.textContent).toContain('Chưa tải được thông tin thanh toán');
    expect(c.querySelector('h1')!.textContent).toBe('Thanh toán chuyển khoản');
    expect(c.textContent).not.toContain('quét mã VietQR bên dưới');
  });

  it('QR đang tải: h1 trung tính', async () => {
    mocks.qr = 'pending';
    const c = await mount();
    expect(c.querySelector('h1')!.textContent).toBe('Thanh toán chuyển khoản');
  });
});

describe('/thanh-toan/chuyen-khoan — sao chép ở điện thoại', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('clipboard bị chặn: báo không sao chép được, không báo "Đã sao chép"', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const c = await mount();
    c.querySelector<HTMLElement>('button[aria-label="Sao chép số tài khoản"]')!.click();
    await flush(4);
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Không thể sao chép số tài khoản. Vui lòng sao chép thủ công.');
    expect(c.querySelector('[role="alert"]')!.classList.contains('sr-only')).toBe(false);
    expect(c.textContent).not.toContain('Đã sao chép');
  });

  it('clipboard ghi được: báo "Đã sao chép" và không có lời báo lỗi', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const c = await mount();
    c.querySelector<HTMLElement>('button[aria-label="Sao chép số tài khoản"]')!.click();
    await flush(4);
    expect(c.textContent).toContain('Đã sao chép số tài khoản');
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('/thanh-toan/chuyen-khoan — bố cục điện thoại như Mini App (R-8)', () => {
  it('số tiền to kèm nút chép icon; dòng "Số tiền" chỉ còn từ md', async () => {
    const c = await mount();
    const hero = c.querySelector<HTMLElement>('[data-bank-card] p.font-bold')!;
    const copy = hero.parentElement!.querySelector<HTMLElement>('button[aria-label="Sao chép số tiền"]')!;
    expect(copy.className).toMatch(/\bmd:hidden\b/);
    const rows = Array.from(c.querySelectorAll<HTMLElement>('[data-bank-row]'));
    const amountRow = rows.find((r) => r.textContent?.startsWith('Số tiền'))!;
    expect(amountRow.className).toMatch(/\bmax-md:hidden\b/);
  });

  it('Ngân hàng và Chủ tài khoản xếp dọc ở điện thoại, Số tài khoản vẫn nằm ngang', async () => {
    const c = await mount();
    const rows = Array.from(c.querySelectorAll<HTMLElement>('[data-bank-row]'));
    const by = (label: string) => rows.find((r) => r.textContent?.startsWith(label))!;
    expect(by('Ngân hàng').className).toMatch(/\bmax-md:flex-col\b/);
    expect(by('Chủ tài khoản').className).toMatch(/\bmax-md:flex-col\b/);
    expect(by('Số tài khoản').className).not.toMatch(/max-md:flex-col/);
  });

  it('nút Lưu mã QR rộng hết thẻ; nút Kiểm tra dính đáy ở điện thoại, nút trong trang chỉ từ md', async () => {
    const c = await mount();
    const save = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('Lưu mã QR'))!;
    expect(save.className).toMatch(/\bmax-md:w-full\b/);
    const bar = c.querySelector('[data-testid="sticky-bar"]')!;
    expect(bar.querySelector('button')!.textContent).toBe('Tôi đã chuyển khoản — Kiểm tra');
    const inline = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Tôi đã chuyển khoản — Kiểm tra' && !bar.contains(b))!;
    expect(inline.className).toMatch(/\bmax-md:hidden\b/);
  });

  it('Lưu mã QR đi qua cầu nối nền tảng và chặn bấm đúp khi đang lưu', async () => {
    let done: (v: 'saved') => void = () => {};
    mocks.saveImage.mockReturnValue(new Promise((r) => (done = r)));
    const c = await mount();
    const save = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('Lưu mã QR'))! as HTMLButtonElement;
    save.click();
    save.click();
    await flush(2);
    expect(mocks.saveImage).toHaveBeenCalledTimes(1);
    expect(mocks.saveImage).toHaveBeenCalledWith('https://img.vietqr.io/x.png', 'tubu-qr-TB-9.png');
    done('saved');
    await flush(2);
    expect(c.querySelector('[data-testid="bank-qr-saved"]')).not.toBeNull();
  });

  // Nút Kiểm tra dính đáy: lời báo nằm trong dòng chảy sẽ ở dưới mép màn, nên phải hiện ngay trong thanh dính.
  it('bấm Kiểm tra khi chưa thấy tiền: lời báo hiện trong thanh dính đáy, ngay trên nút', async () => {
    const c = await mount();
    const bar = c.querySelector('[data-testid="sticky-bar"]')!;
    bar.querySelector('button')!.click();
    await flush(6);
    expect(bar.querySelector('[data-testid="bank-check-result-sticky"]')?.textContent).toContain('Chưa thấy tiền về');
  });

  it('bấm Kiểm tra gặp lỗi mạng: lỗi hiện trong thanh dính đáy', async () => {
    const c = await mount();
    mocks.failRefetch = true;
    const bar = c.querySelector('[data-testid="sticky-bar"]')!;
    bar.querySelector('button')!.click();
    await flush(6);
    expect(bar.querySelector('[data-testid="bank-check-result-sticky"]')?.textContent).toMatch(/không kết nối|kiểm tra mạng/i);
  });

  it('cầu nối lưu ảnh reject (mất chunk): báo chưa lưu được, không rơi thành lỗi chưa bắt', async () => {
    mocks.saveImage.mockRejectedValue(new Error('chunk lost'));
    const c = await mount();
    const save = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('Lưu mã QR'))! as HTMLButtonElement;
    save.click();
    await flush(4);
    expect(c.querySelector('[data-testid="bank-qr-saved"]')?.textContent).toContain('Chưa lưu được');
    expect(save.disabled).toBe(false);
  });
});
