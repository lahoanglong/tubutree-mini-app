// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKETPLACE_CLAIM_COPY as COPY, MARKETPLACE_CLAIM_WEB_COPY as WEB } from '@tubutree/app-core/marketplace-claim-copy';
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
  get: vi.fn(),
  push: vi.fn(),
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
  },
}));

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

describe('/quet-ma — đã đăng nhập: quét và tích điểm ngay trên web (W44 U5)', () => {
  it('có ô nhập mã, nút Tích điểm và lịch sử; máy không đọc được mã vạch thì không có nút quét', async () => {
    const c = await mount();
    expect(input(c)?.getAttribute('placeholder')).toBe(COPY.inputPlaceholder);
    expect(c.textContent).toContain(COPY.inputLabel);
    expect(submitBtn(c)).not.toBeNull();
    expect(buttonByText(c, WEB.scanCta)).toBeNull();
    expect(c.querySelector('[data-testid="claim-history"]')?.textContent).toContain(WEB.historyTitle);
    expect(c.textContent).toContain(COPY.listEmpty);
  });

  it('gõ mã đúng dạng thì Tích điểm thành nút chính; gửi xong: thẻ kết quả, làm mới lịch sử, nút "Mua sắm ngay" khi chưa có điểm', async () => {
    mocks.post.mockResolvedValue(claimed());
    const c = await mount();
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
    typeInto(input(c), 'SPXVN123456789');
    await submitForm(c);
    expect(c.querySelector('[data-testid="scan-shop-now"]')?.textContent).toBe('Dùng 1.200 Điểm Xanh đang có');
  });

  it('chưa thấy đơn (SEARCHING): báo sẽ tìm lại, không có nút mua sắm', async () => {
    mocks.post.mockResolvedValue(claimed({ status: 'SEARCHING', claimId: null, channel: null, points: null, expectedCreditAt: null }));
    const c = await mount();
    typeInto(input(c), 'SPXVN123456789');
    await submitForm(c);
    expect(c.querySelector('[data-testid="claim-result"]')?.textContent).toContain(COPY.resultSearching);
    expect(c.querySelector('[data-testid="scan-shop-now"]')).toBeNull();
  });

  it('đơn cần kiểm tra (REVIEW): câu đang kiểm tra, vẫn mời mua sắm', async () => {
    mocks.post.mockResolvedValue(claimed({ status: 'REVIEW', points: null, expectedCreditAt: null }));
    const c = await mount();
    typeInto(input(c), 'SPXVN123456789');
    await submitForm(c);
    expect(c.querySelector('[data-testid="claim-result"]')?.textContent).toContain(COPY.resultReview);
    expect(c.querySelector('[data-testid="scan-shop-now"]')).not.toBeNull();
  });

  it('từ chối theo code dùng chung câu với Mini App: SĐT không khớp', async () => {
    mocks.post.mockRejectedValue(new ApiError('máy chủ', 409, 'PHONE_MISMATCH'));
    const c = await mount();
    typeInto(input(c), 'SPXVN123456789');
    await submitForm(c);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(COPY.reject.PHONE_MISMATCH);
    expect(c.textContent).not.toContain('máy chủ');
    expect(c.querySelector('[data-testid="claim-result"]')).toBeNull();
  });

  it('gửi nhanh quá (429): câu chờ một phút', async () => {
    mocks.post.mockRejectedValue(new ApiError('Too Many Requests', 429));
    const c = await mount();
    typeInto(input(c), 'SPXVN123456789');
    await submitForm(c);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(WEB.rateLimited);
  });

  it('NOT_ELIGIBLE_USER (SĐT chưa xác minh qua Zalo): nói thật lý do, có lối xác minh trên Zalo', async () => {
    mocks.post.mockRejectedValue(new ApiError('máy chủ', 403, 'NOT_ELIGIBLE_USER'));
    const c = await mount();
    typeInto(input(c), 'SPXVN123456789');
    await submitForm(c);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(WEB.notVerified);
    const verify = c.querySelector<HTMLAnchorElement>('[data-testid="claim-verify-zalo"]')!;
    expect(new URL(verify.href).pathname.endsWith('/points/scan')).toBe(true);
  });

  it('mã trống: nhắc nhập, không gọi API', async () => {
    const c = await mount();
    await submitForm(c);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(COPY.emptyCode);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('bấm Tích điểm hai lần sát nhau: chỉ gửi một lần', async () => {
    let resolve!: (v: unknown) => void;
    mocks.post.mockImplementation(() => new Promise((r) => (resolve = r)));
    const c = await mount();
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

  it('?code= hợp lệ: điền sẵn mã (chuẩn hoá) và gửi với via=scan, không tự gửi', async () => {
    window.history.replaceState(null, '', '/quet-ma?code=spx-vn-0123456789');
    mocks.post.mockResolvedValue(claimed());
    const c = await mount();
    expect(input(c)!.value).toBe('SPXVN0123456789');
    expect(mocks.post).not.toHaveBeenCalled();
    await submitForm(c);
    expect(mocks.post).toHaveBeenCalledWith('/me/external-points/claims', { code: 'SPXVN0123456789', via: 'scan' });
  });

  it('?code= sai dạng: ô để trống, báo link không đúng dạng', async () => {
    window.history.replaceState(null, '', '/quet-ma?code=abc');
    const c = await mount();
    expect(input(c)!.value).toBe('');
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(COPY.codeLinkInvalid);
  });

  it('tài khoản chưa có SĐT: không ô nhập (chắc chắn bị từ chối), nói cần SĐT đã xác minh, nút chính mở Zalo để xác minh; vẫn xem được lịch sử', async () => {
    mocks.me = { phone: null };
    const c = await mount();
    const prompt = c.querySelector('[data-testid="scan-phone-prompt"]')!;
    expect(prompt.textContent).toContain(WEB.phoneTitle);
    expect(prompt.textContent).toContain('đã xác minh');
    const links = Array.from(prompt.querySelectorAll<HTMLAnchorElement>('a'));
    expect(links[0]!.textContent).toBe(WEB.phoneCta);
    expect(new URL(links[0]!.href).pathname.endsWith('/points/scan')).toBe(true);
    expect(links[1]!.getAttribute('href')).toBe('/tai-khoan/ho-so');
    expect(input(c)).toBeNull();
    expect(c.querySelector('[data-testid="claim-history"]')).not.toBeNull();
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

describe('/quet-ma — quét bằng camera trình duyệt (W44 U5)', () => {
  const stopTrack = vi.fn();
  const scan = { value: 'SPXVN0123456789' };
  class FakeDetector {
    static lastFormats: string[] | undefined;
    constructor(opts?: { formats?: string[] }) {
      FakeDetector.lastFormats = opts?.formats;
    }
    static async getSupportedFormats() {
      return ['code_128', 'qr_code', 'aztec'];
    }
    async detect() {
      return [{ rawValue: scan.value }];
    }
  }
  const waitFrames = () => act(async () => void (await new Promise((r) => setTimeout(r, 700))));

  beforeEach(() => {
    stopTrack.mockClear();
    scan.value = 'SPXVN0123456789';
    Object.defineProperty(window, 'BarcodeDetector', { configurable: true, writable: true, value: FakeDetector });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) } });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('máy đọc được mã vạch: nút "Quét mã trên nhãn" là nút chính trước ô nhập; quét ra mã vận đơn thì điền ô, tắt camera, gửi với via=scan', async () => {
    mocks.post.mockResolvedValue(claimed());
    const c = await mount();
    const scanBtn = buttonByText(c, WEB.scanCta)!;
    expect(scanBtn.className).toContain('zaui-btn-primary');
    expect(Boolean(scanBtn.compareDocumentPosition(input(c)!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    click(scanBtn);
    await flush(3);
    await waitFrames();
    expect(FakeDetector.lastFormats).toEqual(['qr_code', 'code_128']);
    expect(input(c)!.value).toBe('SPXVN0123456789');
    expect(stopTrack).toHaveBeenCalled();
    expect(buttonByText(c, WEB.scanCta)!.className).not.toContain('zaui-btn-primary');
    await submitForm(c);
    expect(mocks.post).toHaveBeenCalledWith('/me/external-points/claims', { code: 'SPXVN0123456789', via: 'scan' });
  });

  it('quét phải mã không phải mã vận đơn (QR Wi-Fi): nhắc trong khung quét, không điền ô', async () => {
    scan.value = 'WIFI:S:nha;T:WPA;P:12345678;;';
    const c = await mount();
    click(buttonByText(c, WEB.scanCta));
    await flush(3);
    await waitFrames();
    expect(document.body.textContent).toContain(COPY.scanNoCode);
    expect(input(c)!.value).toBe('');
  });

  it('camera bị chặn: báo cho phép camera, vẫn nhập tay được', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) },
    });
    const c = await mount();
    click(buttonByText(c, WEB.scanCta));
    await flush(4);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(WEB.cameraDenied);
    expect(input(c)).not.toBeNull();
  });
});
