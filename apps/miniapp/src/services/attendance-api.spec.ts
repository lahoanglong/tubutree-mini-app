import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  requestZaloLocationStrict: vi.fn(),
  getZaloAccessToken: vi.fn(),
}));

vi.mock('./zmp-bridge', () => ({
  requestZaloLocationStrict: mocks.requestZaloLocationStrict,
  getZaloAccessToken: mocks.getZaloAccessToken,
}));
vi.mock('./api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { api } from './api';
import { acquireLocationPayload, checkin, heartbeat } from './attendance-api';

type GeoCb = (e: { code: number; message?: string }) => void;

function stubGeolocation(impl: ((ok: (p: unknown) => void, err: GeoCb) => void) | null) {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: impl ? { getCurrentPosition: impl } : undefined,
  });
}

describe('acquireLocationPayload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requestZaloLocationStrict.mockRejectedValue(new Error('zalo fail'));
  });
  afterEach(() => stubGeolocation(null));

  it('Zalo thành công: trả token, không báo lỗi', async () => {
    mocks.requestZaloLocationStrict.mockResolvedValue({ token: 't1' });
    mocks.getZaloAccessToken.mockResolvedValue({ accessToken: 'a1' });
    const onFailure = vi.fn();
    await expect(acquireLocationPayload(onFailure)).resolves.toEqual({ locationToken: 't1', zaloAccessToken: 'a1' });
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('Zalo lỗi, geolocation thành công: trả toạ độ, không báo lỗi', async () => {
    stubGeolocation((ok) => ok({ coords: { latitude: 10.5, longitude: 106.5 } }));
    const onFailure = vi.fn();
    await expect(acquireLocationPayload(onFailure)).resolves.toEqual({ lat: 10.5, lng: 106.5 });
    expect(onFailure).not.toHaveBeenCalled();
  });

  it.each([
    [1, /chưa cấp quyền/],
    [2, /chưa xác định được vị trí/],
    [3, /hết thời gian chờ/],
  ])('cả hai lỗi, GeolocationPositionError.code=%i: trả {} và báo đúng một lần', async (code, re) => {
    stubGeolocation((_ok, err) => err({ code }));
    const onFailure = vi.fn();
    await expect(acquireLocationPayload(onFailure)).resolves.toEqual({});
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]![0]).toMatch(/^Không lấy được vị trí/);
    expect(onFailure.mock.calls[0]![0]).toMatch(re);
  });

  it('không có navigator.geolocation: Zalo từ chối quyền thì báo chưa cấp quyền', async () => {
    mocks.requestZaloLocationStrict.mockRejectedValue({ code: -1401, message: 'User denied permission' });
    stubGeolocation(null);
    const onFailure = vi.fn();
    await expect(acquireLocationPayload(onFailure)).resolves.toEqual({});
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]![0]).toMatch(/chưa cấp quyền/);
  });

  it('không có navigator.geolocation và Zalo lỗi khác: báo chưa xác định được vị trí', async () => {
    stubGeolocation(null);
    const onFailure = vi.fn();
    await expect(acquireLocationPayload(onFailure)).resolves.toEqual({});
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]![0]).toMatch(/chưa xác định được vị trí/);
  });

  it('không truyền callback vẫn trả {} và không ném', async () => {
    stubGeolocation((_ok, err) => err({ code: 1 }));
    await expect(acquireLocationPayload()).resolves.toEqual({});
  });
});

describe('máy chủ từ chối toạ độ thô', () => {
  const REFUSED = 'Mở Tubu Tree trong Zalo và cho phép quyền vị trí để chấm công.';
  const refusal = { response: { status: 400, data: { message: REFUSED } } };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requestZaloLocationStrict.mockRejectedValue(new Error('zalo fail'));
  });
  afterEach(() => stubGeolocation(null));

  it('sau lần bị từ chối: không hỏi GPS thô nữa, báo đúng lời máy chủ; Zalo có token trở lại thì hết chặn', async () => {
    stubGeolocation((ok) => ok({ coords: { latitude: 10.5, longitude: 106.5 } }));
    const loc = await acquireLocationPayload();
    expect(loc).toEqual({ lat: 10.5, lng: 106.5 });
    vi.mocked(api.post).mockRejectedValueOnce(refusal);
    await expect(heartbeat(loc)).rejects.toBe(refusal);

    const getCurrentPosition = vi.fn();
    Object.defineProperty(globalThis.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
    const onFailure = vi.fn();
    await expect(acquireLocationPayload(onFailure)).resolves.toEqual({});
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(REFUSED);

    mocks.requestZaloLocationStrict.mockResolvedValue({ token: 't1' });
    mocks.getZaloAccessToken.mockResolvedValue({ accessToken: 'a1' });
    await expect(acquireLocationPayload()).resolves.toEqual({ locationToken: 't1', zaloAccessToken: 'a1' });
    mocks.requestZaloLocationStrict.mockRejectedValue(new Error('zalo fail'));
    stubGeolocation((ok) => ok({ coords: { latitude: 1, longitude: 2 } }));
    await expect(acquireLocationPayload()).resolves.toEqual({ lat: 1, lng: 2 });
  });

  it('checkin bị từ chối toạ độ thô cũng ghi nhớ; lỗi 400 khác không ghi nhớ', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 400, data: { message: 'Không tìm thấy ca đã duyệt.' } } });
    await expect(checkin({ shiftId: 's', lat: 1, lng: 2 })).rejects.toBeTruthy();
    stubGeolocation((ok) => ok({ coords: { latitude: 3, longitude: 4 } }));
    await expect(acquireLocationPayload()).resolves.toEqual({ lat: 3, lng: 4 });

    vi.mocked(api.post).mockRejectedValueOnce(refusal);
    await expect(checkin({ shiftId: 's', lat: 3, lng: 4 })).rejects.toBe(refusal);
    await expect(acquireLocationPayload()).resolves.toEqual({});
    mocks.requestZaloLocationStrict.mockResolvedValue({ token: 't' });
    mocks.getZaloAccessToken.mockResolvedValue({ accessToken: 'a' });
    await acquireLocationPayload();
  });
});
