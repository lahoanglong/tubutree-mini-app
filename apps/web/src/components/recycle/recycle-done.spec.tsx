// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WasteRequestDetailDTO, WasteRequestLineDTO } from '@tubutree/shared-types';
import { byText, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, unnamedControls } from '@/test-utils/a11y';
import { makeRewardCatalog } from '@/components/loyalty/reward-fixtures';
import { makeRequestDetail, makeWasteMe } from './recycle-fixtures';

// Chép ý recycle-done.spec.tsx (Mini App, §4.7): điểm vừa cộng, bảng đếm, số dư mới, tiến độ tới quà, giọt nước, tác động.

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  replace: vi.fn(),
  request: null as unknown,
  requestError: null as unknown,
  me: null as unknown,
  rewards: null as unknown,
  calls: [] as string[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: state.replace }),
  usePathname: () => '/doi-rac/xong/req-1',
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push(path);
      if (path === '/waste/requests/req-1') {
        if (state.requestError) throw state.requestError;
        return state.request;
      }
      if (path === '/waste/me') return state.me;
      if (path === '/me/loyalty/rewards') return state.rewards;
      throw new Error(`chưa mock ${path}`);
    },
    post: async () => {
      throw new Error('trang này không ghi dữ liệu');
    },
  },
}));

import { RecycleDone } from './recycle-done';

const LINE = makeRequestDetail().lines[0] as WasteRequestLineDTO;
const DONE = (over: Partial<WasteRequestDetailDTO> = {}) =>
  makeRequestDetail({
    status: 'COMPLETED',
    editable: false,
    cancellable: false,
    pointsAwarded: 4000,
    dropsAwarded: null,
    completedAt: '2026-10-18T03:00:00.000Z',
    lines: [{ ...LINE, receivedQty: 4, shortfallReason: 'DIRTY', pointsAwarded: 4000 }],
    ...over,
  });

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<RecycleDone id="req-1" />);
  mounted.push(r);
  await flush(10);
  return r.container;
};

