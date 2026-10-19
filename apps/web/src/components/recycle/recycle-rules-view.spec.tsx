// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Chép ý recycle-rules.spec.tsx (Mini App, §14.2): thể lệ do admin soạn giữ xuống dòng, chưa có thì dòng chờ, lỗi có "Thử lại".
// Khác Mini App: trang công khai, thể lệ có sẵn từ server (ISR) thì không gọi API từ trình duyệt.

const state = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: state.get, post: vi.fn() } }));

import { RecycleRulesView } from './recycle-rules-view';

let mounted: Rendered[] = [];
const mount = async (initialText?: string | null) => {
  const r = render(<RecycleRulesView initialText={initialText} />);
  mounted.push(r);
  await flush(6);
  return r.container;
};

beforeEach(() => state.get.mockReset());
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/doi-rac/quy-dinh (§14.2)', () => {
  it('thể lệ có sẵn từ server: hiện ngay, giữ xuống dòng, không gọi API', async () => {
    const c = await mount('Điểm Xanh là ưu đãi cho khách.\nKhông đổi ra tiền.');
    const body = byText(c, 'div', 'Điểm Xanh là ưu đãi cho khách.')!;
    expect(body.className).toContain('whitespace-pre-line');
    expect(c.querySelectorAll('h1')).toHaveLength(1);
    expect(state.get).not.toHaveBeenCalled();
  });

  it('chưa có thể lệ (null) → dòng "Thể lệ đang được cập nhật"', async () => {
    const c = await mount(null);
    expect(c.textContent).toContain('Thể lệ đang được cập nhật');
  });

  it('server không đọc được: tải từ trình duyệt qua /waste/rules', async () => {
    state.get.mockResolvedValue({ text: 'Từ trình duyệt' });
    const c = await mount();
    expect(state.get).toHaveBeenCalledWith('/waste/rules');
    expect(c.textContent).toContain('Từ trình duyệt');
  });

  it('lỗi → nút Thử lại gọi lại', async () => {
    state.get.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue({ text: 'OK' });
    const c = await mount();
    expect(c.textContent).toContain('mất mạng');
    click(byText(c, 'button', 'Thử lại'));
    await flush(6);
    expect(c.textContent).toContain('OK');
  });
});

describe('/doi-rac/quy-dinh — diện mạo Mini App ở điện thoại', () => {
  it('đoạn thể lệ cỡ body-md như Mini App', async () => {
    const c = await mount('Thể lệ.');
    expect(byText(c, 'div', 'Thể lệ.')!.className).toContain('max-md:text-[length:var(--type-body-md-size)]');
  });
});
