// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Màn VietQR ở điện thoại phải là Mini App (apps/miniapp/src/pages/bank-payment.tsx): tiêu đề trang, thẻ QR, các dòng kẻ,
// nút sao chép chỉ icon, lời nhắc có icon, các nút ngoài thẻ. jsdom không có media query nên kiểm bằng lớp `max-md:`/`md:`.

const mocks = vi.hoisted(() => ({ deadline: '2099-01-01T00:00:00.000Z' as string | null }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({ code: 'TB-9' }), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getBankQr: async (code: string) => ({
    orderCode: code, amount: 330000, paymentStatus: 'UNPAID', paymentDeadline: mocks.deadline,
    bank: { bin: '970407', name: 'Techcombank', accountNo: '9984606774', accountName: 'CONG TY TUBU TREE' },
    memo: code, qrString: 'x', qrImageUrl: 'https://img.vietqr.io/x.png',
  }),
}));

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
    expect(c.textContent).toContain('Mở app ngân hàng / ví bất kỳ → quét mã VietQR bên dưới');
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

  it('số tiền màu xanh, không có nút Lưu mã QR ở điện thoại', async () => {
    const c = await mount();
    const money = c.querySelector<HTMLElement>('[data-bank-card] p.font-bold')!;
    expect(money.className).toMatch(/\bmax-md:text-success-fg\b/);
    const save = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('Lưu mã QR'))!;
    expect(save.className).toMatch(/\bmax-md:hidden\b/);
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
    const note = Array.from(c.querySelectorAll<HTMLElement>('p')).find((p) => p.textContent?.startsWith('Giữ nguyên nội dung'))!;
    expect(note.querySelector('svg')).not.toBeNull();
    expect(note.className).toMatch(/\bmax-md:text-left\b/);
  });

  it('hạn chuyển khoản là hộp nền cảnh báo ngoài thẻ', async () => {
    const c = await mount();
    const note = c.querySelector<HTMLElement>('[role="note"]')!;
    expect(note.parentElement!.className).toMatch(/\bmax-md:bg-\[var\(--color-status-warning-bg\)\]/);
    expect(c.querySelector('[data-bank-card]')!.contains(note)).toBe(false);
  });
});
