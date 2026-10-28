// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GameQuizAdmin } from './game-quiz-tab';
import { byText, click, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(
    <QueryClientProvider client={qc}>
      <GameQuizAdmin />
    </QueryClientProvider>,
  );
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const QUIZ = {
  id: 'q1',
  question: 'Chai nhựa mất bao lâu để phân huỷ?',
  options: ['5 năm', '450 năm', '10 ngày'],
  correct: 1,
  category: 'tai_che',
  difficulty: 2,
  explanation: 'Khoảng 450 năm.',
  waterReward: 10,
};

function stub(opts: { total?: number; fail?: { status: number; body: unknown } } = {}) {
  const m = mockFetch({
    '/admin/engagement/quiz/': (init) => opts.fail ?? { body: { ...QUIZ, ...JSON.parse(String(init?.body ?? '{}')) } },
    '/admin/engagement/quiz': (init) => {
      if (init?.method === 'POST') return opts.fail ?? { status: 201, body: { ...QUIZ, id: 'q-new' } };
      return { body: { data: [QUIZ], meta: { page: 1, limit: 20, total: opts.total ?? 1 } } };
    },
  });
  vi.stubGlobal('fetch', vi.fn(m.fn));
  return {
    posts: () => m.calls.filter((c) => c.init?.method === 'POST'),
    patches: () => m.calls.filter((c) => c.init?.method === 'PATCH'),
    gets: () => m.calls.filter((c) => !c.init?.method || c.init.method === 'GET'),
  };
}

describe('GameQuizAdmin (câu đố hằng ngày)', () => {
  it('liệt kê câu đố: đáp án đúng, chủ đề, độ khó, nước thưởng; không có nút xoá hay tắt', async () => {
    stub();
    const { container } = mount();
    await flush();
    const row = container.querySelector<HTMLElement>('[data-quiz="q1"]')!;
    expect(row.textContent).toContain('Chai nhựa mất bao lâu để phân huỷ?');
    expect(row.textContent).toContain('450 năm (đáp án đúng)');
    expect(row.textContent).toContain('Tái chế');
    expect(row.textContent).toContain('Vừa');
    expect(row.textContent).toContain('thưởng 10 nước');
    expect(byText(row, 'button', /Xoá|Tắt|Tạm dừng/)).toBeNull();
    expect(container.textContent).toContain('có thể làm bộ câu của hôm nay đổi');
  });

  it('thêm câu đố: bỏ ô đáp án trống, tính lại vị trí đáp án đúng, gửi POST không có điểm thưởng', async () => {
    const api = stub();
    const { container } = mount();
    await flush();
    click(byText(container, 'button', 'Thêm câu đố'));
    const form = container.querySelector<HTMLFormElement>('form[aria-label="Thêm câu đố"]')!;
    const submit = byText(form, 'button', 'Thêm câu đố') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    typeInto(form.querySelector('textarea[name="question"]'), '  Cây nào hút CO2 nhiều nhất?  ');
    typeInto(form.querySelector('input[name="option-1"]'), 'Cây xanh');
    expect(form.textContent).toContain('Cần ít nhất 2 đáp án');
    typeInto(form.querySelector('input[name="option-3"]'), 'Cây giả');
    typeInto(form.querySelector('input[name="option-4"]'), 'Đá');
    // Đáp án đúng là ô 3 ("Cây giả"): sau khi bỏ ô 2 trống thì nằm ở vị trí 1.
    click(form.querySelector('input[aria-label="Đáp án 3 là đáp án đúng"]'));
    selectValue(form.querySelector('select[name="category"]'), 'cay');
    selectValue(form.querySelector('select[name="difficulty"]'), '3');
    expect(form.textContent).toContain('Khách đáp đúng nhận 12 nước, không nhận điểm.');
    expect(submit.disabled).toBe(false);
    click(submit);
    await flush();
    const [post] = api.posts();
    expect(post!.url).toContain('/admin/engagement/quiz');
    expect(JSON.parse(String(post!.init!.body))).toEqual({
      question: 'Cây nào hút CO2 nhiều nhất?',
      options: ['Cây xanh', 'Cây giả', 'Đá'],
      correct: 1,
      category: 'cay',
      difficulty: 3,
      explanation: '',
    });
    expect(container.querySelector('form[aria-label="Thêm câu đố"]')).toBeNull();
    const note = container.querySelector('[role="status"]');
    expect(note?.textContent).toContain('Đã thêm câu đố: Cây nào hút CO2 nhiều nhất?');
    click(byText(container, 'button', 'Thêm câu đố'));
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('đáp án đúng trỏ vào ô trống thì khoá nút lưu và nói rõ', async () => {
    stub();
    const { container } = mount();
    await flush();
    click(byText(container, 'button', 'Thêm câu đố'));
    const form = container.querySelector<HTMLFormElement>('form[aria-label="Thêm câu đố"]')!;
    typeInto(form.querySelector('textarea[name="question"]'), 'Câu hỏi?');
    typeInto(form.querySelector('input[name="option-1"]'), 'A');
    typeInto(form.querySelector('input[name="option-2"]'), 'B');
    click(form.querySelector('input[aria-label="Đáp án 4 là đáp án đúng"]'));
    expect(form.textContent).toContain('Chọn đáp án đúng trong các đáp án đã nhập.');
    expect((byText(form, 'button', 'Thêm câu đố') as HTMLButtonElement).disabled).toBe(true);
    click(form.querySelector('input[aria-label="Đáp án 2 là đáp án đúng"]'));
    typeInto(form.querySelector('input[name="option-2"]'), ' a ');
    expect(form.textContent).toContain('Các đáp án không được trùng nhau.');
  });

  it('sửa câu đố: điền sẵn nội dung cũ, PATCH đúng id, hiện lỗi máy chủ nguyên văn', async () => {
    const api = stub({ fail: { status: 400, body: { message: 'Đáp án đúng phải là một trong các đáp án đã nhập.' } } });
    const { container } = mount();
    await flush();
    const row = container.querySelector<HTMLElement>('[data-quiz="q1"]')!;
    click(byText(row, 'button', 'Sửa'));
    const form = container.querySelector<HTMLFormElement>('form[aria-label="Sửa câu đố"]')!;
    expect((form.querySelector('input[name="option-2"]') as HTMLInputElement).value).toBe('450 năm');
    expect((form.querySelector('input[aria-label="Đáp án 2 là đáp án đúng"]') as HTMLInputElement).checked).toBe(true);
    expect((form.querySelector('input[name="option-4"]') as HTMLInputElement).value).toBe('');
    typeInto(form.querySelector('textarea[name="question"]'), 'Chai nhựa phân huỷ sau bao lâu?');
    click(byText(form, 'button', 'Lưu'));
    await flush();
    const [patch] = api.patches();
    expect(patch!.url).toContain('/admin/engagement/quiz/q1');
    expect(JSON.parse(String(patch!.init!.body))).toMatchObject({ question: 'Chai nhựa phân huỷ sau bao lâu?', options: ['5 năm', '450 năm', '10 ngày'], correct: 1 });
    expect(form.textContent).toContain('Đáp án đúng phải là một trong các đáp án đã nhập.');
  });

  it('nhiều trang: có nút Trang sau và gọi trang 2', async () => {
    const api = stub({ total: 45 });
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Hiển thị 1–1/45');
    click(byText(container, 'button', /Trang sau/));
    await flush();
    expect(api.gets().some((c) => c.url.includes('page=2'))).toBe(true);
  });
});
