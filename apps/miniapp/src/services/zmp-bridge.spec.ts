import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock nguyên `zmp-sdk/apis` — zmp-bridge.ts là lớp bọc DUY NHẤT được phép gọi thẳng SDK,
// nên test ở đây kiểm chứng đúng hành vi bọc (không crash / không throw ngoài Zalo), không
// gọi SDK thật (không có trong môi trường test — cũng không có cầu nối native).
vi.mock('zmp-sdk/apis', () => ({
  getAccessToken: vi.fn(),
  getPhoneNumber: vi.fn(),
  getUserInfo: vi.fn(),
  getLocation: vi.fn(),
  login: vi.fn(),
  openShareSheet: vi.fn(),
  openWebview: vi.fn(),
  openChat: vi.fn(),
  followOA: vi.fn(),
  requestSendNotification: vi.fn(),
  getStorage: vi.fn(),
  setStorage: vi.fn(),
}));

import {
  followOA as zmpFollowOA,
  requestSendNotification as zmpRequestSendNotification,
  getStorage,
  setStorage,
} from 'zmp-sdk/apis';
import {
  followOA,
  requestNotifyPermission,
  getOaPromptState,
  setOaPromptState,
  shouldShowFollowOaPrompt,
  hasOA,
} from './zmp-bridge';

const mockedZmpFollowOA = vi.mocked(zmpFollowOA);
const mockedZmpRequestSendNotification = vi.mocked(zmpRequestSendNotification);
const mockedGetStorage = vi.mocked(getStorage);
const mockedSetStorage = vi.mocked(setStorage);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetStorage.mockResolvedValue({});
  mockedSetStorage.mockResolvedValue({ errorKeys: [] });
});

// Finding A3-01 nửa 2: miniapp chưa từng gọi followOA/requestSendNotification dù SDK có sẵn.
// VITE_ZALO_OA_ID không được set trong .env của repo (chưa có OA thật cấu hình) → hasOA=false
// trong mọi môi trường build hiện tại (dev/test/CI) — đúng thực trạng half 2 của finding.
describe('hasOA — chưa cấu hình VITE_ZALO_OA_ID trong repo hiện tại', () => {
  it('hasOA === false (chưa có OA_ID nào được set)', () => {
    expect(hasOA).toBe(false);
  });
});

describe('followOA — bọc zmp-sdk followOA, không bao giờ throw/crash ngoài Zalo', () => {
  it('OA chưa cấu hình (không truyền id, OA_ID rỗng) → false, KHÔNG gọi SDK', async () => {
    await expect(followOA()).resolves.toBe(false);
    expect(mockedZmpFollowOA).not.toHaveBeenCalled();
  });

  it('OA chưa cấu hình + truyền id rỗng tường minh → false, KHÔNG gọi SDK', async () => {
    await expect(followOA('')).resolves.toBe(false);
    expect(mockedZmpFollowOA).not.toHaveBeenCalled();
  });

  it('có id + SDK thành công → true', async () => {
    mockedZmpFollowOA.mockResolvedValue(undefined);
    await expect(followOA('oa-123')).resolves.toBe(true);
    expect(mockedZmpFollowOA).toHaveBeenCalledWith({ id: 'oa-123' });
  });

  it('có id + SDK lỗi (ngoài Zalo / user từ chối / -201) → false, KHÔNG throw', async () => {
    mockedZmpFollowOA.mockRejectedValue(Object.assign(new Error('rejected'), { code: -201 }));
    await expect(followOA('oa-123')).resolves.toBe(false);
  });

  it('có id + SDK treo không resolve cũng không reject ngay (giả lập ngoài Zalo) → vẫn không throw đồng bộ', async () => {
    // Không cần chờ hết — chỉ đảm bảo gọi hàm không ném lỗi đồng bộ trước khi Promise settle.
    mockedZmpFollowOA.mockRejectedValue(new Error('no bridge'));
    await expect(followOA('oa-123')).resolves.toBe(false);
  });
});

