import { useState } from 'react';
import { act, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SCROLL_KEY_PREFIX, useScrollRestoration } from './use-scroll-restoration';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

function Harness({ k, ready }: { k: string; ready: boolean }) {
  const { anchorRef } = useScrollRestoration(k, ready);
  return (
    <div className="zaui-page" data-testid="scroller">
      <div ref={anchorRef} />
    </div>
  );
}

let navigate: NavigateFunction;
function NavProbe() {
  navigate = useNavigate();
  return null;
}

/** Trang Browse (có hook) + một trang khác giả lập PDP; `index` chọn mục lịch sử hiện tại. */
function renderApp(entries: string[], index: number, props: { k: string; ready: boolean }) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={index} future={FUTURE}>
      <NavProbe />
      <Routes>
        <Route path="/browse" element={<Harness {...props} />} />
        <Route path="/pdp" element={<div data-testid="pdp" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const scroller = () => document.querySelector('.zaui-page') as HTMLElement;
const stored = (k: string) => sessionStorage.getItem(`${SCROLL_KEY_PREFIX}${k}`);

/** jsdom không có layout: scrollTop mặc định luôn 0 và không ghi được — thay bằng giá trị ghi/đọc được theo phần tử. */
const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
beforeEach(() => {
  sessionStorage.clear();
  const values = new WeakMap<Element, number>();
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) { return this.isConnected ? values.get(this) ?? 0 : 0; }, // như trình duyệt: phần tử đã gỡ khỏi DOM → 0
    set(this: Element, v: number) { values.set(this, v); },
  });
});
afterEach(() => {
  if (original) Object.defineProperty(Element.prototype, 'scrollTop', original);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useScrollRestoration — lưu', () => {
  it('lưu vị trí cuộn (debounce 100ms) vào sessionStorage theo khoá URL', () => {
    vi.useFakeTimers();
    renderApp(['/browse'], 0, { k: 'q=nuoc', ready: true });
    scroller().scrollTop = 640;
    scroller().dispatchEvent(new Event('scroll'));
    expect(stored('q=nuoc')).toBeNull();
    act(() => { vi.advanceTimersByTime(99); });
    expect(stored('q=nuoc')).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(stored('q=nuoc')).toBe('640');
  });

  it('cuộn liên tục chỉ ghi giá trị cuối (mỗi lần cuộn đặt lại debounce)', () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderApp(['/browse'], 0, { k: 'q=nuoc', ready: true });
    for (const y of [100, 200, 300]) {
      scroller().scrollTop = y;
      scroller().dispatchEvent(new Event('scroll'));
      act(() => { vi.advanceTimersByTime(60); });
    }
    expect(setItem).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(100); });
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(stored('q=nuoc')).toBe('300');
  });

  it('rời trang (unmount) → lưu ngay vị trí hiện tại và không còn timer treo', () => {
    vi.useFakeTimers();
    const { unmount } = renderApp(['/browse'], 0, { k: 'sort=newest', ready: true });
    scroller().scrollTop = 300;
    scroller().dispatchEvent(new Event('scroll')); // timer đang chờ
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    unmount();
    expect(stored('sort=newest')).toBe('300');
    expect(setItem).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(setItem).toHaveBeenCalledTimes(1); // timer debounce đã bị huỷ, không ghi thêm sau unmount
  });

  it('phần tử đã bị gỡ khỏi DOM trước cleanup → lưu vị trí cuộn gần nhất đã thấy, không phải 0', () => {
    const { unmount } = render(<MemoryRouter future={FUTURE}><Harness k="q=gone" ready /></MemoryRouter>);
    const el = scroller();
    el.scrollTop = 410;
    el.dispatchEvent(new Event('scroll'));
    Object.defineProperty(el, 'isConnected', { configurable: true, get: () => false }); // như khi React đã gỡ DOM
    expect(el.scrollTop).toBe(0);
    unmount();
    expect(stored('q=gone')).toBe('410');
  });

  it('đổi bộ lọc (đổi khoá) → vị trí được lưu cho khoá CŨ', () => {
    const { rerender } = render(
      <MemoryRouter future={FUTURE}><Harness k="q=a" ready /></MemoryRouter>,
    );
    scroller().scrollTop = 500;
    rerender(<MemoryRouter future={FUTURE}><Harness k="q=b" ready /></MemoryRouter>);
    expect(stored('q=a')).toBe('500');
  });
});

