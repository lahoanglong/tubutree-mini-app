import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../services/http';
import { gameMoreCopy } from '@tubutree/app-core/game-more-copy';

const mocks = vi.hoisted(() => ({ answerQuiz: vi.fn(), openSnackbar: vi.fn() }));
vi.mock('zmp-ui', () => ({ useSnackbar: () => ({ openSnackbar: mocks.openSnackbar }) }));
vi.mock('../../services/game-api', async (orig) => ({ ...(await orig<typeof import('../../services/game-api')>()), answerQuiz: mocks.answerQuiz }));

import { useGameActions } from './use-game-actions';

const serverError = (message: string) => new HttpError(message, undefined, { status: 400, data: { message } } as never);

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useGameActions({ onHarvest: vi.fn(), onAnswered: vi.fn() }), { wrapper });
  return { invalidate, hook };
}

describe('useGameActions: trả lời câu đố', () => {
  it('máy chủ nói câu không thuộc bộ hôm nay: tải lại bộ câu và báo ngắn, không đọc lời máy chủ', async () => {
    mocks.answerQuiz.mockRejectedValue(serverError('Câu hỏi này không thuộc bộ câu hôm nay.'));
    const { invalidate, hook } = setup();
    await act(async () => hook.result.current.answerM.mutate({ id: 'q1', choice: 0 }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: gameMoreCopy.quiz.staleSet, type: 'warning' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['game', 'quiz'] });
  });

  it('lỗi khác: báo lời máy chủ, không tải lại bộ câu', async () => {
    mocks.openSnackbar.mockClear();
    mocks.answerQuiz.mockRejectedValue(serverError('Bạn đã trả lời câu này rồi.'));
    const { invalidate, hook } = setup();
    await act(async () => hook.result.current.answerM.mutate({ id: 'q1', choice: 0 }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    expect(mocks.openSnackbar.mock.calls[0]?.[0].text).not.toBe(gameMoreCopy.quiz.staleSet);
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['game', 'quiz'] });
  });
});
