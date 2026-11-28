// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_CLAIM_COPY as COPY, MARKETPLACE_CLAIM_WEB_COPY as WEB, PHONE_CONFIRM_COPY } from '@tubutree/app-core/marketplace-claim-copy';
import { MARKETPLACE_SCAN_COPY } from '@tubutree/app-core/marketplace-scan-guide';
import { ApiError } from '@/lib/client-api';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

const ON = { isLoaded: true, loyalty: { marketplaceEarnPct: 5, marketplaceClaimEnabled: true } };
const EMPTY_LIST = { data: [], meta: { page: 1, limit: 10, total: 0 }, searching: [] };
const mocks = vi.hoisted(() => ({
  cfg: {} as Record<string, unknown>,
  phase: 'authenticated' as string,
  me: { phone: '0901234567' } as Record<string, unknown>,
  loyalty: { pointsBalance: 0 } as Record<string, unknown>,
  list: {} as unknown,
  post: vi.fn(),
  patch: vi.fn(),
  get: vi.fn(),
  push: vi.fn(),
  zxDecode: vi.fn((): string[] => []),
}));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/components/ui/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/components/login-required', () => ({ SessionUnavailable: () => <p data-testid="session-unavailable" /> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: (path: string, opts?: unknown) => mocks.get(path, opts),
    post: (path: string, body?: unknown) => mocks.post(path, body),
    patch: (path: string, body?: unknown) => mocks.patch(path, body),
  },
}));
// Bộ đọc JS (ZXing) chỉ nạp khi máy không có BarcodeDetector; jsdom không có canvas nên giả lập kết quả đọc.
vi.mock('@/lib/code-scan-zxing', () => ({ createDecoder: () => ({ decodeSource: (...args: unknown[]) => mocks.zxDecode(...(args as [])) }) }));

import { ScanView, scanLoginHref, scanMiniLink, scanReturnPath } from './scan-view';

let mounted: Rendered | null = null;
const mount = async () => {
  mounted = render(<ScanView />);
  await flush(4);
  return mounted.container;
};
const input = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[type="text"]');
const buttonByText = (c: ParentNode, text: string) => Array.from(c.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(text)) ?? null;
const submitBtn = (c: HTMLElement) => buttonByText(c, COPY.submit)!;
const openManual = (c: HTMLElement) => click(c.querySelector('[data-testid="claim-manual-toggle"]'));
const sheet = () => document.querySelector<HTMLElement>('[data-testid="phone-confirm-sheet"]');
const last4Input = () => document.querySelector<HTMLInputElement>('[data-testid="phone-confirm-input"]');
const submitForm = async (c: HTMLElement) => {
  act(() => void submitBtn(c).click());
  await flush(4);
};
const claimed = (over: Record<string, unknown> = {}) => ({
  status: 'CLAIMED',
  claimId: 'c1',
  channel: 'Shopee',
  maskedCode: 'SPX***789',
  points: 1250,
  expectedCreditAt: new Date(Date.now() + 7 * 864e5).toISOString(),
  message: 'ok',
  ...over,
});

beforeEach(() => {
  mocks.cfg = ON;
  mocks.phase = 'authenticated';
  mocks.me = { phone: '0901234567' };
  mocks.loyalty = { pointsBalance: 0 };
  mocks.list = EMPTY_LIST;
  mocks.post.mockReset();
  mocks.patch.mockReset();
  mocks.zxDecode.mockReset();
  mocks.zxDecode.mockReturnValue([]);
  mocks.push.mockReset();
  mocks.get.mockReset();
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/me') return mocks.me;
    if (path === '/me/loyalty') return mocks.loyalty;
    if (path === '/me/external-points/claims') return mocks.list;
    throw new Error(`chưa mock ${path}`);
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  window.history.replaceState(null, '', '/');
});

