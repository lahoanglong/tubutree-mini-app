// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

type Reply = { reply: string; products: unknown[] };

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  replace: vi.fn(),
  retrySession: vi.fn(),
  config: { aiAdvisorEnabled: true } as Record<string, unknown> | null,
  chat: (() => ({ reply: '', products: [] })) as (body: { message: string; history: unknown[] }) => unknown,
  calls: [] as { path: string; body: { message: string; history: { role: string; content: string }[] } }[],
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: state.retrySession }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: state.replace, push: vi.fn() }),
  usePathname: () => '/tu-van',
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      if (path === '/config/public') {
        if (state.config === null) return new Promise(() => {});
        return state.config;
      }
      throw new Error(`chưa mock ${path}`);
    },
    post: async (path: string, body: { message: string; history: { role: string; content: string }[] }) => {
      state.calls.push({ path, body });
      return state.chat(body);
    },
  },
}));

import AdvisorPage from './page';

const PRODUCT = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Nước rửa chén ${id}`,
  slug: `nuoc-rua-chen-${id}`,
  brand: 'Tubu',
  shortDesc: null,
  thumbnail: `https://img.test/${id}.jpg`,
  basePrice: 90_000,
  salePrice: null,
  ...over,
});
const REPLY = (reply = 'Mình gợi ý bạn thử loại này', products: unknown[] = []): Reply => ({ reply, products });

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<AdvisorPage />);
  mounted.push(r);
  await flush(6);
  return r.container;
};
const input = (c: HTMLElement) => c.querySelector('textarea') as HTMLTextAreaElement;
const sendBtn = (c: HTMLElement) => byText(c, 'button', /^Gửi$/) as HTMLButtonElement;
const ask = async (c: HTMLElement, text: string) => {
  typeInto(input(c), text);
  click(sendBtn(c));
  await flush(4);
};
const key = (el: Element, init: KeyboardEventInit & { keyCode?: number }) => {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
};

