// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@/test-utils/render-hook';
import { ApiError, NetworkError } from '@/lib/client-api';

const api = vi.hoisted(() => ({ collectDew: vi.fn() }));
vi.mock('@tubutree/app-core/api/game', async (orig) => ({ ...(await orig<typeof import('@tubutree/app-core/api/game')>()), collectDew: api.collectDew }));

import { useGameActions } from './use-game-actions';

function setup() {
  const notify = vi.fn();
  const hook = renderHook(() => useGameActions({ notify, onHarvest: vi.fn(), onAnswered: vi.fn() }));
  const invalidate = vi.spyOn(hook.client, 'invalidateQueries');
  return { notify, invalidate, hook };
}

describe('useGameActions: lỗi khi bấm nút', () => {
  it('hết thời gian chờ: báo chưa rõ kết quả và làm mới Vườn Xanh vì máy chủ có thể đã ghi nhận', async () => {
    api.collectDew.mockRejectedValue(new NetworkError(true));
    const { notify, invalidate, hook } = setup();
    await act(async () => hook.result.current.dewM.mutate());
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Mạng chậm, chưa rõ đã xong chưa. Bạn kiểm tra lại rồi thử lại nhé.', 'error'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['game'] });
  });

  it('máy chủ từ chối (4xx): chỉ báo lời máy chủ, không làm mới', async () => {
    api.collectDew.mockRejectedValue(new ApiError('Bạn đã hứng sương hôm nay rồi.', 400));
    const { notify, invalidate, hook } = setup();
    await act(async () => hook.result.current.dewM.mutate());
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Bạn đã hứng sương hôm nay rồi.', 'error'));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