describe('useScrollRestoration — khôi phục chỉ khi quay lại (Back/forward = POP)', () => {
  it('Back từ trang khác về khoá đã lưu → khôi phục vị trí', () => {
    sessionStorage.setItem(`${SCROLL_KEY_PREFIX}q=nuoc`, '480');
    renderApp(['/browse', '/pdp'], 1, { k: 'q=nuoc', ready: true });
    expect(document.querySelector('.zaui-page')).toBeNull(); // đang ở PDP
    act(() => { navigate(-1); });
    expect(scroller().scrollTop).toBe(480);
  });

  it('điều hướng MỚI (PUSH) tới cùng URL → bắt đầu từ đầu trang dù đã có vị trí cũ', () => {
    sessionStorage.setItem(`${SCROLL_KEY_PREFIX}q=nuoc`, '480');
    renderApp(['/pdp'], 0, { k: 'q=nuoc', ready: true });
    act(() => { navigate('/browse?q=nuoc'); });
    expect(scroller().scrollTop).toBe(0);
  });

  it('REPLACE tới Browse → không khôi phục', () => {
    sessionStorage.setItem(`${SCROLL_KEY_PREFIX}q=nuoc`, '480');
    renderApp(['/pdp'], 0, { k: 'q=nuoc', ready: true });
    act(() => { navigate('/browse?q=nuoc', { replace: true }); });
    expect(scroller().scrollTop).toBe(0);
  });

  it('đi PUSH rồi rời trang, Back về → khôi phục đúng vị trí đã cuộn lúc rời (vòng đời đầy đủ)', () => {
    renderApp(['/pdp'], 0, { k: 'q=nuoc', ready: true });
    act(() => { navigate('/browse?q=nuoc'); });
    scroller().scrollTop = 720;
    act(() => { navigate('/pdp'); }); // unmount Browse → lưu 720
    expect(stored('q=nuoc')).toBe('720');
    act(() => { navigate(-1); });
    expect(scroller().scrollTop).toBe(720);
    act(() => { navigate(1); }); // forward cũng là POP nhưng sang trang khác
    act(() => { navigate('/browse?q=nuoc'); }); // PUSH mới → từ đầu
    expect(scroller().scrollTop).toBe(0);
  });

  it('replace cùng khoá trước khi có dữ liệu (vd. bỏ ?focus) không làm mất khôi phục của lần quay lại', () => {
    sessionStorage.setItem(`${SCROLL_KEY_PREFIX}q=nuoc`, '480');
    let setReady!: (v: boolean) => void;
    function Gate() {
      const [ready, set] = useState(false);
      setReady = set;
      return <Harness k="q=nuoc" ready={ready} />;
    }
    render(
      <MemoryRouter initialEntries={['/browse?q=nuoc&focus=search']} future={FUTURE}>
        <NavProbe />
        <Routes><Route path="/browse" element={<Gate />} /></Routes>
      </MemoryRouter>,
    );
    act(() => { navigate('/browse?q=nuoc', { replace: true }); });
    expect(scroller().scrollTop).toBe(0);
    act(() => { setReady(true); });
    expect(scroller().scrollTop).toBe(480);
  });

  it('khôi phục khi danh sách đã có dữ liệu (ready), không khôi phục sớm', () => {
    sessionStorage.setItem(`${SCROLL_KEY_PREFIX}q=nuoc`, '480');
    const ui = (ready: boolean) => (
      <MemoryRouter future={FUTURE}><Harness k="q=nuoc" ready={ready} /></MemoryRouter>
    );
    const { rerender } = render(ui(false));
    expect(scroller().scrollTop).toBe(0);
    rerender(ui(false));
    expect(scroller().scrollTop).toBe(0);
    rerender(ui(true));
    expect(scroller().scrollTop).toBe(480);
  });

  it('chỉ khôi phục MỘT lần cho mỗi khoá (khách cuộn tiếp không bị kéo về)', () => {
    sessionStorage.setItem(`${SCROLL_KEY_PREFIX}q=a`, '200');
    const ui = (ready: boolean) => (
      <MemoryRouter future={FUTURE}><Harness k="q=a" ready={ready} /></MemoryRouter>
    );
    const { rerender } = render(ui(false));
    rerender(ui(true));
    expect(scroller().scrollTop).toBe(200);
    scroller().scrollTop = 50;
    rerender(ui(true));
    expect(scroller().scrollTop).toBe(50);
  });

  it('giá trị đã lưu hỏng / không phải số / âm → bỏ qua, không đặt scrollTop', () => {
    for (const bad of ['abc', '-5', '', 'NaN']) {
      sessionStorage.setItem(`${SCROLL_KEY_PREFIX}q=bad`, bad);
      const { unmount } = render(<MemoryRouter future={FUTURE}><Harness k="q=bad" ready /></MemoryRouter>);
      expect(scroller().scrollTop).toBe(0);
      unmount();
    }
  });
});

