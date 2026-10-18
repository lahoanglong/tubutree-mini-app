import { describe, expect, it } from 'vitest';
import type { PlatformBridge } from '@tubutree/app-core/bridge';
import { getOaPromptState, setOaPromptState, shouldShowFollowOaPrompt } from './oa-prompt';

function memoryStorage(initial: Record<string, string> = {}): PlatformBridge['storage'] & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    async get(k) {
      return data[k] ?? null;
    },
    async set(k, v) {
      data[k] = v;
    },
  };
}

describe('shouldShowFollowOaPrompt — chỉ mời ngay sau đơn đầu tiên', () => {
  it('cần đủ ba điều kiện: có OA, chưa hỏi, đây là đơn duy nhất', () => {
    expect(shouldShowFollowOaPrompt({ hasOA: true, promptSeen: false, ordersTotal: 1 })).toBe(true);
    expect(shouldShowFollowOaPrompt({ hasOA: false, promptSeen: false, ordersTotal: 1 })).toBe(false);
    expect(shouldShowFollowOaPrompt({ hasOA: true, promptSeen: true, ordersTotal: 1 })).toBe(false);
    expect(shouldShowFollowOaPrompt({ hasOA: true, promptSeen: false, ordersTotal: 2 })).toBe(false);
    expect(shouldShowFollowOaPrompt({ hasOA: true, promptSeen: false, ordersTotal: undefined })).toBe(false);
  });
});

describe('cờ đã hỏi theo dõi OA lưu qua storage của bridge', () => {
  it('chưa lưu hoặc dữ liệu hỏng thì coi như chưa hỏi', async () => {
    expect(await getOaPromptState(memoryStorage())).toEqual({ promptSeen: false, followed: false });
    expect(await getOaPromptState(memoryStorage({ tubu_oa_prompt: '{hỏng' }))).toEqual({ promptSeen: false, followed: false });
  });

  it('ghi gộp với giá trị cũ, cùng khoá tubu_oa_prompt như Mini App', async () => {
    const st = memoryStorage();
    await setOaPromptState(st, { followed: true });
    await setOaPromptState(st, { promptSeen: true });
    expect(JSON.parse(st.data.tubu_oa_prompt!)).toEqual({ promptSeen: true, followed: true });
    expect(await getOaPromptState(st)).toEqual({ promptSeen: true, followed: true });
  });

  it('storage ném lỗi thì không chặn luồng', async () => {
    const broken: PlatformBridge['storage'] = {
      async get() {
        throw new Error('x');
      },
      async set() {
        throw new Error('x');
      },
    };
    expect(await getOaPromptState(broken)).toEqual({ promptSeen: false, followed: false });
    await expect(setOaPromptState(broken, { promptSeen: true })).resolves.toBeUndefined();
  });
});