describe('/quet-ma — tab giữa Quét mã của web (W42)', () => {
  it('hướng dẫn 3 bước cùng chữ với Mini App, tỉ lệ đọc từ cấu hình công khai', async () => {
    const c = await mount();
    const guide = c.querySelector('[data-testid="scan-guide"]')!;
    expect(guide.getAttribute('aria-label')).toBe(MARKETPLACE_SCAN_COPY.guideTitle);
    const steps = Array.from(guide.querySelectorAll('.tubu-scan-guide__text')).map((s) => s.textContent);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toBe(MARKETPLACE_SCAN_COPY.step1);
    expect(steps[1]).toContain('5%');
    expect(steps[2]).toBe(MARKETPLACE_SCAN_COPY.step3);
  });

  it('cấu hình thiếu tỉ lệ: bước 2 không hứa con số', async () => {
    mocks.cfg = { isLoaded: true, loyalty: { marketplaceClaimEnabled: true } };
    const steps = Array.from((await mount()).querySelectorAll('.tubu-scan-guide__text')).map((s) => s.textContent);
    expect(steps[1]).toBe(MARKETPLACE_SCAN_COPY.step2Plain);
  });

  it('cấu hình chưa về: chỉ tiêu đề, chưa hướng dẫn, nút hay ô nhập', async () => {
    mocks.cfg = { isLoaded: false };
    const c = await mount();
    expect(c.querySelector('h1')?.textContent).toBe('Tích điểm đơn sàn');
    expect(c.querySelector('[data-testid="scan-guide"]')).toBeNull();
    expect(c.querySelector('a')).toBeNull();
    expect(c.querySelector('input')).toBeNull();
    expect(c.querySelector('[data-testid="scan-soon"]')).toBeNull();
  });

  it('cờ tích điểm đơn sàn tắt: báo sắp mở (nhắc cả web lẫn Zalo), không hứa tỉ lệ, không ô nhập', async () => {
    mocks.cfg = { isLoaded: true, loyalty: { marketplaceEarnPct: 5, marketplaceClaimEnabled: false } };
    const c = await mount();
    const soon = c.querySelector('[data-testid="scan-soon"]')!;
    expect(soon.textContent).toContain(MARKETPLACE_SCAN_COPY.soonTitle);
    expect(soon.textContent).toContain('trên web');
    expect(c.querySelector('[data-testid="scan-guide"]')).toBeNull();
    expect(c.textContent).not.toContain('5%');
    expect(c.querySelector('input')).toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe('/quet-ma — khách chưa đăng nhập (W44 U5)', () => {
  beforeEach(() => {
    mocks.phase = 'guest';
  });

  it('một nút chính "Đăng nhập để tích điểm" quay lại đúng trang, giữ utm_source và card, bỏ tham số lạ; lối phụ mở màn quét Mini App', async () => {
    window.history.replaceState(null, '', '/quet-ma?utm_source=shopee&card=box-2026-11&fbclid=abc');
    const c = await mount();
    const login = c.querySelector<HTMLAnchorElement>('[data-testid="scan-login"] a[href^="/dang-nhap"]')!;
    expect(login.textContent).toBe(WEB.loginCta);
    const returnTo = new URL(new URL(login.getAttribute('href')!, 'http://x').searchParams.get('returnTo')!, 'http://x');
    expect(returnTo.pathname).toBe('/quet-ma');
    expect(Object.fromEntries(returnTo.searchParams)).toEqual({ utm_source: 'shopee', card: 'box-2026-11' });
    const mini = Array.from(c.querySelectorAll<HTMLAnchorElement>('a')).find((a) => a.textContent === WEB.openMiniAlt)!;
    const url = new URL(mini.getAttribute('href')!);
    expect(url.pathname.endsWith('/points/scan')).toBe(true);
    expect(Object.fromEntries(url.searchParams)).toEqual({ utm_source: 'shopee', card: 'box-2026-11' });
    expect(c.querySelector('input')).toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('scanReturnPath giữ cả code điền sẵn, bỏ stay và tham số lạ', () => {
    expect(scanReturnPath('?code=SPXVN0123456789&stay=web&x=1')).toBe('/quet-ma?code=SPXVN0123456789');
    expect(scanReturnPath('')).toBe('/quet-ma');
  });

  it('tham số nguồn quá dài (safeReturnPath từ chối): vẫn quay về /quet-ma, không rơi về Trang chủ', () => {
    const href = scanLoginHref(`?utm_content=${'x'.repeat(600)}`);
    expect(new URL(href, 'http://x').searchParams.get('returnTo')).toBe('/quet-ma');
    expect(new URL(scanLoginHref('?card=2611'), 'http://x').searchParams.get('returnTo')).toBe('/quet-ma?card=2611');
  });

  it('link sang Mini App mang theo mã điền sẵn (đã chuẩn hoá), bỏ mã sai dạng', () => {
    const withCode = new URL(scanMiniLink('?utm_source=shopee&code=spx-vn-0123456789'));
    expect(withCode.pathname.endsWith('/points/scan')).toBe(true);
    expect(Object.fromEntries(withCode.searchParams)).toEqual({ utm_source: 'shopee', code: 'SPXVN0123456789' });
    expect(new URL(scanMiniLink('?code=SPXVN0123456789')).searchParams.get('code')).toBe('SPXVN0123456789');
    expect(new URL(scanMiniLink('?code=abc')).searchParams.has('code')).toBe(false);
  });

  it('phiên chưa khôi phục được (mất mạng): không mời đăng nhập lại', async () => {
    mocks.phase = 'unavailable';
    const c = await mount();
    expect(c.querySelector('[data-testid="session-unavailable"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="scan-login"]')).toBeNull();
  });
});

describe('/quet-ma — đã đăng nhập: quét và tích điểm ngay trên web (W44 U5, W46 camera trước)', () => {
  it('khung quét ở đầu thẻ, ô nhập mã gập sau "Nhập mã thủ công"; máy không có API camera: nút chụp/chọn ảnh giữa khung là nút chính', async () => {
    const c = await mount();
    const scanner = c.querySelector('[data-testid="claim-scanner"]')!;
    expect(scanner.querySelector('video')).not.toBeNull();
    expect(buttonByText(c, WEB.cameraStart)).toBeNull();
    expect(buttonByText(scanner, WEB.photoCta)!.className).toContain('zaui-btn-primary');
    expect(scanner.querySelector('[data-testid="claim-scanner-message"]')?.textContent).toBe(WEB.cameraUnavailable);
    expect(input(c)).toBeNull();
    const toggle = c.querySelector('[data-testid="claim-manual-toggle"]')!;
    expect(toggle.textContent).toBe(WEB.manualCta);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    openManual(c);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(input(c)?.getAttribute('placeholder')).toBe(COPY.inputPlaceholder);
    expect(c.textContent).toContain(COPY.inputLabel);
    expect(submitBtn(c)).not.toBeNull();
    expect(c.querySelector('[data-testid="claim-history"]')?.textContent).toContain(WEB.historyTitle);
    expect(c.textContent).toContain(COPY.listEmpty);
  });

  it('gõ mã đúng dạng thì Tích điểm thành nút chính; gửi xong: thẻ kết quả, làm mới lịch sử, nút "Mua sắm ngay" khi chưa có điểm', async () => {
    mocks.post.mockResolvedValue(claimed());
    const c = await mount();
    openManual(c);
    expect(submitBtn(c).className).not.toContain('zaui-btn-primary');
    typeInto(input(c), ' spxvn123456789 ');
    expect(submitBtn(c).className).toContain('zaui-btn-primary');
    const listCalls = () => mocks.get.mock.calls.filter(([p]) => p === '/me/external-points/claims').length;
    const before = listCalls();
    await submitForm(c);
    expect(mocks.post).toHaveBeenCalledWith('/me/external-points/claims', { code: 'spxvn123456789', via: 'typed' });
    const result = c.querySelector('[data-testid="claim-result"]')!;
    expect(result.textContent).toContain('Đã ghi nhận đơn Shopee SPX***789');
    expect(result.textContent).toContain('1.250 Điểm Xanh đang chờ cộng');
    expect(listCalls()).toBeGreaterThan(before);
    const cta = c.querySelector('[data-testid="scan-shop-now"]')!;
    expect(cta.textContent).toBe('Mua sắm ngay');
    expect(input(c)!.value).toBe('');
    click(cta.querySelector('button'));
    expect(mocks.push).toHaveBeenCalledWith('/');
  });

  it('đang có 1.200 điểm dùng được: nút nói "đang có", khác số "đang chờ cộng" của đơn vừa quét', async () => {
    mocks.loyalty = { pointsBalance: 1000, pointsMarketplaceBalance: 200, lockedPoints: 0 };
    mocks.post.mockResolvedValue(claimed());
    const c = await mount();
    openManual(c);
    typeInto(input(c), 'SPXVN123456789');
    await submitForm(c);
    expect(c.querySelector('[data-testid="scan-shop-now"]')?.textContent).toBe('Dùng 1.200 Điểm Xanh đang có');
  });

  it('chưa thấy đơn (SEARCHING): báo sẽ tìm lại, không có nút mua sắm', async () => {
    mocks.post.mockResolvedValue(claimed({ status: 'SEARCHING', claimId: null, channel: null, points: null, expectedCreditAt: null }));
    const c = await mount();
    openManual(c);
    typeInto(input(c), 'SPXVN123456789');
    await submitForm(c);
    expect(c.querySelector('[data-testid="claim-result"]')?.textContent).toContain(COPY.resultSearching);
    expect(c.querySelector('[data-testid="scan-shop-now"]')).toBeNull();
  });

  it('đơn cần kiểm tra (REVIEW): câu đang kiểm tra, vẫn mời mua sắm', async () => {
    mocks.post.mockResolvedValue(claimed({ status: 'REVIEW', points: null, expectedCreditAt: null }));
    const c = await mount();
    openManual(c);
    typeInto(input(c), 'SPXVN123456789');
    await submitForm(c);
    expect(c.querySelector('[data-testid="claim-result"]')?.textContent).toContain(COPY.resultReview);
    expect(c.querySelector('[data-testid="scan-shop-now"]')).not.toBeNull();
  });

  it('từ chối theo code dùng chung câu với Mini App: SĐT không khớp (đường cũ, không hỏi 4 số)', async () => {
    mocks.post.mockRejectedValue(new ApiError('máy chủ', 409, 'PHONE_MISMATCH'));
    const c = await mount();
    openManual(c);
    typeInto(input(c), 'SPXVN123456789');
    await submitForm(c);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(COPY.reject.PHONE_MISMATCH);
    expect(c.textContent).not.toContain('máy chủ');
    expect(c.querySelector('[data-testid="claim-result"]')).toBeNull();
    expect(sheet()).toBeNull();
  });

  it('gửi nhanh quá (429): câu chờ một phút', async () => {
    mocks.post.mockRejectedValue(new ApiError('Too Many Requests', 429));
    const c = await mount();
    openManual(c);
    typeInto(input(c), 'SPXVN123456789');
    await submitForm(c);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(WEB.rateLimited);
  });

  it('NOT_ELIGIBLE_USER (SĐT chưa xác minh qua Zalo): nói thật lý do, có lối xác minh trên Zalo', async () => {
    mocks.post.mockRejectedValue(new ApiError('máy chủ', 403, 'NOT_ELIGIBLE_USER'));
    const c = await mount();
    openManual(c);
    typeInto(input(c), 'SPXVN123456789');
    await submitForm(c);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(WEB.notVerified);
    const verify = c.querySelector<HTMLAnchorElement>('[data-testid="claim-verify-zalo"]')!;
    expect(new URL(verify.href).pathname.endsWith('/points/scan')).toBe(true);
  });

  it('mã trống: nhắc nhập, không gọi API', async () => {
    const c = await mount();
    openManual(c);
    await submitForm(c);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(COPY.emptyCode);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('bấm Tích điểm hai lần sát nhau: chỉ gửi một lần', async () => {
    let resolve!: (v: unknown) => void;
    mocks.post.mockImplementation(() => new Promise((r) => (resolve = r)));
    const c = await mount();
    openManual(c);
    typeInto(input(c), 'SPXVN123456789');
    act(() => {
      submitBtn(c).click();
      submitBtn(c).click();
    });
    await flush(2);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await act(async () => resolve(claimed()));
    await flush(3);
    expect(c.querySelectorAll('[data-testid="claim-result"]')).toHaveLength(1);
  });

  it('?code= hợp lệ: ô nhập mở sẵn, điền mã (chuẩn hoá) và gửi với via=scan, không tự gửi', async () => {
    window.history.replaceState(null, '', '/quet-ma?code=spx-vn-0123456789');
    mocks.post.mockResolvedValue(claimed());
    const c = await mount();
    expect(input(c)!.value).toBe('SPXVN0123456789');
    expect(submitBtn(c).className).toContain('zaui-btn-primary');
    expect(mocks.post).not.toHaveBeenCalled();
    await submitForm(c);
    expect(mocks.post).toHaveBeenCalledWith('/me/external-points/claims', { code: 'SPXVN0123456789', via: 'scan' });
  });

  it('?code= sai dạng: ô nhập mở sẵn để trống, báo link không đúng dạng', async () => {
    window.history.replaceState(null, '', '/quet-ma?code=abc');
    const c = await mount();
    expect(input(c)!.value).toBe('');
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(COPY.codeLinkInvalid);
  });

  it('tài khoản chưa có SĐT (W45): nhập số ngay trên màn quét, chưa có khung quét; lối phụ xác minh trên Zalo; vẫn xem được lịch sử', async () => {
    mocks.me = { phone: null };
    const c = await mount();
    const prompt = c.querySelector('[data-testid="scan-phone-prompt"]')!;
    expect(prompt.textContent).toContain(WEB.phoneTitle);
    expect(prompt.querySelector<HTMLInputElement>('input[type="tel"]')).not.toBeNull();
    expect(buttonByText(prompt, WEB.phoneSave)!.className).toContain('zaui-btn-primary');
    const alt = Array.from(prompt.querySelectorAll<HTMLAnchorElement>('a')).find((a) => a.textContent === WEB.phoneAlt)!;
    expect(new URL(alt.href).pathname.endsWith('/points/scan')).toBe(true);
    expect(c.querySelector('[data-testid="claim-scanner"]')).toBeNull();
    expect(c.querySelector('[data-testid="claim-history"]')).not.toBeNull();
  });

  it('nhập SĐT sai dạng: báo ngay, không gọi API; đúng dạng: lưu SĐT liên hệ rồi hiện khung quét (W59: không còn ghi chú CSKH đối chiếu)', async () => {
    mocks.me = { phone: null };
    const c = await mount();
    const tel = () => c.querySelector<HTMLInputElement>('[data-testid="scan-phone-prompt"] input[type="tel"]');
    typeInto(tel(), '12345');
    act(() => void buttonByText(c, WEB.phoneSave)!.click());
    await flush(2);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(WEB.phoneInvalid);
    expect(mocks.patch).not.toHaveBeenCalled();
    mocks.patch.mockImplementation(async () => {
      mocks.me = { phone: '0912345678', phoneVerified: false };
      return mocks.me;
    });
    typeInto(tel(), '0912 345 678');
    act(() => void buttonByText(c, WEB.phoneSave)!.click());
    await flush(6);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.patch).toHaveBeenCalledWith('/me/contact-phone', { phone: '0912345678' });
    expect(c.querySelector('[data-testid="scan-phone-prompt"]')).toBeNull();
    expect(c.querySelector('[data-testid="claim-scanner"]')).not.toBeNull();
    expect(c.textContent).not.toContain('CSKH đối chiếu');
  });

  it('lưu SĐT bị từ chối (số đã thuộc tài khoản khác): hiện lời máy chủ, vẫn ở bước nhập số', async () => {
    mocks.me = { phone: null };
    mocks.patch.mockRejectedValue(new ApiError('Số điện thoại này đã được dùng cho tài khoản khác.', 409));
    const c = await mount();
    typeInto(c.querySelector('[data-testid="scan-phone-prompt"] input[type="tel"]'), '0912345678');
    act(() => void buttonByText(c, WEB.phoneSave)!.click());
    await flush(4);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Số điện thoại này đã được dùng cho tài khoản khác.');
    expect(c.querySelector('[data-testid="scan-phone-prompt"]')).not.toBeNull();
  });

  it('W59: SĐT liên hệ chưa xác minh không còn câu "CSKH đối chiếu" (khớp SĐT là chờ cộng ngay)', async () => {
    mocks.me = { phone: '0912345678', phoneVerified: false };
    const c = await mount();
    expect(c.querySelector('[data-testid="claim-scanner"]')).not.toBeNull();
    expect(c.textContent).not.toContain('CSKH đối chiếu');
  });

  it('SĐT chưa xác minh gửi mã khớp: máy chủ trả REVIEW (không còn 403), thẻ kết quả nói đang kiểm tra', async () => {
    mocks.me = { phone: '0912345678', phoneVerified: false };
    mocks.post.mockResolvedValue(claimed({ status: 'REVIEW', points: 1250, expectedCreditAt: null }));
    const c = await mount();
    openManual(c);
    typeInto(input(c), 'SPXVN123456789');
    await submitForm(c);
    expect(c.querySelector('[data-testid="claim-result"]')?.textContent).toContain(COPY.resultReview);
    expect(c.querySelector('[data-testid="claim-error"]')).toBeNull();
  });

  it('lịch sử: nhãn trạng thái, điểm, đang tìm đơn và phân trang', async () => {
    mocks.list = {
      data: [
        { id: 'a', kind: 'SCAN', channel: 'Shopee', maskedCode: 'SPX***001', state: 'CREDITED', points: 300, expectedCreditAt: null, creditedAt: '2026-11-05T01:00:00Z', holdUntil: null, createdAt: '2026-10-20T00:00:00Z' },
        { id: 'b', kind: 'SCAN', channel: null, maskedCode: 'LZD***002', state: 'VOIDED', points: 50, expectedCreditAt: null, creditedAt: null, holdUntil: null, createdAt: '2026-10-21T00:00:00Z' },
      ],
      meta: { page: 1, limit: 10, total: 12 },
      searching: [{ maskedCode: 'TTS***003', createdAt: '2026-11-26T00:00:00Z' }],
    };
    const c = await mount();
    const history = c.querySelector('[data-testid="claim-history"]')!;
    expect(history.textContent).toContain('Đã cộng');
    expect(history.textContent).toContain('300 Điểm Xanh');
    expect(history.textContent).toContain(COPY.channelFallback);
    expect(history.textContent).toContain('Đã huỷ');
    expect(history.querySelector('[data-testid="claim-searching"]')?.textContent).toContain('TTS***003');
    expect(history.textContent).toContain('Trang 1/2');
  });
});

describe('/quet-ma — hướng dẫn 3 bước gập khi đã có đơn sàn (W46)', () => {
  it('lịch sử rỗng: mở đủ 3 bước, không có dòng gập', async () => {
    const c = await mount();
    expect(c.querySelector('[data-testid="scan-guide"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="scan-guide-toggle"]')).toBeNull();
  });

  it('đã có đơn: chỉ còn dòng "Hướng dẫn quét mã", chạm để mở và gập lại', async () => {
    mocks.list = { ...EMPTY_LIST, meta: { page: 1, limit: 10, total: 3 } };
    const c = await mount();
    const toggle = c.querySelector<HTMLButtonElement>('[data-testid="scan-guide-toggle"]')!;
    expect(toggle.textContent).toBe(MARKETPLACE_SCAN_COPY.guideToggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(c.querySelector('[data-testid="scan-guide"]')).toBeNull();
    click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(c.querySelector('[data-testid="scan-guide"]')?.id).toBe(toggle.getAttribute('aria-controls'));
    click(toggle);
    expect(c.querySelector('[data-testid="scan-guide"]')).toBeNull();
  });

  it('chỉ có mã đang tìm cũng gập; khách chưa đăng nhập luôn thấy đủ 3 bước', async () => {
    mocks.list = { ...EMPTY_LIST, searching: [{ maskedCode: 'SPX***001', createdAt: '2026-11-26T00:00:00Z' }] };
    let c = await mount();
    expect(c.querySelector('[data-testid="scan-guide-toggle"]')).not.toBeNull();
    mounted?.unmount();
    mocks.phase = 'guest';
    c = await mount();
    expect(c.querySelector('[data-testid="scan-guide"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="scan-guide-toggle"]')).toBeNull();
  });
});

describe('/quet-ma — xác nhận 4 số cuối SĐT người nhận (W46)', () => {
  const required = (channel: string | null = 'shopee') =>
    new ApiError('Cần xác nhận', 403, 'PHONE_CONFIRM_REQUIRED', { statusCode: 403, code: 'PHONE_CONFIRM_REQUIRED', channel, requiredDigits: 4 });
  const wrong = (remainingAttempts: number) =>
    new ApiError('Sai', 403, 'PHONE_CONFIRM_WRONG', { statusCode: 403, code: 'PHONE_CONFIRM_WRONG', channel: 'lazada', requiredDigits: 4, remainingAttempts });
  const locked = () =>
    new ApiError('Khoá', 429, 'PHONE_CONFIRM_LOCKED', { statusCode: 429, code: 'PHONE_CONFIRM_LOCKED', channel: 'lazada', requiredDigits: 4, remainingAttempts: 0 });
  const typeCode = async (c: HTMLElement) => {
    openManual(c);
    typeInto(input(c), 'SPXVN123456789');
    await submitForm(c);
  };
  const confirmWith = async (digits: string) => {
    typeInto(last4Input(), digits);
    act(() => void buttonByText(sheet()!, PHONE_CONFIRM_COPY.submit)!.click());
    await flush(4);
  };

  it('SĐT lệch: mở hộp đúng chữ đề bài theo sàn, ô 4 số kiểu số; không câu lỗi ở thẻ gửi mã', async () => {
    mocks.post.mockRejectedValue(required());
    const c = await mount();
    await typeCode(c);
    const box = sheet()!;
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(PHONE_CONFIRM_COPY.title);
    expect(box.textContent).toContain('Nhập 4 số cuối SĐT nhận hàng trên đơn Shopee');
    expect(box.textContent).toContain('Đây là số người nhận ghi trên đơn Shopee, có thể khác số tài khoản của bạn.');
    const field = last4Input()!;
    expect(field.getAttribute('inputmode')).toBe('numeric');
    expect(field.getAttribute('pattern')).toBe('[0-9]*');
    expect(field.maxLength).toBe(4);
    expect(buttonByText(box, PHONE_CONFIRM_COPY.submit)!.className).toContain('zaui-btn-primary');
    expect(buttonByText(box, PHONE_CONFIRM_COPY.other)).not.toBeNull();
    expect(box.querySelector('[data-testid="phone-confirm-error"]')).toBeNull();
    expect(c.querySelector('[data-testid="claim-error"]')).toBeNull();
  });

  it('sàn chưa rõ: nói "sàn TMĐT"; chữ cái bị bỏ, chưa đủ 4 số thì nhắc mà không gọi API', async () => {
    mocks.post.mockRejectedValueOnce(required(null));
    const c = await mount();
    await typeCode(c);
    expect(sheet()!.textContent).toContain('trên đơn sàn TMĐT');
    typeInto(last4Input(), '8a3');
    expect(last4Input()!.value).toBe('83');
    act(() => void buttonByText(sheet()!, PHONE_CONFIRM_COPY.submit)!.click());
    await flush(2);
    expect(sheet()!.querySelector('[role="alert"]')?.textContent).toBe(PHONE_CONFIRM_COPY.empty);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('nhập đúng 4 số: gửi lại đúng mã kèm recipientPhoneLast4, đóng hộp, thẻ kết quả', async () => {
    mocks.post.mockRejectedValueOnce(required()).mockResolvedValueOnce(claimed());
    const c = await mount();
    await typeCode(c);
    await confirmWith('8326');
    expect(mocks.post).toHaveBeenLastCalledWith('/me/external-points/claims', { code: 'SPXVN123456789', via: 'typed', recipientPhoneLast4: '8326' });
    expect(sheet()).toBeNull();
    expect(c.querySelector('[data-testid="claim-result"]')?.textContent).toContain('1.250 Điểm Xanh đang chờ cộng');
  });

  it('sai: báo còn bao nhiêu lượt kèm lối nhắn CSKH, ô xoá để gõ lại; sai lần 3 thì khoá, nút xác nhận tắt', async () => {
    mocks.post.mockRejectedValueOnce(required('lazada')).mockRejectedValueOnce(wrong(2)).mockRejectedValueOnce(locked());
    const c = await mount();
    await typeCode(c);
    await confirmWith('9921');
    const err = () => sheet()!.querySelector('[data-testid="phone-confirm-error"]');
    expect(err()?.querySelector('[role="alert"]')?.textContent).toBe(
      'Số điện thoại nhận hàng chưa khớp — kiểm tra lại 4 số cuối trên phiếu giao hàng rồi thử lại (còn 2 lượt).',
    );
    const support = err()!.querySelector<HTMLAnchorElement>('[data-testid="phone-confirm-support"]')!;
    expect(support.textContent).toBe(PHONE_CONFIRM_COPY.support);
    expect(support.target).toBe('_blank');
    expect(last4Input()!.value).toBe('');
    await confirmWith('1111');
    expect(err()?.querySelector('[role="alert"]')?.textContent).toBe(PHONE_CONFIRM_COPY.locked);
    expect(last4Input()!.disabled).toBe(true);
    expect(buttonByText(sheet()!, PHONE_CONFIRM_COPY.submit)!.disabled).toBe(true);
    expect(mocks.post).toHaveBeenCalledTimes(3);
  });

  it('"Quét đơn khác": đóng hộp, xoá mã, không gửi gì thêm', async () => {
    mocks.post.mockRejectedValueOnce(required());
    const c = await mount();
    await typeCode(c);
    click(buttonByText(sheet()!, PHONE_CONFIRM_COPY.other));
    await flush(2);
    expect(sheet()).toBeNull();
    expect(input(c)!.value).toBe('');
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('đang ở hộp mà mất mạng: báo lỗi ngay trong hộp, không đóng hộp', async () => {
    mocks.post.mockRejectedValueOnce(required()).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const c = await mount();
    await typeCode(c);
    await confirmWith('8326');
    expect(sheet()).not.toBeNull();
    expect(sheet()!.querySelector('[role="alert"]')?.textContent?.length).toBeGreaterThan(0);
  });

  it('đang ở hộp mà máy chủ từ chối lý do khác (đã có người tích): đóng hộp, báo ở thẻ gửi mã', async () => {
    mocks.post.mockRejectedValueOnce(required()).mockRejectedValueOnce(new ApiError('x', 409, 'ALREADY_CLAIMED'));
    const c = await mount();
    await typeCode(c);
    await confirmWith('8326');
    expect(sheet()).toBeNull();
    expect(c.querySelector('[data-testid="claim-error"] [role="alert"]')?.textContent).toBe(COPY.reject.ALREADY_CLAIMED);
  });
});

describe('/quet-ma — khung quét camera trình duyệt (W44 U5, W46 camera trước)', () => {
  const stopTrack = vi.fn();
  const applyConstraints = vi.fn(async () => undefined);
  const scan = { value: 'SPXVN0123456789' };
  const caps = { torch: false };
  const videoTrack = () => ({ stop: stopTrack, getCapabilities: () => ({ torch: caps.torch }), applyConstraints });
  const fakeStream = () => {
    const t = videoTrack();
    return { getTracks: () => [t], getVideoTracks: () => [t] };
  };
  class FakeDetector {
    static lastFormats: string[] | undefined;
    static calls = 0;
    constructor(opts?: { formats?: string[] }) {
      FakeDetector.lastFormats = opts?.formats;
    }
    static async getSupportedFormats() {
      return ['code_128', 'qr_code', 'aztec'];
    }
    async detect() {
      FakeDetector.calls++;
      return scan.value ? [{ rawValue: scan.value }] : [];
    }
  }
  const waitFrames = () => act(async () => void (await new Promise((r) => setTimeout(r, 700))));
  const startCamera = async (c: HTMLElement) => {
    click(buttonByText(c, WEB.cameraStart));
    await flush(3);
  };

  beforeEach(() => {
    stopTrack.mockClear();
    applyConstraints.mockClear();
    caps.torch = false;
    scan.value = 'SPXVN0123456789';
    FakeDetector.calls = 0;
    Object.defineProperty(window, 'BarcodeDetector', { configurable: true, writable: true, value: FakeDetector });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => fakeStream()) } });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    Reflect.deleteProperty(navigator, 'mediaDevices');
    Reflect.deleteProperty(navigator, 'permissions');
  });

  it('chưa có quyền camera: khung tối có nút "Bật camera quét ngay" (nút chính) giữa khung, chưa mở camera; hai viên thuốc ở dưới', async () => {
    const c = await mount();
    const scanner = c.querySelector('[data-testid="claim-scanner"]')!;
    const start = buttonByText(scanner, WEB.cameraStart)!;
    expect(start.className).toContain('zaui-btn-primary');
    expect(scanner.textContent).toContain(WEB.viewfinderHint);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    const pills = Array.from(scanner.querySelectorAll('.tubu-scanner__pill')).map((b) => b.textContent);
    expect(pills).toEqual([WEB.photoCta, WEB.manualCta]);
    expect(Boolean(start.compareDocumentPosition(scanner.querySelector('.tubu-scanner__pills')!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('trình duyệt đã cho quyền camera: tự mở camera khi vào màn, không cần chạm', async () => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: vi.fn(async () => ({ state: 'granted' })) } });
    scan.value = '';
    const c = await mount();
    await flush(3);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(c.querySelector('.tubu-scanner__frame')?.hasAttribute('data-live')).toBe(true);
    expect(c.querySelector('.tubu-scanner__hint')?.textContent).toBe(WEB.viewfinderHint);
    expect(buttonByText(c, WEB.cameraStart)).toBeNull();
  });

  it('quyền camera còn phải hỏi, hay màn mở với ?code=: không tự mở camera', async () => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: vi.fn(async () => ({ state: 'prompt' })) } });
    let c = await mount();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    mounted?.unmount();
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: vi.fn(async () => ({ state: 'granted' })) } });
    window.history.replaceState(null, '', '/quet-ma?code=SPXVN0123456789');
    c = await mount();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(input(c)!.value).toBe('SPXVN0123456789');
  });

  it('BarcodeDetector không thấy gì: bộ đọc JS (nạp lười) chỉ đọc thêm 1 trong 4 nhịp để máy Android yếu không giật', async () => {
    scan.value = '';
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1280);
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(720);
    const c = await mount();
    await startCamera(c);
    await act(async () => void (await new Promise((r) => setTimeout(r, 1900))));
    const zx = mocks.zxDecode.mock.calls.length;
    expect(FakeDetector.calls).toBeGreaterThanOrEqual(5);
    expect(zx).toBeGreaterThanOrEqual(1);
    expect(zx).toBeLessThanOrEqual(Math.ceil(FakeDetector.calls / 4));
  });

  it('WebView chặn phát video (play() NotAllowedError): báo trong khung máy chưa mở được camera, tắt camera, còn nút bật lại', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    const c = await mount();
    await startCamera(c);
    await flush(3);
    expect(c.querySelector('[data-testid="claim-scanner-message"]')?.textContent).toBe(WEB.cameraUnavailable);
    expect(stopTrack).toHaveBeenCalled();
    expect(buttonByText(c, WEB.cameraStart)).not.toBeNull();
  });

  it('đọc ra mã vận đơn: tắt camera và TỰ GỬI với via=scan (không bấm thêm), thẻ kết quả', async () => {
    mocks.post.mockResolvedValue(claimed());
    const c = await mount();
    await startCamera(c);
    await waitFrames();
    expect(FakeDetector.lastFormats).toEqual(['qr_code', 'code_128']);
    expect(stopTrack).toHaveBeenCalled();
    expect(mocks.post).toHaveBeenCalledWith('/me/external-points/claims', { code: 'SPXVN0123456789', via: 'scan' });
    await flush(3);
    expect(c.querySelector('[data-testid="claim-result"]')).not.toBeNull();
    expect(buttonByText(c, WEB.cameraStart)!.className).not.toContain('zaui-btn-primary');
  });

  it('quét ra đơn cần xác nhận SĐT: hộp 4 số mở, đúng số thì gửi lại kèm via=scan', async () => {
    mocks.post
      .mockRejectedValueOnce(new ApiError('x', 403, 'PHONE_CONFIRM_REQUIRED', { code: 'PHONE_CONFIRM_REQUIRED', channel: 'shopee', requiredDigits: 4 }))
      .mockResolvedValueOnce(claimed());
    const c = await mount();
    await startCamera(c);
    await waitFrames();
    expect(sheet()).not.toBeNull();
    typeInto(last4Input(), '8326');
    act(() => void buttonByText(sheet()!, PHONE_CONFIRM_COPY.submit)!.click());
    await flush(4);
    expect(mocks.post).toHaveBeenLastCalledWith('/me/external-points/claims', { code: 'SPXVN0123456789', via: 'scan', recipientPhoneLast4: '8326' });
    expect(c.querySelector('[data-testid="claim-result"]')).not.toBeNull();
  });

  it('"Quét đơn khác" trong hộp 4 số: mở lại camera', async () => {
    mocks.post.mockRejectedValueOnce(new ApiError('x', 403, 'PHONE_CONFIRM_REQUIRED', { code: 'PHONE_CONFIRM_REQUIRED', channel: 'shopee', requiredDigits: 4 }));
    const c = await mount();
    await startCamera(c);
    await waitFrames();
    const gum = navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>;
    const opened = gum.mock.calls.length;
    scan.value = '';
    click(buttonByText(sheet()!, PHONE_CONFIRM_COPY.other));
    await flush(4);
    expect(sheet()).toBeNull();
    expect(gum.mock.calls.length).toBe(opened + 1);
    expect(c.querySelector('.tubu-scanner__frame')?.hasAttribute('data-live')).toBe(true);
  });

  it('camera đang mở dở (chưa có stream) mà khách chuyển sang chụp ảnh: stream về muộn vẫn bị tắt, không giữ đèn camera', async () => {
    let resolveStream!: (s: unknown) => void;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(() => new Promise((r) => (resolveStream = r))) },
    });
    const c = await mount();
    await startCamera(c);
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    click(c.querySelector('button[data-testid="claim-photo-scan"]'));
    await flush(2);
    await act(async () => resolveStream(fakeStream()));
    await flush(2);
    expect(stopTrack).toHaveBeenCalled();
    expect(c.querySelector('.tubu-scanner__frame')?.hasAttribute('data-live')).toBe(false);
  });

  it('máy cho bật đèn pin: nút đèn ở góc khung, chạm thì bật torch', async () => {
    caps.torch = true;
    scan.value = '';
    const c = await mount();
    await startCamera(c);
    const torch = c.querySelector<HTMLButtonElement>('[data-testid="claim-scanner-torch"]')!;
    expect(torch.getAttribute('aria-label')).toBe(WEB.torchOn);
    expect(torch.getAttribute('aria-pressed')).toBe('false');
    click(torch);
    await flush(2);
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    expect(torch.getAttribute('aria-pressed')).toBe('true');
    expect(torch.getAttribute('aria-label')).toBe(WEB.torchOff);
  });

  it('máy không có đèn pin (Safari iPhone): không có nút đèn', async () => {
    scan.value = '';
    const c = await mount();
    await startCamera(c);
    expect(c.querySelector('.tubu-scanner__frame')?.hasAttribute('data-live')).toBe(true);
    expect(c.querySelector('[data-testid="claim-scanner-torch"]')).toBeNull();
  });

  it('quét phải mã không phải mã vận đơn (QR Wi-Fi): nhắc trong khung quét, quét tiếp, không gửi', async () => {
    scan.value = 'WIFI:S:nha;T:WPA;P:12345678;;';
    const c = await mount();
    await startCamera(c);
    await waitFrames();
    expect(c.querySelector('.tubu-scanner__alert')?.textContent).toBe(COPY.scanNoCode);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(stopTrack).not.toHaveBeenCalled();
  });

  it('camera bị chặn: báo cho phép camera ngay trong khung, vẫn nhập tay được', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) },
    });
    const c = await mount();
    await startCamera(c);
    await flush(2);
    expect(c.querySelector('[data-testid="claim-scanner-message"]')?.textContent).toBe(WEB.cameraDenied);
    openManual(c);
    expect(input(c)).not.toBeNull();
  });
});

