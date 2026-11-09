import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { gameMoreCopy } from '@tubutree/app-core/game-more-copy';
import type { QuizItem } from '../../services/game-api';
import { QuizCard, type QuizReveal } from './quiz-card';

const t = gameMoreCopy.quiz;

const Q1: QuizItem = { id: 'q1', question: 'Cây nào hấp thụ nhiều CO₂ nhất?', options: ['Cây xanh', 'Cây khô', 'Cây giả'], category: 'cay', difficulty: 1, waterReward: 5 };
const Q2: QuizItem = { id: 'q2', question: 'Chai nhựa phân huỷ mất bao lâu?', options: ['Một tuần', 'Hàng trăm năm'], category: 'tai_che', difficulty: 3, waterReward: 1_200 };
const Q3: QuizItem = { id: 'q3', question: 'Tắt đèn khi ra khỏi phòng để làm gì?', options: ['Tiết kiệm điện', 'Cho vui'], category: 'nang_luong', difficulty: 2, waterReward: 7 };
const SET = [Q1, Q2, Q3];

const reveal = (over: Partial<QuizReveal> = {}): QuizReveal => ({ quizId: 'q1', choice: 1, isCorrect: false, correct: 0, waterEarned: 0, explanation: null, ...over });

type Props = Parameters<typeof QuizCard>[0];

function setup(over: Partial<Props> = {}) {
  const onAnswer = vi.fn();
  const onNext = vi.fn();
  const onRetry = vi.fn();
  let cur: Props = { quiz: SET, currentQuiz: Q1, answeredCount: 0, reveal: null, pending: false, onAnswer, onNext, onRetry, ...over };
  const r = render(<QuizCard {...cur} />);
  return {
    onAnswer,
    onNext,
    onRetry,
    update: (next: Partial<Props>) => {
      cur = { ...cur, ...next };
      r.rerender(<QuizCard {...cur} />);
    },
  };
}
const option = (name: string) => screen.getByRole('button', { name });
const numeric = (el: HTMLElement) => el.style.fontVariantNumeric;
const twice = (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el);
    fireEvent.click(el);
  });

