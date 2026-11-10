import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuestList as QuestData, StorefrontQuest } from '../../services/storefront-api';

const mocks = vi.hoisted(() => ({ openSnackbar: vi.fn(), claimQuest: vi.fn(), fetchQuests: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/storefront-api', () => ({ claimQuest: mocks.claimQuest }));
vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getErrorMessage: (e: unknown) => (e as Error).message,
}));

import { QuestList } from './quest-panel';
import { HttpError } from '../../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../../utils/settle-within';

const quest = (code: string, over: Partial<StorefrontQuest> = {}): StorefrontQuest => ({
  code, title: `Nhiệm vụ ${code}`, hint: `Gợi ý ${code}`, goal: 1, rewardPoints: 500, progress: 1, done: true, claimed: false, ...over,
});
const data: QuestData = { quests: [quest('A'), quest('B')], totalEarnedPoints: 0, level: 1, levelMax: 3 };

const claimButtons = () => screen.getAllByRole('button', { name: /Nhận/ });
const deferredClaim = () => {
  let finish!: (v: unknown) => void;
  let fail!: (e: unknown) => void;
  mocks.claimQuest.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  return { finish: (v: unknown) => finish(v), fail: (e: unknown) => fail(e) };
};
const OK = { claimed: true, code: 'A', rewardPoints: 500, pointsBalance: 500 };

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <QuestList data={data} />
    </QueryClientProvider>,
  );
}

describe('QuestList — khoá đồng bộ nhận thưởng nhiệm vụ (W82A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimQuest.mockReset();
  });

  it('hai cú chạm sát nhau vào cùng "Nhận" trước khi vẽ lại: chỉ nhận một lần', async () => {
    const claim = deferredClaim();
    renderList();
    const btn = claimButtons()[0]!;
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mocks.claimQuest).toHaveBeenCalledTimes(1);
    expect(mocks.claimQuest).toHaveBeenCalledWith('A');
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));

    await act(async () => claim.finish(OK));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: '+500 điểm 🎉', type: 'success' }));
    expect(mocks.claimQuest).toHaveBeenCalledTimes(1);
  });

  it('cú chạm thứ hai cách cú đầu một microtask vẫn chưa vẽ lại: vẫn một lần', async () => {
    deferredClaim();
    renderList();
    const btn = claimButtons()[0]!;
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      fireEvent.click(btn);
    });
    expect(mocks.claimQuest).toHaveBeenCalledTimes(1);
  });

  it('chạm hai nhiệm vụ khác nhau cùng một nhịp: chỉ nhiệm vụ đầu đi (một lần nhận mỗi lúc)', async () => {
    deferredClaim();
    renderList();
    const [first, second] = claimButtons();
    await act(async () => {
      fireEvent.click(first!);
      fireEvent.click(second!);
    });
    expect(mocks.claimQuest).toHaveBeenCalledTimes(1);
    expect(mocks.claimQuest).toHaveBeenCalledWith('A');
  });

  it('nhận lỗi thì nhả khoá và báo lỗi: bấm lại nhận được', async () => {
    const claim = deferredClaim();
    renderList();
    await act(async () => {
      fireEvent.click(claimButtons()[0]!);
      fireEvent.click(claimButtons()[0]!);
    });
    await act(async () => claim.fail(new Error('Mạng chập chờn')));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Mạng chập chờn', type: 'error' }));
    expect(mocks.claimQuest).toHaveBeenCalledTimes(1);

    mocks.claimQuest.mockResolvedValueOnce(OK);
    fireEvent.click(claimButtons()[1]!);
    await waitFor(() => expect(mocks.claimQuest).toHaveBeenCalledTimes(2));
    expect(mocks.claimQuest).toHaveBeenLastCalledWith('B');
  });

  it('nhận xong nhưng danh sách chưa tải lại: khoá giữ tới khi tải lại xong, bấm lại không nhận lần hai', async () => {
    let reload!: (v: QuestData) => void;
    mocks.fetchQuests.mockImplementationOnce(() => new Promise<QuestData>((resolve) => { reload = resolve; }));
    mocks.claimQuest.mockResolvedValueOnce(OK);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    function Live() {
      const q = useQuery({ queryKey: ['storefront-quests'], queryFn: () => mocks.fetchQuests(), initialData: data, staleTime: Infinity });
      return <QuestList data={q.data!} />;
    }
    render(
      <QueryClientProvider client={qc}>
        <Live />
      </QueryClientProvider>,
    );
    const btn = claimButtons()[0]!;
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(mocks.fetchQuests).toHaveBeenCalledTimes(1));
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(mocks.claimQuest).toHaveBeenCalledTimes(1);

    await act(async () => reload({ ...data, quests: [quest('A', { claimed: true }), quest('B')] }));
    await waitFor(() => expect(claimButtons()).toHaveLength(1));
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
  });
});