describe('requestNotifyPermission — bọc zmp-sdk requestSendNotification', () => {
  it('SDK thành công → true', async () => {
    mockedZmpRequestSendNotification.mockResolvedValue(undefined);
    await expect(requestNotifyPermission()).resolves.toBe(true);
    expect(mockedZmpRequestSendNotification).toHaveBeenCalledTimes(1);
  });

  it('SDK lỗi (ngoài Zalo / từ chối) → false, KHÔNG throw', async () => {
    mockedZmpRequestSendNotification.mockRejectedValue(new Error('not in zalo'));
    await expect(requestNotifyPermission()).resolves.toBe(false);
  });
});

describe('getOaPromptState / setOaPromptState — cờ "đã hỏi theo dõi OA" lưu trên máy', () => {
  it('chưa có gì trong storage → mặc định promptSeen=false, followed=false', async () => {
    mockedGetStorage.mockResolvedValue({});
    await expect(getOaPromptState()).resolves.toEqual({ promptSeen: false, followed: false });
  });

  it('storage lỗi (ngoài Zalo) → vẫn trả về mặc định, KHÔNG throw', async () => {
    mockedGetStorage.mockRejectedValue(new Error('no storage bridge'));
    await expect(getOaPromptState()).resolves.toEqual({ promptSeen: false, followed: false });
  });

  it('đọc lại đúng giá trị đã set trước đó', async () => {
    mockedGetStorage.mockResolvedValue({ tubu_oa_prompt: JSON.stringify({ promptSeen: true, followed: true }) });
    await expect(getOaPromptState()).resolves.toEqual({ promptSeen: true, followed: true });
  });

  it('setOaPromptState merge với trạng thái cũ rồi ghi lại (không mất followed khi chỉ set promptSeen)', async () => {
    mockedGetStorage.mockResolvedValue({ tubu_oa_prompt: JSON.stringify({ promptSeen: false, followed: true }) });
    await setOaPromptState({ promptSeen: true });
    expect(mockedSetStorage).toHaveBeenCalledWith({
      data: { tubu_oa_prompt: JSON.stringify({ promptSeen: true, followed: true }) },
    });
  });

  it('setStorage lỗi → không throw (không chặn luồng UI)', async () => {
    mockedSetStorage.mockRejectedValue(new Error('no storage bridge'));
    await expect(setOaPromptState({ promptSeen: true })).resolves.toBeUndefined();
  });
});

// Tách hàm thuần để test điều kiện hiện thẻ mời KHÔNG cần dựng cả order-detail.tsx (mirror
// cách notifications.spec.ts test notificationMeta/notificationOrderLink thay vì render trang).
describe('shouldShowFollowOaPrompt — điều kiện hiện thẻ mời theo dõi OA sau đơn đầu', () => {
  it('OA chưa cấu hình → không hiện dù các điều kiện khác đều đạt', () => {
    expect(shouldShowFollowOaPrompt({ hasOA: false, promptSeen: false, ordersTotal: 1 })).toBe(false);
  });

  it('đã hỏi rồi (promptSeen=true) → không hiện lại, kể cả khi vẫn là đơn đầu', () => {
    expect(shouldShowFollowOaPrompt({ hasOA: true, promptSeen: true, ordersTotal: 1 })).toBe(false);
  });

  it('khách đã có đơn thứ 2 trở lên (ordersTotal >= 2) → không hiện', () => {
    expect(shouldShowFollowOaPrompt({ hasOA: true, promptSeen: false, ordersTotal: 2 })).toBe(false);
    expect(shouldShowFollowOaPrompt({ hasOA: true, promptSeen: false, ordersTotal: 5 })).toBe(false);
  });

  it('chưa tải xong tổng số đơn (ordersTotal=undefined) → chưa hiện, tránh nháy sai', () => {
    expect(shouldShowFollowOaPrompt({ hasOA: true, promptSeen: false, ordersTotal: undefined })).toBe(false);
  });

  it('đúng đơn đầu tiên (ordersTotal=1) + đã cấu hình OA + chưa từng hỏi → hiện', () => {
    expect(shouldShowFollowOaPrompt({ hasOA: true, promptSeen: false, ordersTotal: 1 })).toBe(true);
  });
});
