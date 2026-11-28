// @vitest-environment jsdom
import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FORBIDDEN_TERMS } from '@tubutree/app-core/shop-copy';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { SITE_URL } from '@/lib/site';
import { isZaloWebViewUserAgent, zaloWebViewBootScript } from '@/lib/zalo-webview';
import DealerLayout from '@/app/dai-ly/layout';
import { DEALER_BROWSER_URL, ZALO_GATE_BODY, ZALO_GATE_COPY_LABEL, ZALO_GATE_TITLE, ZaloWebViewGate } from './zalo-webview-gate';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dai-ly',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useSelectedLayoutSegment: () => null,
}));

const ZALO_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo iOS/12345 ZaloTheme/light ZaloLanguage/vi';
const ZALO_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 Zalo/24.05.1';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ZALO_PREVIEW_BOT = 'Mozilla/5.0 (compatible; ZaloLinkPreview/1.0)';

const setUa = (ua: string) => vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua);

let mounted: Rendered[] = [];
let roots: { root: Root; box: HTMLElement }[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  for (const { root, box } of roots) {
    act(() => root.unmount());
    box.remove();
  }
  roots = [];
  document.documentElement.removeAttribute('data-zalo-webview');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

let probeMounts = 0;
function RealPage() {
  probeMounts++;
  return <h1 data-real-page>Kênh đại lý</h1>;
}
const tree = (
  <ZaloWebViewGate>
    <RealPage />
  </ZaloWebViewGate>
);
const mount = () => {
  const r = render(tree);
  mounted.push(r);
  return r;
};
/** Giống trình duyệt thật: máy chủ trả HTML (chưa hydrate), React hydrate lên đúng HTML đó. */
function hydrate(): HTMLElement {
  const box = document.createElement('div');
  box.innerHTML = renderToString(tree);
  document.body.appendChild(box);
  let root!: Root;
  act(() => {
    root = hydrateRoot(box, tree);
  });
  roots.push({ root, box });
  return box;
}

describe('isZaloWebViewUserAgent', () => {
  it('nhận WebView của Zalo (iOS, Android), không nhận Safari, Chrome hay bộ xem trước link của Zalo', () => {
    expect(isZaloWebViewUserAgent(ZALO_IOS)).toBe(true);
    expect(isZaloWebViewUserAgent(ZALO_ANDROID)).toBe(true);
    expect(isZaloWebViewUserAgent(SAFARI_IOS)).toBe(false);
    expect(isZaloWebViewUserAgent(CHROME_DESKTOP)).toBe(false);
    expect(isZaloWebViewUserAgent(ZALO_PREVIEW_BOT)).toBe(false);
    expect(isZaloWebViewUserAgent('')).toBe(false);
  });
});

describe('zaloWebViewBootScript', () => {
  const run = () => new Function(zaloWebViewBootScript())();

  it('cùng kết luận với isZaloWebViewUserAgent trên mọi UA mẫu', () => {
    for (const ua of [ZALO_IOS, ZALO_ANDROID, SAFARI_IOS, CHROME_DESKTOP, ZALO_PREVIEW_BOT, '']) {
      document.documentElement.removeAttribute('data-zalo-webview');
      vi.restoreAllMocks();
      setUa(ua);
      run();
      expect(document.documentElement.hasAttribute('data-zalo-webview'), ua).toBe(isZaloWebViewUserAgent(ua));
    }
  });

  it('không bao giờ ném lỗi ra trang (UA không đọc được)', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(run).not.toThrow();
  });

  it('layout /dai-ly đặt script TRƯỚC nội dung trang để chạy trước khi vẽ', () => {
    const html = renderToString(
      <DealerLayout>
        <p>NOI-DUNG-TRANG</p>
      </DealerLayout>,
    );
    const script = html.indexOf('data-zalo-webview');
    expect(script).toBeGreaterThan(-1);
    expect(script).toBeLessThan(html.indexOf('NOI-DUNG-TRANG'));
  });
});

describe('ZaloWebViewGate: HTML máy chủ (chưa hydrate)', () => {
  it('có cả trang thật lẫn màn chặn; CSS theo <html data-zalo-webview> giấu trang thật và hiện màn chặn', () => {
    const box = document.createElement('div');
    box.innerHTML = renderToString(tree);
    const real = box.querySelector('[data-real-page]')!;
    expect((real.parentElement as HTMLElement).className).toBe('[html[data-zalo-webview]_&]:hidden');
    const gate = box.querySelector('[data-zalo-webview-gate]')!;
    expect((gate.parentElement as HTMLElement).className).toBe('hidden [html[data-zalo-webview]_&]:block');
    expect(gate.querySelector('h1')!.textContent).toBe(ZALO_GATE_TITLE);
  });
});