beforeEach(() => {
  state.phase = 'authenticated';
  state.config = { aiAdvisorEnabled: true };
  state.calls = [];
  state.replace.mockReset();
  state.chat = () => REPLY();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('Trợ lý AI: trạng thái trang', () => {
  it('khách: cổng đăng nhập mang returnTo, không gọi chat', async () => {
    state.phase = 'guest';
    const c = await mount();
    expect(c.querySelector('a[href="/dang-nhap?returnTo=%2Ftu-van"]')).not.toBeNull();
    expect(c.querySelector('textarea')).toBeNull();
  });

  it('đang khôi phục phiên: chỉ khung chờ', async () => {
    state.phase = 'loading';
    const c = await mount();
    expect(c.textContent).toContain('Đang tải…');
    expect(c.querySelector('textarea')).toBeNull();
  });

  it('mất kết nối lúc khôi phục phiên: nói đúng chuyện đó, không mời đăng nhập', async () => {
    state.phase = 'unavailable';
    const c = await mount();
    expect(c.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(c.querySelector('a[href^="/dang-nhap"]')).toBeNull();
  });

  it('server báo tắt AI: về Trang chủ, không dựng khung chat', async () => {
    state.config = { aiAdvisorEnabled: false };
    const c = await mount();
    expect(state.replace).toHaveBeenCalledWith('/');
    expect(c.querySelector('textarea')).toBeNull();
  });

  it('server chưa trả cấu hình: không chuyển hướng', async () => {
    state.config = null;
    await mount();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it('server báo bật: không chuyển hướng', async () => {
    await mount();
    expect(state.replace).not.toHaveBeenCalled();
  });
});

describe('Trợ lý AI: hội thoại', () => {
  it('chưa có tin nhắn: lời chào, 3 câu gợi ý và lưu ý tham khảo', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Tư vấn sản phẩm tiêu dùng xanh 24/7');
    expect(c.textContent).toContain('Chào bạn! Mình là Trợ lý Tubu');
    expect(c.textContent).toContain('Nước rửa chén nào an toàn cho bé?');
    expect(c.textContent).toContain('Mình cần sản phẩm tẩy rửa nhà bếp xanh');
    expect(c.textContent).toContain('Gợi ý quà tặng sống xanh');
    expect(c.textContent).toContain('Gợi ý chỉ để tham khảo.');
  });

  it('bấm câu gợi ý gửi đúng câu đó tới /ai-advisor/chat, ẩn phần chào và hiện câu trả lời', async () => {
    const c = await mount();
    click(byText(c, 'button', 'Gợi ý quà tặng sống xanh'));
    await flush(4);
    expect(state.calls).toEqual([{ path: '/ai-advisor/chat', body: { message: 'Gợi ý quà tặng sống xanh', history: [] } }]);
    expect(c.textContent).toContain('Mình gợi ý bạn thử loại này');
    expect(c.textContent).not.toContain('Chào bạn! Mình là Trợ lý Tubu');
  });

  it('gõ và bấm Gửi: cắt khoảng trắng hai đầu, xoá ô nhập, hiện tin của bạn rồi câu trả lời', async () => {
    const c = await mount();
    await ask(c, '  Có nước giặt không?  ');
    expect(state.calls[0]!.body.message).toBe('Có nước giặt không?');
    expect(input(c).value).toBe('');
    expect(c.textContent).toContain('Có nước giặt không?');
    expect(c.textContent).toContain('Mình gợi ý bạn thử loại này');
  });

  it('ô nhập giới hạn 500 ký tự, có tên truy cập; khung chat là role=log', async () => {
    const c = await mount();
    expect(input(c).maxLength).toBe(500);
    expect(input(c).getAttribute('aria-label')).toBe('Nhập câu hỏi');
    expect(c.querySelector('[role="log"][aria-label="Cuộc trò chuyện"]')).not.toBeNull();
  });

  it('ô nhập trống hoặc chỉ có khoảng trắng: nút Gửi khoá, không gửi', async () => {
    const c = await mount();
    expect(sendBtn(c).disabled).toBe(true);
    typeInto(input(c), '   ');
    expect(sendBtn(c).disabled).toBe(true);
    click(sendBtn(c));
    expect(state.calls).toHaveLength(0);
    typeInto(input(c), 'a');
    expect(sendBtn(c).disabled).toBe(false);
  });

  it('tin sau kèm lịch sử các lượt trước, chỉ role + content', async () => {
    state.chat = () => REPLY('Câu trả lời 1', [PRODUCT('a')]);
    const c = await mount();
    await ask(c, 'Câu hỏi 1');
    await ask(c, 'Câu hỏi 2');
    const { message, history } = state.calls[1]!.body;
    expect(message).toBe('Câu hỏi 2');
    expect(history.slice(0, 2)).toEqual([
      { role: 'user', content: 'Câu hỏi 1' },
      { role: 'assistant', content: 'Câu trả lời 1' },
    ]);
    for (const turn of history) expect(Object.keys(turn).sort()).toEqual(['content', 'role']);
  });

  it('lịch sử gửi lên chỉ giữ 20 lượt gần nhất', async () => {
    const c = await mount();
    for (let i = 1; i <= 12; i++) await ask(c, `hỏi ${i}`);
    const history = state.calls[11]!.body.history;
    expect(history).toHaveLength(20);
    expect(history.some((t) => t.content === 'hỏi 1')).toBe(false);
  });

  it('đang soạn: hiện "Trợ lý đang soạn…" (role=status), Gửi lần nữa không gửi thêm, nút Gửi báo đang tải', async () => {
    state.chat = () => new Promise(() => {});
    const c = await mount();
    await ask(c, 'Câu 1');
    expect(c.querySelector('[role="status"]')?.textContent).toContain('Trợ lý đang soạn…');
    expect(sendBtn(c).getAttribute('aria-busy')).toBe('true');
    typeInto(input(c), 'Câu 2');
    click(sendBtn(c));
    key(input(c), { key: 'Enter' });
    await flush(2);
    expect(state.calls).toHaveLength(1);
  });

  it('xong thì ẩn "Trợ lý đang soạn…"', async () => {
    const c = await mount();
    await ask(c, 'Câu 1');
    expect(c.textContent).not.toContain('Trợ lý đang soạn…');
  });

  it('nội dung trả lời là chữ thuần, không dựng HTML', async () => {
    state.chat = () => REPLY('<img src=x onerror=alert(1)><b>đậm</b>');
    const c = await mount();
    await ask(c, 'Câu 1');
    expect(c.querySelector('[role="log"] img[src="x"]')).toBeNull();
    expect(c.querySelector('[role="log"] b')).toBeNull();
    expect(c.textContent).toContain('<b>đậm</b>');
  });
});

describe('Trợ lý AI: sản phẩm gợi ý', () => {
  it('tên, giá khuyến mãi nếu có (không thì giá gốc), ảnh; liên kết tới /san-pham/[slug]', async () => {
    state.chat = () => REPLY('Đây nhé', [PRODUCT('a', { salePrice: 70_000 }), PRODUCT('b', { thumbnail: null })]);
    const c = await mount();
    await ask(c, 'Gợi ý đi');
    expect(c.textContent).toContain('Nước rửa chén a');
    expect(c.textContent).toContain('70.000đ');
    expect(c.textContent).toContain('90.000đ');
    expect(c.querySelector('img[alt="Nước rửa chén a"]')?.getAttribute('src')).toBe('https://img.test/a.jpg');
    expect(c.querySelector('img[alt="Nước rửa chén b"]')).toBeNull();
    const links = Array.from(c.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/san-pham/nuoc-rua-chen-a');
    expect(links).toContain('/san-pham/nuoc-rua-chen-b');
  });
});

describe('Trợ lý AI: bàn phím', () => {
  it('Enter gửi tin và xoá ô nhập', async () => {
    const c = await mount();
    typeInto(input(c), 'Có nước giặt không?');
    const ev = key(input(c), { key: 'Enter' });
    await flush(4);
    expect(ev.defaultPrevented).toBe(true);
    expect(state.calls[0]!.body.message).toBe('Có nước giặt không?');
    expect(input(c).value).toBe('');
  });

  it('Shift+Enter xuống dòng: không gửi, không chặn phím', async () => {
    const c = await mount();
    typeInto(input(c), 'dòng 1');
    const ev = key(input(c), { key: 'Enter', shiftKey: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(state.calls).toHaveLength(0);
    expect(input(c).value).toBe('dòng 1');
  });

  it('Enter khi bộ gõ đang chốt chữ (isComposing / keyCode 229): không gửi', async () => {
    const c = await mount();
    typeInto(input(c), 'nuoc');
    key(input(c), { key: 'Enter', isComposing: true });
    key(input(c), { key: 'Enter', keyCode: 229 });
    expect(state.calls).toHaveLength(0);
    expect(input(c).value).toBe('nuoc');
  });

  it('Enter khi ô trống: không gửi', async () => {
    const c = await mount();
    key(input(c), { key: 'Enter' });
    expect(state.calls).toHaveLength(0);
  });
});

describe('Trợ lý AI: lỗi và thử lại', () => {
  const FAIL = 'Xin lỗi, mình chưa trả lời được lúc này 🌿';

  it('lỗi: báo lỗi, thêm tin xin lỗi kèm nút Thử lại', async () => {
    state.chat = () => {
      throw new Error('Hết hạn mức');
    };
    const c = await mount();
    await ask(c, 'Xin chào');
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Hết hạn mức');
    expect(c.textContent).toContain(FAIL);
    expect(byText(c, 'button', 'Thử lại')).not.toBeNull();
  });

  it('Thử lại gửi lại đúng câu cũ, bỏ tin xin lỗi, không nhân đôi tin của bạn', async () => {
    let n = 0;
    state.chat = () => {
      if (n++ === 0) throw new Error('Hết hạn mức');
      return REPLY('Trả lời sau khi thử lại');
    };
    const c = await mount();
    await ask(c, 'Xin chào');
    click(byText(c, 'button', 'Thử lại'));
    await flush(4);
    expect(state.calls[1]!.body).toEqual({ message: 'Xin chào', history: [] });
    expect(c.textContent).toContain('Trả lời sau khi thử lại');
    expect(c.textContent).not.toContain(FAIL);
    expect(byText(c, 'button', 'Thử lại')).toBeNull();
    expect(c.textContent!.split('Xin chào')).toHaveLength(2);
  });

  it('Thử lại giữ lịch sử các lượt trước, không kèm tin xin lỗi và chính câu hỏi lại', async () => {
    let n = 0;
    state.chat = () => {
      n++;
      if (n === 2) throw new Error('lỗi mạng');
      return REPLY(`Trả lời ${n}`);
    };
    const c = await mount();
    await ask(c, 'Câu 1');
    await ask(c, 'Câu 2');
    click(byText(c, 'button', 'Thử lại'));
    await flush(4);
    expect(state.calls[2]!.body.message).toBe('Câu 2');
    expect(state.calls[2]!.body.history).toEqual([
      { role: 'user', content: 'Câu 1' },
      { role: 'assistant', content: 'Trả lời 1' },
    ]);
  });

  it('Thử lại vẫn lỗi: chỉ một tin xin lỗi và một nút Thử lại', async () => {
    state.chat = () => {
      throw new Error('Hết hạn mức');
    };
    const c = await mount();
    await ask(c, 'Xin chào');
    click(byText(c, 'button', 'Thử lại'));
    await flush(4);
    expect(c.textContent!.split(FAIL)).toHaveLength(2);
    expect(Array.from(c.querySelectorAll('button')).filter((b) => b.textContent === 'Thử lại')).toHaveLength(1);
  });

  it('hỏi câu mới thì nút Thử lại cũ biến mất', async () => {
    let n = 0;
    state.chat = () => {
      if (n++ === 0) throw new Error('lỗi');
      return REPLY('Ổn rồi');
    };
    const c = await mount();
    await ask(c, 'Câu 1');
    await ask(c, 'Câu 2');
    expect(byText(c, 'button', 'Thử lại')).toBeNull();
  });
});

describe('Trợ lý AI: tự cuộn', () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  it('chưa có tin thì không cuộn; gửi tin thì cuộn, có trả lời thì cuộn tiếp tới tin mới nhất', async () => {
    let answer: (v: Reply) => void = () => {};
    state.chat = () => new Promise<Reply>((r) => (answer = r));
    const c = await mount();
    expect(scrollIntoView).not.toHaveBeenCalled();
    await ask(c, 'Xin chào');
    const afterQuestion = scrollIntoView.mock.calls.length;
    expect(afterQuestion).toBeGreaterThanOrEqual(1);
    await act(async () => answer(REPLY('Trả lời đây')));
    await flush(3);
    expect(scrollIntoView.mock.calls.length).toBeGreaterThan(afterQuestion);
    expect(scrollIntoView.mock.calls.at(-1)![0]).toMatchObject({ block: 'end' });
  });
});

describe('Trợ lý AI: tiêu đề và trợ năng', () => {
  it('đúng một h1 "Trợ lý AI Tubu", không tiêu đề lệch cấp, mọi nút có tên, vùng chạm đủ 44px', async () => {
    state.chat = () => REPLY('Đây nhé', [PRODUCT('a')]);
    const c = await mount();
    expect(c.querySelectorAll('h1')).toHaveLength(1);
    expect(c.querySelector('h1')?.textContent).toBe('Trợ lý AI Tubu');
    await ask(c, 'Xin chào');
    expect(c.querySelectorAll('h1')).toHaveLength(1);
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});

describe('Trợ lý AI: thanh nhập', () => {
  it('thanh nhập dính đáy trang (trang này không có thanh đáy), chừa vùng an toàn, không lơ lửng cách đáy 64px', async () => {
    const c = await mount();
    const bar = input(c).parentElement as HTMLElement;
    expect(bar.className).toContain('sticky');
    expect(bar.className).toContain('bottom-0');
    expect(bar.className).not.toContain('bottom-16');
    expect(bar.className).toContain('env(safe-area-inset-bottom)');
  });

  it('thông báo lỗi nổi trên thanh nhập ở mọi cỡ màn hình, không đè vào ô nhập trên desktop', async () => {
    state.chat = () => {
      throw new Error('Hết hạn mức');
    };
    const c = await mount();
    await ask(c, 'Xin chào');
    const box = document.body.querySelector('[role="alert"]')?.parentElement as HTMLElement;
    expect(box.className).not.toContain('md:bottom-6');
    expect(box.className).toContain('bottom-[calc(76px+env(safe-area-inset-bottom))]');
  });
});

describe('Trợ lý AI: giao diện điện thoại như Mini App', () => {
  it('thanh nhập dính đáy màn hình ở điện thoại (fixed), ô nhập cao như Mini App; máy tính giữ sticky', async () => {
    const c = await mount();
    const bar = input(c).parentElement as HTMLElement;
    expect(bar.className).toContain('max-md:fixed');
    expect(bar.className).toContain('max-md:inset-x-0');
    expect(input(c).className).toContain('max-md:min-h-[9rem]');
    expect(bar.className).toContain('sticky');
  });

  it('thân trang chừa chỗ cho thanh nhập cố định để tin cuối không bị che', async () => {
    const c = await mount();
    expect((c.querySelector('[role="log"]')!.parentElement as HTMLElement).className).toContain('max-md:pb-');
  });

  it('3 gợi ý là thẻ viền mảnh không bóng, chữ đậm', async () => {
    const c = await mount();
    const s = byText(c, 'button', 'Gợi ý quà tặng sống xanh')!;
    expect(s.className).toContain('max-md:shadow-none');
    expect(s.className).toContain('max-md:font-semibold');
  });

  it('tiêu đề trên thanh trắng, trang bỏ đệm đỉnh', async () => {
    const c = await mount();
    expect(c.querySelector('main')!.className).toContain('max-md:pt-0');
    expect(c.querySelector('h1')!.closest('header')!.parentElement!.className).toContain('max-md:bg-stone-0');
  });

  it('thông báo lỗi nâng lên trên thanh nhập cao ở điện thoại', async () => {
    state.chat = () => {
      throw new Error('Hết hạn mức');
    };
    const c = await mount();
    await ask(c, 'Xin chào');
    const box = document.body.querySelector('[role="alert"]')?.parentElement as HTMLElement;
    expect(box.className).toContain('max-md:bottom-[calc(11.5rem+env(safe-area-inset-bottom))]');
  });
});