describe('QuizCard — trạng thái không có câu để làm', () => {
  it('đang tải: dòng chờ là vùng trạng thái (role=status), như web', () => {
    setup({ quiz: undefined, currentQuiz: undefined });
    expect(screen.getByRole('status')).toHaveTextContent(t.loading);
  });

  it('tải lỗi khi chưa có danh sách: hiện thẻ lỗi, "Thử lại" gọi onRetry, không còn dòng chờ', () => {
    const { onRetry } = setup({ quiz: undefined, currentQuiz: undefined, loadError: true });
    expect(screen.getByText(t.loadErrorTitle)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Thử lại/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('đã có danh sách rỗng thì lỗi tải không che chữ "chưa có câu"', () => {
    setup({ quiz: [], currentQuiz: undefined, loadError: true });
    expect(screen.queryByText(t.loadErrorTitle)).not.toBeInTheDocument();
    expect(screen.getByText(t.empty)).toBeInTheDocument();
  });

  it.each([
    ['không có câu nào, hôm nay chưa làm câu nào', [], undefined, t.empty],
    ['không có câu nào, hôm nay làm 0 câu', [], 0, t.empty],
    ['không có câu nào nhưng hôm nay đã làm câu', [], 2, t.done],
    ['còn danh sách mà đã làm hết câu', SET, undefined, t.done],
  ])('%s', (_label, quiz, answeredToday, text) => {
    setup({ quiz, currentQuiz: undefined, answeredToday });
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('QuizCard — đầu thẻ', () => {
  it('nhãn loại · độ khó, bộ đếm câu và thưởng giọt nước dùng số đều', () => {
    setup({ currentQuiz: Q2, answeredCount: 1 });
    const label = screen.getByText(/Tái chế/);
    expect(label).toHaveTextContent('♻️ Tái chế · Khó · Câu 2/3');
    expect(numeric(label)).toBe('tabular-nums');
    const reward = screen.getByText('+1.200💧');
    expect(numeric(reward)).toBe('tabular-nums');
  });

  it('chỉ một câu: không có bộ đếm "Câu x/y"', () => {
    setup({ quiz: [Q1], currentQuiz: Q1 });
    expect(screen.getByText(/Cây cối/)).toHaveTextContent(/^🌳 Cây cối · Dễ$/);
  });
});

describe('QuizCard — chọn đáp án', () => {
  it('chạm một đáp án: gọi onAnswer(id câu, vị trí đáp án) một lần', () => {
    const { onAnswer } = setup();
    fireEvent.click(option('Cây khô'));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith('q1', 1);
  });

  it('hai cú chạm cùng nhịp (kể cả hai đáp án khác nhau): chỉ gửi một đáp án', async () => {
    const { onAnswer } = setup();
    await act(async () => {
      fireEvent.click(option('Cây xanh'));
      fireEvent.click(option('Cây giả'));
    });
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith('q1', 0);
  });

  it('chờ trang cha báo đang gửi: vẽ lại với cùng props vẫn không gửi lần hai', () => {
    const { onAnswer, update } = setup();
    fireEvent.click(option('Cây xanh'));
    update({ pending: false });
    fireEvent.click(option('Cây xanh'));
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it('đang gửi: các nút đáp án bị khoá', () => {
    const { onAnswer } = setup({ pending: true });
    expect(option('Cây xanh')).toBeDisabled();
    fireEvent.click(option('Cây xanh'));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('gửi xong mà không ra đáp án (lỗi mạng): nhả khoá để chọn lại được', () => {
    const { onAnswer, update } = setup();
    fireEvent.click(option('Cây xanh'));
    update({ pending: true });
    update({ pending: false });
    fireEvent.click(option('Cây xanh'));
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it('sang câu khác: nhả khoá, chọn được đáp án của câu mới', () => {
    const { onAnswer, update } = setup();
    fireEvent.click(option('Cây xanh'));
    update({ currentQuiz: Q2, answeredCount: 1 });
    fireEvent.click(option('Một tuần'));
    expect(onAnswer).toHaveBeenLastCalledWith('q2', 0);
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it('sang câu khác rồi quay lại đúng câu cũ (bộ câu đố được làm mới): nhả khoá, chọn lại được', () => {
    const { onAnswer, update } = setup();
    fireEvent.click(option('Cây xanh'));
    update({ currentQuiz: Q2, answeredCount: 1 });
    update({ currentQuiz: Q1, answeredCount: 0 });
    fireEvent.click(option('Cây xanh'));
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it('trang cha xoá đáp án mà vẫn ở câu đó: nhả khoá, chọn lại được', () => {
    const { onAnswer, update } = setup();
    fireEvent.click(option('Cây xanh'));
    update({ pending: true });
    update({ pending: false, reveal: reveal() });
    fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp theo' }));
    update({ reveal: null });
    fireEvent.click(option('Cây xanh'));
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it('chưa có đáp án: mọi nút đều aria-pressed="false"; câu hỏi không ép số đều', () => {
    setup();
    for (const name of ['Cây xanh', 'Cây khô', 'Cây giả']) expect(option(name)).toHaveAttribute('aria-pressed', 'false');
    expect(numeric(screen.getByText(Q1.question))).toBe('');
  });
});

describe('QuizCard — sau khi có đáp án', () => {
  it('chỉ nút người chơi đã chọn có aria-pressed="true"; các nút khoá', () => {
    setup({ reveal: reveal({ choice: 1, correct: 0 }) });
    expect(option('Cây xanh')).toHaveAttribute('aria-pressed', 'false');
    expect(option('Cây khô')).toHaveAttribute('aria-pressed', 'true');
    expect(option('Cây giả')).toHaveAttribute('aria-pressed', 'false');
    for (const name of ['Cây xanh', 'Cây khô', 'Cây giả']) expect(option(name)).toBeDisabled();
  });

  it('đáp án đúng: "Chính xác! +N💧" dùng số đều, kèm "Bạn có biết", nút "Câu tiếp theo"', () => {
    setup({ reveal: reveal({ choice: 0, isCorrect: true, correct: 0, waterEarned: 1_500, explanation: 'Cây xanh quang hợp.' }) });
    const status = screen.getByRole('status');
    const line = screen.getByText('Chính xác! +1.500💧');
    expect(status).toContainElement(line);
    expect(numeric(line)).toBe('tabular-nums');
    expect(status).toHaveTextContent('Bạn có biết: Cây xanh quang hợp.');
    expect(screen.getByRole('button', { name: 'Câu tiếp theo' })).toBeInTheDocument();
  });

  it('đáp án sai: lời động viên, không có số thưởng, không có "Bạn có biết" khi thiếu lời giải', () => {
    setup({ reveal: reveal({ isCorrect: false }) });
    expect(screen.getByRole('status')).toHaveTextContent('Chưa đúng — cùng học nhé 🌿');
    expect(screen.queryByText(/Chính xác/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bạn có biết/)).not.toBeInTheDocument();
  });

  it('đáp án của câu khác thì bỏ qua: nút vẫn mở, không có vùng trạng thái', () => {
    setup({ reveal: reveal({ quizId: 'q2' }) });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(option('Cây xanh')).toBeEnabled();
    expect(option('Cây xanh')).toHaveAttribute('aria-pressed', 'false');
  });

  it('câu cuối đổi nhãn nút thành "Hoàn thành"; câu đơn lẻ cũng vậy', () => {
    const last = setup({ currentQuiz: Q3, answeredCount: 2, reveal: reveal({ quizId: 'q3' }) });
    expect(screen.getByRole('button', { name: 'Hoàn thành' })).toBeInTheDocument();
    last.update({ quiz: [Q1], currentQuiz: Q1, answeredCount: 0, reveal: reveal() });
    expect(screen.getByRole('button', { name: 'Hoàn thành' })).toBeInTheDocument();
  });

  it('nút "Câu tiếp theo" gọi onNext một lần dù chạm đúp cùng nhịp', async () => {
    const { onNext } = setup({ reveal: reveal() });
    await twice(screen.getByRole('button', { name: 'Câu tiếp theo' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('vẽ lại với cùng đáp án: "Câu tiếp theo" vẫn chỉ gọi onNext một lần', () => {
    const r = reveal();
    const { onNext, update } = setup({ reveal: r });
    fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp theo' }));
    update({ reveal: r });
    fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp theo' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('đáp án mới của cùng câu (lượt trả lời mới): "Câu tiếp theo" bấm được lần nữa', () => {
    const { onNext, update } = setup({ reveal: reveal() });
    fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp theo' }));
    update({ reveal: null });
    update({ reveal: reveal() });
    fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp theo' }));
    expect(onNext).toHaveBeenCalledTimes(2);
  });
});