describe('ZaloWebViewGate: sau hydrate', () => {
  it('ngoài Zalo: trang thật nguyên vẹn (không dựng lại), màn chặn bị gỡ', () => {
    setUa(SAFARI_IOS);
    const box = hydrate();
    expect(box.querySelector('[data-real-page]')).not.toBeNull();
    expect(box.querySelector('[data-zalo-webview-gate]')).toBeNull();
    expect(box.querySelectorAll('h1')).toHaveLength(1);
    expect((box.querySelector('[data-real-page]')!.parentElement as HTMLElement).hasAttribute('class')).toBe(false);
  });

  it('trong Zalo: trang thật bị gỡ hẳn, chỉ còn màn chặn hiện ra (một h1, không phụ thuộc CSS)', () => {
    setUa(ZALO_IOS);
    const box = hydrate();
    expect(box.querySelector('[data-real-page]')).toBeNull();
    const gate = box.querySelector('[data-zalo-webview-gate]')!;
    expect(gate).not.toBeNull();
    expect((gate.parentElement as HTMLElement).hasAttribute('class')).toBe(false);
    expect(box.querySelectorAll('h1')).toHaveLength(1);
  });

  it('trong Zalo dựng mới (không qua HTML máy chủ): trang thật không bao giờ được dựng', () => {
    setUa(ZALO_ANDROID);
    probeMounts = 0;
    const r = mount();
    expect(probeMounts).toBe(0);
    expect(r.container.querySelector('[data-real-page]')).toBeNull();
    expect(r.container.querySelector('[data-zalo-webview-gate]')).not.toBeNull();
  });
});

describe('Màn chặn trong Zalo', () => {
  const gate = () => {
    setUa(ZALO_IOS);
    return mount().container;
  };

  it('"Mở trên trình duyệt ngoài" + một nút chính "Sao chép liên kết" + liên kết về trang chủ; link hiện ra là trang gốc /dai-ly', () => {
    const c = gate();
    expect(c.querySelector('h1')!.textContent).toBe('Mở trên trình duyệt ngoài');
    expect(c.textContent).toContain(ZALO_GATE_BODY);
    expect(c.querySelector('code')!.textContent).toBe(`${SITE_URL}/dai-ly`);
    expect(DEALER_BROWSER_URL).toBe(`${SITE_URL}/dai-ly`);
    const buttons = Array.from(c.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toEqual(['Sao chép liên kết']);
    expect(ZALO_GATE_COPY_LABEL).toBe('Sao chép liên kết');
    expect(byText(c, 'a', 'Về trang chủ')!.getAttribute('href')).toBe('/');
    expect(c.querySelector('form, input')).toBeNull();
  });

  it('chữ trên màn không phạm FORBIDDEN_TERMS', () => {
    const text = gate().textContent!;
    for (const f of FORBIDDEN_TERMS) expect(text, String(f.pattern)).not.toMatch(f.pattern);
  });

  it('Sao chép liên kết: chép đúng link vào clipboard và báo "Đã sao chép" trong vùng trạng thái', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', Object.assign(Object.create(window.navigator), { clipboard: { writeText } }));
    setUa(ZALO_IOS);
    const c = mount().container;
    click(byText(c, 'button', 'Sao chép liên kết'));
    await flush();
    expect(writeText).toHaveBeenCalledWith(`${SITE_URL}/dai-ly`);
    const status = c.querySelector('[role="status"]')!;
    expect(status.textContent).toBe('Đã sao chép liên kết. Dán vào Safari hoặc Chrome để mở.');
    expect(status.className).not.toContain('danger');
  });

  it('clipboard bị chặn và execCommand cũng không chép được: báo thật là chưa chép, không nói dối', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', Object.assign(Object.create(window.navigator), { clipboard: { writeText } }));
    Object.defineProperty(document, 'execCommand', { configurable: true, writable: true, value: () => false });
    setUa(ZALO_IOS);
    const c = mount().container;
    click(byText(c, 'button', 'Sao chép liên kết'));
    await flush();
    const status = c.querySelector('[role="status"]')!;
    expect(status.textContent).toBe('Chưa sao chép được, hãy giữ vào liên kết ở trên để chép.');
    expect(status.className).toContain('text-danger-fg');
    expect(c.textContent).not.toContain('Đã sao chép');
    delete (document as { execCommand?: unknown }).execCommand;
  });
});
