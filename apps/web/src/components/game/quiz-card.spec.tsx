// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gameMoreCopy } from '@tubutree/app-core/game-more-copy';
import type { QuizItem } from '@tubutree/app-core/api/game';
import { byText, click, render, type Rendered } from '@/test-utils/dom';
import { QuizCard, type QuizReveal } from './quiz-card';

// Cùng các ca với quiz-card.spec.tsx của Mini App.

const t = gameMoreCopy.quiz;

const Q1: QuizItem = { id: 'q1', question: 'Cây nào hấp thụ nhiều CO₂ nhất?', options: ['Cây xanh', 'Cây khô', 'Cây giả'], category: 'cay', difficulty: 1, waterReward: 5 };
const Q2: QuizItem = { id: 'q2', question: 'Chai nhựa phân huỷ mất bao lâu?', options: ['Một tuần', 'Hàng trăm năm'], category: 'tai_che', difficulty: 3, waterReward: 1_200 };
const Q3: QuizItem = { id: 'q3', question: 'Tắt đèn khi ra khỏi phòng để làm gì?', options: ['Tiết kiệm điện', 'Cho vui'], category: 'nang_luong', difficulty: 2, waterReward: 7 };
const SET = [Q1, Q2, Q3];

const reveal = (over: Partial<QuizReveal> = {}): QuizReveal => ({ quizId: 'q1', choice: 1, isCorrect: false, correct: 0, waterEarned: 0, explanation: null, ...over });

type Props = Parameters<typeof QuizCard>[0];

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function setup(over: Partial<Props> = {}) {
  const onAnswer = vi.fn();
  const onNext = vi.fn();
  const onRetry = vi.fn();
  let cur: Props = { quiz: SET, currentQuiz: Q1, answeredCount: 0, reveal: null, pending: false, onAnswer, onNext, onRetry, ...over };
  // Cập nhật phải bọc đúng provider mà `render` đã dùng, nếu không React dựng lại cả cây và ref mất theo.
  const qc = new QueryClient();
  const r = render(<QuizCard {...cur} />, qc);
  mounted = r;
  return {
    c: r.container,
    onAnswer,
    onNext,
    onRetry,
    update: (next: Partial<Props>) => {
      cur = { ...cur, ...next };
      act(() => {
        r.root.render(
          <QueryClientProvider client={qc}>
            <QuizCard {...cur} />
          </QueryClientProvider>,
        );
      });
    },
  };
}
const option = (c: HTMLElement, name: string) => byText(c, 'button', name) as HTMLButtonElement;
const tabular = (el: Element | null) => !!el && el.classList.contains('tabular-nums');
const status = (c: HTMLElement) => c.querySelector('[role="status"]');
/** Phần tử sâu nhất có chữ khớp (chính xác nếu là chuỗi, theo biểu thức nếu là regex). */
const leaf = (c: HTMLElement, text: string | RegExp) => {
  const match = (e: Element) => (typeof text === 'string' ? e.textContent === text : text.test(e.textContent ?? ''));
  return Array.from(c.querySelectorAll<HTMLElement>('span, div, p')).find((e) => match(e) && !Array.from(e.children).some(match))!;
};
const twice = (el: HTMLElement) =>
  act(() => {
    el.click();
    el.click();
  });