describe('useScrollRestoration — sessionStorage không dùng được', () => {
  it('getItem ném lỗi → không vỡ trang, không đặt scrollTop', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => render(<MemoryRouter future={FUTURE}><Harness k="q=x" ready /></MemoryRouter>)).not.toThrow();
    expect(scroller().scrollTop).toBe(0);
  });

  it('setItem ném lỗi (cuộn và unmount) → không vỡ trang', () => {
    vi.useFakeTimers();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const { unmount } = render(<MemoryRouter future={FUTURE}><Harness k="q=x" ready /></MemoryRouter>);
    scroller().scrollTop = 90;
    scroller().dispatchEvent(new Event('scroll'));
    expect(() => act(() => { vi.advanceTimersByTime(200); })).not.toThrow();
    expect(() => unmount()).not.toThrow();
  });

  it('truy cập sessionStorage tự ném (bị chặn hẳn) → vẫn không vỡ', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => { throw new Error('blocked'); });
    const { unmount } = render(<MemoryRouter future={FUTURE}><Harness k="q=x" ready /></MemoryRouter>);
    expect(() => unmount()).not.toThrow();
  });
});

/** Khoá lấy từ URL như trang Danh mục: mỗi lần đổi `?…` là đổi khoá ngay trong trang đang mở. */
function LocationHarness() {
  const { search } = useLocation();
  return <Harness k={search} ready />;
}

function renderInPage(initial: string[], index = initial.length - 1) {
  return render(
    <MemoryRouter initialEntries={initial} initialIndex={index} future={FUTURE}>
      <NavProbe />
      <Routes>
        <Route path="/browse" element={<LocationHarness />} />
        <Route path="/pdp" element={<div data-testid="pdp" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('useScrollRestoration — đổi khoá ngay trong trang (hub ↔ danh sách)', () => {
  it('PUSH sang khoá khác (chạm ô danh mục ở hub) → danh sách bắt đầu từ đầu trang, vị trí hub được lưu', () => {
    renderInPage(['/browse']);
    scroller().scrollTop = 640;
    act(() => { navigate('/browse?category=a'); });
    expect(stored('')).toBe('640');
    expect(scroller().scrollTop).toBe(0);
  });

  it('Back (POP) về khoá đã lưu → khôi phục vị trí của khoá đó dù trang không bị gỡ và được mở bằng PUSH', () => {
    renderInPage(['/pdp'], 0);
    act(() => { navigate('/browse'); });
    scroller().scrollTop = 640;
    act(() => { navigate('/browse?category=a'); });
    scroller().scrollTop = 90;
    act(() => { navigate(-1); });
    expect(stored('?category=a')).toBe('90');
    expect(scroller().scrollTop).toBe(640);
  });

  it('Back rồi tiến PUSH tới khoá đã từng xem → vẫn từ đầu trang (không khôi phục khi không phải POP)', () => {
    renderInPage(['/browse']);
    scroller().scrollTop = 640;
    act(() => { navigate('/browse?category=a'); });
    act(() => { navigate(-1); });
    act(() => { navigate('/browse?category=a'); });
    expect(scroller().scrollTop).toBe(0);
  });

  it('PUSH lại đúng URL khi trang vẫn còn gắn (Back rồi chạm ngay lúc trang cũ chưa trượt ra hết, zmp-ui dùng lại phần tử) → về đầu trang', () => {
    renderInPage(['/browse?sort=best_seller']);
    scroller().scrollTop = 900;
    act(() => { navigate('/browse?sort=best_seller'); });
    expect(scroller().scrollTop).toBe(0);
  });

  it('REPLACE đúng URL hiện tại → giữ nguyên vị trí cuộn', () => {
    renderInPage(['/browse?sort=best_seller']);
    scroller().scrollTop = 900;
    act(() => { navigate('/browse?sort=best_seller', { replace: true }); });
    expect(scroller().scrollTop).toBe(900);
  });

  it('REPLACE sang khoá khác (đổi sắp xếp, gỡ chip) → giữ nguyên vị trí cuộn', () => {
    renderInPage(['/browse?all=1']);
    scroller().scrollTop = 300;
    act(() => { navigate('/browse?sort=newest', { replace: true }); });
    expect(scroller().scrollTop).toBe(300);
  });

  it('nội dung mới ngắn hơn làm trình duyệt kẹp scrollTop → vẫn lưu vị trí đọc TRƯỚC khi đổi, không phải giá trị đã bị kẹp', () => {
    let maxScroll = 10_000;
    const base = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get(this: Element) { return Math.min(base.get!.call(this) as number, maxScroll); },
      set(this: Element, v: number) { base.set!.call(this, v); },
    });
    function ShorterContent() {
      const { search } = useLocation();
      maxScroll = search ? 100 : 10_000; // nội dung của khoá mới chỉ cao 100px
      return null;
    }
    render(
      <MemoryRouter initialEntries={['/browse']} future={FUTURE}>
        <NavProbe />
        <Routes>
          <Route path="/browse" element={<><LocationHarness /><ShorterContent /></>} />
        </Routes>
      </MemoryRouter>,
    );
    scroller().scrollTop = 640;
    act(() => { navigate('/browse?category=a'); });
    expect(stored('')).toBe('640');
  });
});