beforeEach(() => {
  state.phase = 'authenticated';
  state.replace = vi.fn();
  state.request = DONE();
  state.requestError = null;
  state.me = makeWasteMe({ balance: { pointsBalance: 9000, pointsConvertedBalance: 5000, redeemablePoints: 14_000 } });
  state.rewards = makeRewardCatalog({ redeemablePoints: 14_000 });
  state.calls = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/doi-rac/xong/[id] (§4.7)', () => {
  it.each(['OPEN', 'IN_TRANSIT', 'RECEIVED', 'REJECTED', 'REVERSED'] as const)('%s: chuyển về trang theo dõi yêu cầu', async (status) => {
    state.request = makeRequestDetail({ status });
    const c = await mount();
    expect(state.replace).toHaveBeenCalledWith('/doi-rac/yeu-cau/req-1');
    expect(c.textContent).not.toContain('Đã cộng');
  });

  it('số điểm vừa cộng, bảng kho đếm so với bạn khai kèm lý do', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Đã cộng 4.000 điểm');
    const row = byText(c.querySelector('table[aria-label="Đã khai và đã đếm"]')!, 'tr', 'Thùng carton')!;
    expect(row.textContent).toContain('5 thùng');
    expect(row.textContent).toContain('4 thùng');
    expect(row.textContent).toContain('Bẩn');
  });

  it('số dư mới (tổng hai lô) và tiến độ tới quà từ redeemablePoints', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Số dư mới 14.000 điểm');
    expect(c.textContent).toContain('Còn 6.000 điểm tới mã Miễn phí vận chuyển');
  });

  it('giọt nước: chỉ khi dropsAwarded > 0, dùng biểu tượng không dùng emoji', async () => {
    state.request = DONE({ dropsAwarded: 3 });
    const c = await mount();
    expect(c.textContent).toContain('+3 giọt nước vào bình của bạn');
    expect(c.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it.each([null, 0])('dropsAwarded %j: không có dòng giọt nước', async (drops) => {
    state.request = DONE({ dropsAwarded: drops });
    const c = await mount();
    expect(c.textContent).toContain('Đã cộng 4.000 điểm');
    expect(c.textContent).not.toContain('giọt nước');
  });

  it('thẻ tác động chỉ khi impactGrams khác null, chỉ nói khối lượng', async () => {
    state.request = DONE({ impactGrams: 1940 });
    const c = await mount();
    expect(c.textContent).toContain('Bạn đã gửi khoảng 1,9 kg bao bì cho Tubu');
    expect(c.textContent).toContain('Ước tính theo khối lượng trung bình');
    expect(c.textContent).not.toMatch(/CO2|cây/);
  });

  it('tác động dưới 50 g: không có thẻ; 100 g: "0,1 kg"', async () => {
    state.request = DONE({ impactGrams: 30 });
    const c = await mount();
    expect(c.textContent).not.toContain('kg bao bì');
    expect(c.textContent).not.toContain('Ước tính theo khối lượng trung bình');
    mounted.pop()!.unmount();
    state.request = DONE({ impactGrams: 100 });
    expect((await mount()).textContent).toContain('Bạn đã gửi khoảng 0,1 kg bao bì cho Tubu');
  });

  it('impactGrams null: không có thẻ tác động', async () => {
    const c = await mount();
    expect(c.textContent).not.toContain('kg bao bì');
  });

  it('0 điểm: nói thật là chưa đủ để cộng, không hiện "Đã cộng"', async () => {
    state.request = DONE({
      pointsAwarded: 0,
      lines: [{ ...LINE, itemId: 'item-milk', itemName: 'Vỏ hộp sữa', unitLabel: 'vỏ', unitsPerPoint: 5, declaredQty: 5, receivedQty: 3, shortfallReason: 'DIRTY', pointsAwarded: 0 }],
    });
    const c = await mount();
    expect(c.textContent).toContain('Lượt này chưa đủ để cộng điểm');
    expect(c.textContent).toContain('Vỏ hộp sữa cần 5 vỏ mới được 1.000 điểm, kho đếm được 3 vỏ');
    expect(c.textContent).not.toContain('Đã cộng');
  });

  it('chưa có số dư hay quà kế tiếp (tải lỗi): vẫn hiện kết quả cộng điểm, không có dòng số dư', async () => {
    state.me = null;
    state.rewards = null;
    const c = await mount();
    expect(c.textContent).toContain('Đã cộng 4.000 điểm');
    expect(c.textContent).not.toContain('Số dư mới');
  });

  it('"Đổi quà ngay" tới /kho-qua, "Đổi thêm rác" tới /doi-rac/tao', async () => {
    const c = await mount();
    expect(byText(c, 'a', 'Đổi quà ngay')?.getAttribute('href')).toBe('/kho-qua');
    expect(byText(c, 'a', 'Đổi thêm rác')?.getAttribute('href')).toBe('/doi-rac/tao');
  });

  it('404 hoặc lỗi tải: câu lỗi + "Thử lại"', async () => {
    state.requestError = new Error('Máy chủ bận');
    const c = await mount();
    expect(c.textContent).toContain('Máy chủ bận');
    expect(byText(c, 'button', 'Thử lại')).not.toBeNull();
  });

  it('khách chưa đăng nhập: mời đăng nhập quay lại đúng trang, không gọi API', async () => {
    state.phase = 'guest';
    const c = await mount();
    expect(c.querySelector('a[href^="/dang-nhap"]')?.getAttribute('href')).toBe(`/dang-nhap?returnTo=${encodeURIComponent('/doi-rac/xong/req-1')}`);
    expect(state.calls).toEqual([]);
  });

  it('phiên không khôi phục được: không gọi API', async () => {
    state.phase = 'unavailable';
    await mount();
    expect(state.calls).toEqual([]);
  });

  it('một h1, thứ tự heading đúng, điều khiển có tên', async () => {
    const c = await mount();
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });
});

describe('/doi-rac/xong/[id] — diện mạo Mini App ở điện thoại', () => {
  it('Đổi thêm rác là nút secondary xanh nhạt không viền', async () => {
    const c = await mount();
    expect(byText(c, 'a', 'Đổi thêm rác')!.className).toContain('max-md:bg-[var(--color-action-secondary-bg)]');
  });
});