describe('QuizCard (web) — trạng thái không có câu để làm', () => {
  it('đang tải: dòng chờ là vùng trạng thái (role=status)', () => {
    const { c } = setup({ quiz: undefined, currentQuiz: undefined });
    expect(status(c)?.textContent).toBe(t.loading);
  });

  it('tải lỗi khi chưa có danh sách: hiện thẻ lỗi, "Thử lại" gọi onRetry, không còn dòng chờ', () => {
    const { c, onRetry } = setup({ quiz: undefined, currentQuiz: undefined, loadError: true });
    expect(c.textContent).toContain(t.loadErrorTitle);
    expect(c.textContent).not.toContain(t.loading);
    click(byText(c, 'button', 'Thử lại'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('đã có danh sách rỗng thì lỗi tải không che chữ "chưa có câu"', () => {
    const { c } = setup({ quiz: [], currentQuiz: undefined, loadError: true });
    expect(c.textContent).not.toContain(t.loadErrorTitle);
    expect(c.textContent).toContain(t.empty);
  });

  it.each([
    ['không có câu nào, hôm nay chưa làm câu nào', [], undefined, t.empty],
    ['không có câu nào, hôm nay làm 0 câu', [], 0, t.empty],
    ['không có câu nào nhưng hôm nay đã làm câu', [], 2, t.done],
    ['còn danh sách mà đã làm hết câu', SET, undefined, t.done],
  ])('%s', (_label, quiz, answeredToday, text) => {
    const { c } = setup({ quiz, currentQuiz: undefined, answeredToday });
    expect(c.textContent).toContain(text);
    expect(status(c)).toBeNull();
  });
});

describe('QuizCard (web) — đầu thẻ', () => {
  it('nhãn loại · độ khó, bộ đếm câu và thưởng giọt nước dùng số đều', () => {
    const { c } = setup({ currentQuiz: Q2, answeredCount: 1 });
    const label = leaf(c, /Tái chế/);
    expect(label.textContent).toBe('♻️ Tái chế · Khó · Câu 2/3');
    expect(tabular(label)).toBe(true);
    expect(tabular(leaf(c, '+1.200💧'))).toBe(true);
  });

  it('chỉ một câu: không có bộ đếm "Câu x/y"', () => {
    const { c } = setup({ quiz: [Q1], currentQuiz: Q1 });
    expect(leaf(c, /Cây cối/).textContent).toBe('🌳 Cây cối · Dễ');
  });
});

describe('QuizCard (web) — chọn đáp án', () => {
  it('bấm một đáp án: gọi onAnswer(id câu, vị trí đáp án) một lần', () => {
    const { c, onAnswer } = setup();
    click(option(c, 'Cây khô'));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith('q1', 1);
  });

  it('hai cú bấm cùng nhịp (kể cả hai đáp án khác nhau): chỉ gửi một đáp án', () => {
    const { c, onAnswer } = setup();
    act(() => {
      option(c, 'Cây xanh').click();
      option(c, 'Cây giả').click();
    });
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith('q1', 0);
  });

  it('chờ trang cha báo đang gửi: vẽ lại với cùng props vẫn không gửi lần hai', () => {
    const { c, onAnswer, update } = setup();
    click(option(c, 'Cây xanh'));
    update({ pending: false });
    click(option(c, 'Cây xanh'));
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it('đang gửi: các nút đáp án bị khoá', () => {
    const { c, onAnswer } = setup({ pending: true });
    expect(option(c, 'Cây xanh').disabled).toBe(true);
    click(option(c, 'Cây xanh'));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('gửi xong mà không ra đáp án (lỗi mạng): nhả khoá để chọn lại được', () => {
    const { c, onAnswer, update } = setup();
    click(option(c, 'Cây xanh'));
    update({ pending: true });
    update({ pending: false });
    click(option(c, 'Cây xanh'));
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it('sang câu khác: nhả khoá, chọn được đáp án của câu mới', () => {
    const { c, onAnswer, update } = setup();
    click(option(c, 'Cây xanh'));
    update({ currentQuiz: Q2, answeredCount: 1 });
    click(option(c, 'Một tuần'));
    expect(onAnswer).toHaveBeenLastCalledWith('q2', 0);
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it('sang câu khác rồi quay lại đúng câu cũ (bộ câu đố được làm mới): nhả khoá, chọn lại được', () => {
    const { c, onAnswer, update } = setup();
    click(option(c, 'Cây xanh'));
    update({ currentQuiz: Q2, answeredCount: 1 });
    update({ currentQuiz: Q1, answeredCount: 0 });
    click(option(c, 'Cây xanh'));
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it('trang cha xoá đáp án mà vẫn ở câu đó: nhả khoá, chọn lại được', () => {
    const { c, onAnswer, update } = setup();
    click(option(c, 'Cây xanh'));
    update({ pending: true });
    update({ pending: false, reveal: reveal() });
    click(byText(c, 'button', 'Câu tiếp theo'));
    update({ reveal: null });
    click(option(c, 'Cây xanh'));
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it('chưa có đáp án: mọi nút đều aria-pressed="false"; câu hỏi không ép số đều', () => {
    const { c } = setup();
    for (const name of ['Cây xanh', 'Cây khô', 'Cây giả']) expect(option(c, name).getAttribute('aria-pressed')).toBe('false');
    expect(tabular(leaf(c, Q1.question))).toBe(false);
  });
});

describe('QuizCard (web) — sau khi có đáp án', () => {
  it('chỉ nút người chơi đã chọn có aria-pressed="true"; các nút khoá', () => {
    const { c } = setup({ reveal: reveal({ choice: 1, correct: 0 }) });
    expect(option(c, 'Cây xanh').getAttribute('aria-pressed')).toBe('false');
    expect(option(c, 'Cây khô').getAttribute('aria-pressed')).toBe('true');
    expect(option(c, 'Cây giả').getAttribute('aria-pressed')).toBe('false');
    for (const name of ['Cây xanh', 'Cây khô', 'Cây giả']) expect(option(c, name).disabled).toBe(true);
  });

  it('đáp án đúng: "Chính xác! +N💧" dùng số đều, kèm "Bạn có biết", nút "Câu tiếp theo"', () => {
    const { c } = setup({ reveal: reveal({ choice: 0, isCorrect: true, correct: 0, waterEarned: 1_500, explanation: 'Cây xanh quang hợp.' }) });
    const box = status(c)!;
    const line = leaf(c, 'Chính xác! +1.500💧');
    expect(box.contains(line)).toBe(true);
    expect(tabular(line)).toBe(true);
    expect(box.textContent).toContain('Bạn có biết: Cây xanh quang hợp.');
    expect(byText(c, 'button', 'Câu tiếp theo')).not.toBeNull();
  });

  it('đáp án sai: lời động viên, không có số thưởng, không có "Bạn có biết" khi thiếu lời giải', () => {
    const { c } = setup({ reveal: reveal({ isCorrect: false }) });
    expect(status(c)!.textContent).toContain('Chưa đúng — cùng học nhé 🌿');
    expect(c.textContent).not.toContain('Chính xác');
    expect(c.textContent).not.toContain('Bạn có biết');
  });

  it('đáp án của câu khác thì bỏ qua: nút vẫn mở, không có vùng trạng thái', () => {
    const { c } = setup({ reveal: reveal({ quizId: 'q2' }) });
    expect(status(c)).toBeNull();
    expect(option(c, 'Cây xanh').disabled).toBe(false);
    expect(option(c, 'Cây xanh').getAttribute('aria-pressed')).toBe('false');
  });

  it('câu cuối đổi nhãn nút thành "Hoàn thành"; câu đơn lẻ cũng vậy', () => {
    const { c, update } = setup({ currentQuiz: Q3, answeredCount: 2, reveal: reveal({ quizId: 'q3' }) });
    expect(byText(c, 'button', 'Hoàn thành')).not.toBeNull();
    update({ quiz: [Q1], currentQuiz: Q1, answeredCount: 0, reveal: reveal() });
    expect(byText(c, 'button', 'Hoàn thành')).not.toBeNull();
  });

  it('nút "Câu tiếp theo" gọi onNext một lần dù bấm đúp cùng nhịp', () => {
    const { c, onNext } = setup({ reveal: reveal() });
    twice(byText(c, 'button', 'Câu tiếp theo') as HTMLElement);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('vẽ lại với cùng đáp án: "Câu tiếp theo" vẫn chỉ gọi onNext một lần', () => {
    const r = reveal();
    const { c, onNext, update } = setup({ reveal: r });
    click(byText(c, 'button', 'Câu tiếp theo'));
    update({ reveal: r });
    click(byText(c, 'button', 'Câu tiếp theo'));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('đáp án mới của cùng câu (lượt trả lời mới): "Câu tiếp theo" bấm được lần nữa', () => {
    const { c, onNext, update } = setup({ reveal: reveal() });
    click(byText(c, 'button', 'Câu tiếp theo'));
    update({ reveal: null });
    update({ reveal: reveal() });
    click(byText(c, 'button', 'Câu tiếp theo'));
    expect(onNext).toHaveBeenCalledTimes(2);
  });
});