describe('/quet-ma — iPhone: Safari, Zalo, Facebook không có BarcodeDetector (W45)', () => {
  const stopTrack = vi.fn();
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }], getVideoTracks: () => [{ stop: stopTrack }] }));
  const close = vi.fn();
  const photoFile = () => new File([new Uint8Array([1, 2, 3])], 'nhan.jpg', { type: 'image/jpeg' });
  const choose = async (c: HTMLElement, file: File) => {
    const picker = c.querySelector<HTMLInputElement>('[data-testid="claim-photo-input"]')!;
    Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
    await act(async () => void picker.dispatchEvent(new Event('change', { bubbles: true })));
    await flush(6);
  };

  beforeEach(() => {
    stopTrack.mockClear();
    getUserMedia.mockClear();
    close.mockClear();
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4032, height: 3024, close })));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('vẫn có nút "Bật camera quét ngay" là nút chính và viên thuốc "Chụp / chọn ảnh" ngay dưới khung', async () => {
    const c = await mount();
    const startBtn = buttonByText(c, WEB.cameraStart)!;
    expect(startBtn.className).toContain('zaui-btn-primary');
    const photoBtn = c.querySelector<HTMLButtonElement>('button[data-testid="claim-photo-scan"]')!;
    expect(photoBtn.textContent).toBe(WEB.photoCta);
    expect(Boolean(startBtn.compareDocumentPosition(photoBtn) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    const picker = c.querySelector<HTMLInputElement>('[data-testid="claim-photo-input"]')!;
    expect(picker.type).toBe('file');
    expect(picker.accept).toBe('image/*');
    expect(picker.getAttribute('capture')).toBe('environment');
  });

  it('bấm bật camera: mở camera sau ngay trong khung (không cần BarcodeDetector)', async () => {
    const c = await mount();
    click(buttonByText(c, WEB.cameraStart));
    await flush(3);
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: 'environment' }), audio: false }));
    expect(c.querySelector('[data-testid="claim-scanner"] video')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('bấm "Chụp / chọn ảnh" mở bộ chọn ảnh của máy', async () => {
    const c = await mount();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    click(c.querySelector('button[data-testid="claim-photo-scan"]'));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('chọn ảnh có mã vận đơn: bộ đọc JS đọc ảnh rồi tự gửi với via=scan', async () => {
    mocks.zxDecode.mockImplementation(() => ['SPXVN0123456789']);
    mocks.post.mockResolvedValue(claimed());
    const c = await mount();
    await choose(c, photoFile());
    expect(mocks.zxDecode).toHaveBeenCalledWith(expect.anything(), 4032, 3024, expect.objectContaining({ tryHarder: true }));
    expect(close).toHaveBeenCalled();
    expect(mocks.post).toHaveBeenCalledWith('/me/external-points/claims', { code: 'SPXVN0123456789', via: 'scan' });
  });

  it('ảnh không có mã: thử cả ảnh xoay rồi báo chưa đọc được, không gửi', async () => {
    const c = await mount();
    await choose(c, photoFile());
    const rotations = mocks.zxDecode.mock.calls.map((call) => (call as unknown as [unknown, number, number, { rotate: boolean }])[3].rotate);
    expect(rotations).toContain(true);
    expect(rotations).toContain(false);
    expect(c.querySelector('[data-testid="claim-error"] [role="alert"]')?.textContent).toBe(WEB.photoUnreadable);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('ảnh chụp phải mã không phải mã vận đơn: nhắc, không gửi', async () => {
    mocks.zxDecode.mockImplementation(() => ['WIFI:S:nha;T:WPA;P:12345678;;']);
    const c = await mount();
    await choose(c, photoFile());
    expect(c.querySelector('[data-testid="claim-error"] [role="alert"]')?.textContent).toBe(COPY.scanNoCode);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('WebView không có API camera: nút chụp/chọn ảnh giữa khung là nút chính, không có viên thuốc ảnh trùng, vẫn đọc được mã', async () => {
    Reflect.deleteProperty(navigator, 'mediaDevices');
    mocks.zxDecode.mockImplementation(() => ['SPXVN0123456789']);
    mocks.post.mockResolvedValue(claimed());
    const c = await mount();
    expect(buttonByText(c, WEB.cameraStart)).toBeNull();
    expect(buttonByText(c, WEB.photoCta)!.className).toContain('zaui-btn-primary');
    expect(c.querySelectorAll('[data-testid="claim-photo-scan"]')).toHaveLength(1);
    await choose(c, photoFile());
    expect(mocks.post).toHaveBeenCalledWith('/me/external-points/claims', { code: 'SPXVN0123456789', via: 'scan' });
  });
});

describe('/quet-ma — W59: không claim REVIEW rác, nhập lại 4 số cuối từ lịch sử', () => {
  const required = () => new ApiError('Cần xác nhận', 403, 'PHONE_CONFIRM_REQUIRED', { statusCode: 403, code: 'PHONE_CONFIRM_REQUIRED', channel: 'shopee', requiredDigits: 4 });
  const wrong = (remainingAttempts: number) =>
    new ApiError('Sai', 403, 'PHONE_CONFIRM_WRONG', { statusCode: 403, code: 'PHONE_CONFIRM_WRONG', channel: 'shopee', requiredDigits: 4, remainingAttempts });
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'c7',
    kind: 'SCAN',
    channel: 'Shopee',
    maskedCode: 'SPX***777',
    state: 'REVIEW',
    points: 900,
    expectedCreditAt: null,
    creditedAt: null,
    holdUntil: null,
    createdAt: '2026-11-27T00:00:00Z',
    ...over,
  });
  const listWith = (over: Record<string, unknown>) => ({ ...EMPTY_LIST, ...over });
  const historyCalls = () => mocks.get.mock.calls.filter((c) => c[0] === '/me/external-points/claims').length;
  const confirmWith = async (digits: string) => {
    typeInto(last4Input(), digits);
    act(() => void buttonByText(sheet()!, PHONE_CONFIRM_COPY.submit)!.click());
    await flush(4);
  };

  it('đóng hộp 4 số mà chưa khớp: báo mã chưa tích và nằm ở lịch sử, làm mới lịch sử, không gửi thêm', async () => {
    mocks.post.mockRejectedValueOnce(required());
    const c = await mount();
    openManual(c);
    typeInto(input(c), 'SPXVN123456789');
    await submitForm(c);
    const before = historyCalls();
    click(document.querySelector<HTMLElement>('[role="dialog"] button[aria-label="Đóng"]'));
    await flush(4);
    expect(sheet()).toBeNull();
    expect(c.querySelector('[data-testid="claim-later"]')?.textContent).toBe(PHONE_CONFIRM_COPY.later);
    expect(historyCalls()).toBeGreaterThan(before);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('dòng "Chờ bạn nhập 4 số cuối": chạm mở hộp (không có "Quét đơn khác"), nhập đúng là gửi attemptId và báo đã ghi nhận', async () => {
    mocks.list = listWith({ needsPhone: [{ attemptId: 'a1', channel: 'shopee', maskedCode: 'SPX***001', createdAt: '2026-11-28T01:00:00Z' }] });
    mocks.post.mockResolvedValueOnce(claimed({ claimId: 'c9', channel: 'shopee', maskedCode: 'SPX***001', points: 700 }));
    const c = await mount();
    const group = c.querySelector('[data-testid="claim-needs-phone"]')!;
    expect(group.textContent).toContain(PHONE_CONFIRM_COPY.retryTitle);
    expect(group.textContent).toContain('Shopee');
    expect(group.textContent).toContain(COPY.state.needPhone);
    click(group.querySelector('button'));
    await flush(2);
    expect(sheet()!.textContent).toContain('Nhập 4 số cuối SĐT nhận hàng trên đơn Shopee');
    expect(buttonByText(sheet()!, PHONE_CONFIRM_COPY.other)).toBeNull();
    await confirmWith('5511');
    expect(mocks.post).toHaveBeenCalledWith('/me/external-points/claims/phone-retry', { attemptId: 'a1', recipientPhoneLast4: '5511' });
    expect(sheet()).toBeNull();
    const done = c.querySelector('[data-testid="claim-retry-done"]')!;
    expect(done.textContent).toContain('Đã ghi nhận đơn Shopee SPX***001');
    expect(done.textContent).toContain('700 Điểm Xanh đang chờ cộng');
  });

  it('claim chờ chỉ vì SĐT (phoneRetry): nhãn "Nhập 4 số cuối" thay "Đang kiểm tra", chạm gửi claimId; sai thì báo trong hộp theo lời PO', async () => {
    mocks.list = listWith({ data: [row({ phoneRetry: true }), row({ id: 'c8', maskedCode: 'SPX***888' })], meta: { page: 1, limit: 10, total: 2 } });
    mocks.post.mockRejectedValueOnce(wrong(2));
    const c = await mount();
    const retryRow = c.querySelector('[data-testid="claim-row-retry"]')!;
    expect(retryRow.textContent).toContain(COPY.state.needPhone);
    expect(retryRow.textContent).not.toContain(COPY.state.review);
    expect(c.querySelectorAll('[data-testid="claim-row-retry"]')).toHaveLength(1);
    click(retryRow.querySelector('button'));
    await flush(2);
    await confirmWith('0000');
    expect(mocks.post).toHaveBeenCalledWith('/me/external-points/claims/phone-retry', { claimId: 'c7', recipientPhoneLast4: '0000' });
    expect(sheet()!.querySelector('[role="alert"]')?.textContent).toBe(PHONE_CONFIRM_COPY.wrong(2));
    expect(last4Input()!.value).toBe('');
  });

  it('dòng không còn để nhập lại (409): đóng hộp, báo câu máy chủ, làm mới lịch sử', async () => {
    mocks.list = listWith({ data: [row({ phoneRetry: true })], meta: { page: 1, limit: 10, total: 1 } });
    mocks.post.mockRejectedValueOnce(new ApiError('Đơn này không còn cần nhập 4 số cuối. Bạn xem trạng thái mới trong lịch sử nhé.', 409, 'PHONE_RETRY_GONE'));
    const c = await mount();
    click(c.querySelector('[data-testid="claim-row-retry"] button'));
    await flush(2);
    const before = historyCalls();
    await confirmWith('5511');
    expect(sheet()).toBeNull();
    expect(c.querySelector('[data-testid="claim-retry-notice"]')?.textContent).toBe('Đơn này không còn cần nhập 4 số cuối. Bạn xem trạng thái mới trong lịch sử nhé.');
    expect(historyCalls()).toBeGreaterThan(before);
  });
});
