import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuestList as QuestData, StorefrontQuest } from '../../services/storefront-api';

const mocks = vi.hoisted(() => ({ openSnackbar: vi.fn(), claimQuest: vi.fn(), fetchQuests: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/storefront-api', () => ({ claimQuest: mocks.claimQuest }));
vi.mock('../../services/api', () => ({ getErrorMessage: (e: unknown) => (e as Error).message }));

import { QuestList } from './quest-panel';

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