// W112A: máy chủ từ chối nhận thưởng (400/404/409) thì nút giữ khoá tới khi danh sách nhiệm vụ tải lại xong (tối đa LOCK_REFRESH_WAIT_MS). Mất mạng, quá hạn, 401, 5xx không nói gì về nhiệm vụ thật: không tải lại, nhả ngay.
describe('QuestList: máy chủ từ chối nhận thưởng thì tải lại rồi mới nhả khoá (W112A)', () => {
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message } } as never);
  const errorToasts = () => mocks.openSnackbar.mock.calls.filter(([a]) => (a as { type: string }).type === 'error');
  const pending = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const TEMPORARY: [string, unknown][] = [
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['quá thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
    ['lỗi không phải HTTP', new Error('boom')],
  ];

  function renderLive(reload?: () => Promise<void>) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidated: string[] = [];
    vi.spyOn(qc, 'invalidateQueries').mockImplementation(((filters: { queryKey: readonly string[] }) => {
      invalidated.push(filters.queryKey[0]!);
      return reload?.() ?? Promise.resolve();
    }) as never);
    render(
      <QueryClientProvider client={qc}>
        <QuestList data={data} />
      </QueryClientProvider>,
    );
    return invalidated;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimQuest.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([400, 404, 409])('bị từ chối %i: báo lỗi một lần, tải lại danh sách nhiệm vụ, nút bận (cả nút khác) tới khi dữ liệu về rồi mới nhận cú chạm mới', async (status) => {
    mocks.claimQuest.mockRejectedValueOnce(serverError('Nhiệm vụ đã nhận rồi.', status)).mockResolvedValue(OK);
    const reload = pending();
    const invalidated = renderLive(() => reload.promise);
    const [first, second] = claimButtons();
    await act(async () => {
      fireEvent.click(first!);
      fireEvent.click(first!);
    });
    await waitFor(() => expect(invalidated).toEqual(['storefront-quests']));
    expect(mocks.claimQuest).toHaveBeenCalledTimes(1);
    expect(errorToasts()).toEqual([[{ text: 'Nhiệm vụ đã nhận rồi.', type: 'error' }]]);
    expect(first).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      fireEvent.click(first!);
      fireEvent.click(second!);
    });
    expect(mocks.claimQuest).toHaveBeenCalledTimes(1);
    await act(async () => reload.resolve());
    await waitFor(() => expect(first).not.toHaveAttribute('aria-busy'));
    expect(errorToasts()).toHaveLength(1);
    fireEvent.click(first!);
    await waitFor(() => expect(mocks.claimQuest).toHaveBeenCalledTimes(2));
    expect(mocks.claimQuest).toHaveBeenLastCalledWith('A');
  });

  it.each(TEMPORARY)('%s: không nói gì về nhiệm vụ thật nên không tải lại, khoá nhả ngay', async (_label, error) => {
    mocks.claimQuest.mockRejectedValueOnce(error).mockResolvedValue(OK);
    const invalidated = renderLive();
    const btn = claimButtons()[0]!;
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(errorToasts()).toHaveLength(1));
    await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
    // Lần nhận thành công đã tải lại danh sách ở onSuccess: chỉ đếm sau lỗi, trước lần bấm lại.
    expect(invalidated).toEqual([]);
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.claimQuest).toHaveBeenCalledTimes(2));
  });

  it('bị từ chối mà danh sách tải lại treo mãi: nút còn bận ở 3,5 giây, nhả đúng sau LOCK_REFRESH_WAIT_MS', async () => {
    mocks.claimQuest.mockRejectedValueOnce(serverError('Nhiệm vụ đã nhận rồi.', 409)).mockResolvedValue(OK);
    renderLive(() => new Promise<void>(() => undefined));
    const btn = claimButtons()[0]!;
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(btn);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_500);
      fireEvent.click(btn);
    });
    expect(mocks.claimQuest).toHaveBeenCalledTimes(1);
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 3_500 + 100);
      for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
    });
    expect(btn).not.toHaveAttribute('aria-busy');
    await act(async () => {
      fireEvent.click(btn);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.claimQuest).toHaveBeenCalledTimes(2);
  });
});
