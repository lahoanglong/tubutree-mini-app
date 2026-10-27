// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { makeRewardCatalog } from '@/components/loyalty/reward-fixtures';
import { ITEM_CARTON, ITEM_MILK, makeRequestSummary, makeWasteMe } from './recycle-fixtures';

// Chép ý recycle.spec.tsx (Mini App, §4.1): thẻ số dư, tiến độ quà, tác động, cách đổi, món nhận, yêu cầu đang xử lý, các thẻ
// trạng thái và thứ tự ưu tiên. Khác Mini App: khách chưa đủ điều kiện (eligibility khác OK, thường thiếu SĐT) thấy
// MiniAppOnlyNotice thay vì hộp chia sẻ SĐT (Q2); điều hướng là link; không có đường lách qua web.

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  me: null as unknown,
  rewards: null as unknown,
  catalogue: [] as unknown[],
  calls: [] as string[],
  fail: new Set<string>(),
  config: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: false } } as Record<string, unknown>,
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => state.config }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push(path);
      if (state.fail.has(path)) {
        state.fail.delete(path);
        throw new Error('mất mạng');
      }
      if (path === '/waste/me') return state.me;
      if (path === '/me/loyalty/rewards') return state.rewards;
      if (path === '/waste/catalogue') return state.catalogue;
      throw new Error(`chưa mock ${path}`);
    },
    post: async () => {
      throw new Error('trang này không ghi dữ liệu');
    },
  },
}));

import { RecycleHome } from './recycle-home';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<RecycleHome />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const link = (c: HTMLElement, href: string) => c.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);

beforeEach(() => {
  state.phase = 'authenticated';
  state.calls = [];
  state.catalogue = [];
  state.fail = new Set();
  state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: false } };
  state.me = makeWasteMe({ balance: { pointsBalance: 9000, pointsConvertedBalance: 5000, redeemablePoints: 14_000 } });
  state.rewards = makeRewardCatalog({ redeemablePoints: 14_000 });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('/doi-rac trang vào (§4.1)', () => {
  it('thẻ đầu trang: nhãn "Điểm Xanh của bạn", tổng hai lô, quy ra tiền, link "Đổi rác ngay"', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Điểm Xanh của bạn');
    expect(c.textContent).toContain('14.000 điểm');
    expect(c.textContent).toContain('Dùng như 14.000đ khi mua sắm');
    expect(c.textContent).not.toContain('từ đổi rác');
    expect(link(c, '/doi-rac/tao')?.textContent).toContain('Đổi rác ngay');
  });

  it('tiến độ tới quà kế tiếp theo redeemablePoints của máy chủ + tương đương đơn vị món', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Còn 6.000 điểm tới mã Miễn phí vận chuyển');
    expect(c.textContent).toContain('tương đương khoảng 6 thùng carton');
    expect(c.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('14000');
  });

  it('dòng tác động chỉ khi impactGrams làm tròn ra ít nhất 0,1 kg', async () => {
    state.me = makeWasteMe({ impactGrams: 1940 });
    let c = await mount();
    expect(c.textContent).toContain('Bạn đã gửi khoảng 1,9 kg bao bì cho Tubu');
    expect(c.textContent).toContain('Ước tính theo khối lượng trung bình');
    mounted.pop()!.unmount();
    for (const grams of [49, 0, null]) {
      state.me = makeWasteMe({ impactGrams: grams });
      c = await mount();
      expect(c.textContent).toContain('Điểm Xanh của bạn');
      expect(c.textContent).not.toContain('kg bao bì');
      mounted.pop()!.unmount();
    }
    state.me = makeWasteMe({ impactGrams: 50 });
    c = await mount();
    expect(c.textContent).toContain('Bạn đã gửi khoảng 0,1 kg bao bì cho Tubu');
  });

  it('ba cách đổi: chỉ cách đang bật ở cấu hình công khai; khoá đường kho ẩn Gửi về kho và Thu kèm đơn', async () => {
    state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } };
    state.me = makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: true }, shipLockedAt: '2026-10-01T00:00:00.000Z' });
    const c = await mount();
    expect(c.textContent).toContain('Mang tới điểm nhận');
    expect(c.textContent).not.toContain('Gửi về kho Tubu HCM');
    expect(c.textContent).not.toContain('Thu kèm đơn mua');
  });

  it('cờ pickup tắt → không có thẻ Thu kèm đơn; tiêu đề khối không đếm số thẻ', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Gửi về kho Tubu HCM');
    expect(c.textContent).not.toContain('Thu kèm đơn mua');
    expect(byText(c, 'h2', 'Cách đổi')).not.toBeNull();
    expect(c.textContent).not.toContain('Ba cách đổi');
  });

  it('không cách giao nào mở với khách này → ẩn "Đổi rác ngay" nhưng vẫn hiện số dư', async () => {
    state.config = { isLoaded: true, waste: { enabled: true, dropoff: false, mailin: false, pickup: false } };
    const c = await mount();
    expect(c.textContent).toContain('Điểm Xanh của bạn');
    expect(link(c, '/doi-rac/tao')).toBeNull();
  });

  it('danh sách món: quy tắc + chuẩn bị; món sắp nhận mờ, nhãn "Sắp nhận"', async () => {
    const c = await mount();
    expect(c.textContent).toContain('1 thùng = 1.000 điểm');
    expect(c.textContent).toContain('5 vỏ = 1.000 điểm');
    expect(c.textContent).toContain('Gấp phẳng, bỏ băng keo');
    const battery = Array.from(c.querySelectorAll<HTMLElement>('[data-item]')).find((e) => e.textContent?.includes('Pin đã dùng'))!;
    expect(battery.getAttribute('data-status')).toBe('COMING_SOON');
    expect(battery.textContent).toContain('Sắp nhận');
    expect(battery.className).not.toContain('opacity-');
    expect(battery.getAttribute('aria-disabled')).toBe('true');
  });

  it('yêu cầu đang xử lý: mã, cách giao, mini timeline; link tới /doi-rac/yeu-cau/:id; biểu tượng lịch sử tới /doi-rac/yeu-cau', async () => {
    state.me = makeWasteMe({ openRequests: [makeRequestSummary({ method: 'MAIL_IN', status: 'IN_TRANSIT', pointName: 'Kho Tubu TP.HCM' })] });
    const c = await mount();
    expect(link(c, '/doi-rac/yeu-cau/req-1')?.textContent).toContain('TR-8K2M9');
    expect(c.querySelector('ol[aria-label="Tiến độ TR-8K2M9"]')).not.toBeNull();
    expect(link(c, '/doi-rac/yeu-cau')?.getAttribute('aria-label')).toBe('Yêu cầu của tôi');
  });

  it('thẻ yêu cầu có một dòng trạng thái theo cách giao, kèm mini timeline', async () => {
    state.me = makeWasteMe({ openRequests: [makeRequestSummary({ method: 'MAIL_IN', status: 'IN_TRANSIT' })] });
    const c = await mount();
    expect(c.textContent).toContain('Đang vận chuyển');
    expect(c.querySelector('ol[aria-label="Tiến độ TR-8K2M9"]')).not.toBeNull();
  });

  it('thẻ yêu cầu liệt kê từng món dạng "Tên món: số lượng đơn vị", không lặp danh từ đơn vị', async () => {
    state.me = makeWasteMe({
      openRequests: [
        makeRequestSummary({
          lines: [
            { itemName: 'Thùng carton cũ', unitLabel: 'thùng', declaredQty: 3 },
            { itemName: 'Vỏ hộp sữa sạch', unitLabel: 'vỏ', declaredQty: 5 },
          ],
        }),
      ],
    });
    const c = await mount();
    expect(c.textContent).toContain('Thùng carton cũ: 3 thùng, Vỏ hộp sữa sạch: 5 vỏ');
  });

  it('hàng quà dẫn tới /kho-qua, thể lệ tới /doi-rac/quy-dinh; lối vào quầy chỉ khi có deskPoints', async () => {
    state.me = makeWasteMe({ deskPoints: [{ id: 'pt-1', name: 'Đại lý Cô Ba', kind: 'PARTNER' }] });
    const c = await mount();
    expect(link(c, '/kho-qua')?.textContent).toContain('Kho quà');
    expect(link(c, '/doi-rac/quay')?.textContent).toContain('Nhận hàng tại điểm');
    expect(link(c, '/doi-rac/quy-dinh')?.textContent).toContain('Thể lệ chương trình');
  });

  it('không có deskPoints → không có lối vào quầy', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Điểm Xanh của bạn');
    expect(link(c, '/doi-rac/quay')).toBeNull();
  });

  it.each([
    ['chương trình tạm dừng', { programmeEnabled: false }],
    ['khách bị khoá', { blocked: true }],
  ] as const)('%s: có deskPoints thì vẫn có lối vào quầy, không thì không', async (_label, over) => {
    state.me = makeWasteMe({ ...over, deskPoints: [{ id: 'pt-1', name: 'Kho Tubu TP.HCM', kind: 'WAREHOUSE' }] });
    let c = await mount();
    expect(link(c, '/doi-rac/quay')?.textContent).toContain('Nhận hàng tại điểm');
    mounted.pop()!.unmount();
    state.me = makeWasteMe({ ...over, deskPoints: [] });
    c = await mount();
    expect(c.textContent).toMatch(/Chương trình đang tạm dừng|Tài khoản của bạn tạm không tham gia/);
    expect(link(c, '/doi-rac/quay')).toBeNull();
  });
});

describe('/doi-rac thẻ trạng thái và thứ tự ưu tiên (§4.1)', () => {
  it('chương trình tắt: ẩn thẻ đầu, ba cách, món, quà; hiện "Chương trình đang tạm dừng" và yêu cầu đang đi', async () => {
    state.me = makeWasteMe({ programmeEnabled: false, openRequests: [makeRequestSummary()] });
    const c = await mount();
    expect(c.textContent).toContain('Chương trình đang tạm dừng');
    for (const t of ['Điểm Xanh của bạn', 'Đổi rác ngay']) expect(c.textContent).not.toContain(t);
    expect(byText(c, 'h2', 'Cách đổi')).toBeNull();
    expect(byText(c, 'h2', 'Tubu nhận những món này')).toBeNull();
    expect(c.querySelector('[data-item]')).toBeNull();
    expect(link(c, '/kho-qua')).not.toBeNull();
    expect(link(c, '/doi-rac/yeu-cau/req-1')).not.toBeNull();
  });

  it('chương trình tắt: yêu cầu Mang tới và Thu kèm đơn chưa gắn đọc "Đang tạm dừng", Gửi về kho giữ nhãn cũ', async () => {
    state.me = makeWasteMe({
      programmeEnabled: false,
      openRequests: [
        makeRequestSummary({ id: 'r-d', code: 'TR-DROP1' }),
        makeRequestSummary({ id: 'r-p', code: 'TR-PICK1', method: 'PICKUP' }),
        makeRequestSummary({ id: 'r-m', code: 'TR-MAIL1', method: 'MAIL_IN' }),
      ],
    });
    state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } };
    const c = await mount();
    expect(c.textContent?.split('Đang tạm dừng').length).toBe(3);
    expect(c.textContent).toContain('Chờ bạn gửi kiện');
    expect(c.textContent).not.toContain('Chờ bạn mang tới');
    expect(c.textContent).not.toContain('Chờ gắn vào đơn');
  });

  it('khách bị khoá: yêu cầu Mang tới đọc "Đang tạm dừng"', async () => {
    state.me = makeWasteMe({ blocked: true, openRequests: [makeRequestSummary()] });
    const c = await mount();
    expect(c.textContent).toContain('Đang tạm dừng');
    expect(c.textContent).not.toContain('Chờ bạn mang tới');
  });

  it('chương trình bật: Mang tới đọc "Chờ bạn mang tới"; Thu kèm đơn tạm dừng khi cờ pickup tắt', async () => {
    state.me = makeWasteMe({ openRequests: [makeRequestSummary(), makeRequestSummary({ id: 'r-p', code: 'TR-PICK1', method: 'PICKUP' })] });
    state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } };
    let c = await mount();
    expect(c.textContent).toContain('Chờ bạn mang tới');
    expect(c.textContent).toContain('Chờ gắn vào đơn');
    mounted.pop()!.unmount();
    state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: false } };
    c = await mount();
    expect(c.textContent).toContain('Chờ bạn mang tới');
    expect(c.textContent).toContain('Đang tạm dừng');
    expect(c.textContent).not.toContain('Chờ gắn vào đơn');
  });

  it('NEED_PHONE + chương trình bật + có deskPoints: thông báo Mini App kèm lối vào /doi-rac/quay', async () => {
    state.me = makeWasteMe({ eligibility: 'NEED_PHONE', balance: null, monthUsage: null, deskPoints: [{ id: 'pt-1', name: 'Đại lý Cô Ba', kind: 'PARTNER' }] });
    const c = await mount();
    expect(c.textContent).toContain('Tính năng này cần mở Tubu Tree trên Zalo.');
    expect(link(c, '/doi-rac/quay')?.textContent).toContain('Nhận hàng tại điểm');
  });

  it('khách bị khoá: thẻ khoá, yêu cầu RECEIVED ghi "Đang chờ Tubu xem lại"', async () => {
    state.me = makeWasteMe({ blocked: true, openRequests: [makeRequestSummary({ method: 'MAIL_IN', status: 'RECEIVED' })] });
    const c = await mount();
    expect(c.textContent).toContain('Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree');
    expect(c.textContent).toContain('Đang chờ Tubu xem lại');
    expect(link(c, '/doi-rac/tao')).toBeNull();
  });

  it.each(['GUEST', 'NEED_PHONE'] as const)('eligibility %s: MiniAppOnlyNotice, không hộp chia sẻ SĐT, không lối vào nào (Q2)', async (eligibility) => {
    state.me = makeWasteMe({ eligibility, balance: null, monthUsage: null });
    const c = await mount();
    expect(c.textContent).toContain('Tính năng này cần mở Tubu Tree trên Zalo.');
    expect(c.textContent).not.toContain('Điểm Xanh của bạn');
    expect(c.textContent).not.toMatch(/số điện thoại/i);
    expect(link(c, '/doi-rac/yeu-cau')).toBeNull();
    expect(link(c, '/doi-rac/tao')).toBeNull();
    expect(state.calls).not.toContain('/me/loyalty/rewards');
  });

  it('NEED_PHONE + chương trình tắt: chỉ thẻ tạm dừng, không có thông báo Mini App', async () => {
    state.me = makeWasteMe({ programmeEnabled: false, eligibility: 'NEED_PHONE', balance: null, monthUsage: null });
    const c = await mount();
    expect(c.textContent).toContain('Chương trình đang tạm dừng');
    expect(c.textContent).not.toContain('Tính năng này cần mở Tubu Tree trên Zalo.');
  });

  it('khách chưa đăng nhập + chương trình tắt: chỉ thẻ tạm dừng, không gọi /waste/me', async () => {
    state.phase = 'guest';
    state.config = { isLoaded: true, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } };
    const c = await mount();
    expect(c.textContent).toContain('Chương trình đang tạm dừng');
    expect(c.querySelector('a[href^="/dang-nhap"]')).toBeNull();
    expect(state.calls).not.toContain('/waste/me');
  });

  it('khách chưa đăng nhập + chương trình bật: mời đăng nhập, quay lại đúng /doi-rac', async () => {
    state.phase = 'guest';
    const c = await mount();
    expect(c.querySelector('a[href*="/dang-nhap"]')?.getAttribute('href')).toContain(encodeURIComponent('/doi-rac'));
    expect(state.calls).not.toContain('/waste/me');
  });

  it('khách chưa đăng nhập + chương trình bật: thấy chương trình trước (bước, món, kho TP.HCM, Thể lệ), nút đăng nhập sau kèm lý do SĐT', async () => {
    state.phase = 'guest';
    state.catalogue = [ITEM_CARTON, { ...ITEM_MILK, warehouseOnly: true }];
    const c = await mount();
    expect(state.calls).toContain('/waste/catalogue');
    expect(c.textContent).toContain('Đổi bao bì lấy Điểm Xanh');
    expect(c.querySelectorAll('ol li')).toHaveLength(3);
    expect(c.querySelectorAll('[data-item]')).toHaveLength(2);
    expect(byText(c, '[data-item]', 'Vỏ hộp sữa')!.textContent).toContain('Chỉ kho TP.HCM nhận');
    expect(byText(c, '[data-item]', 'Thùng carton')!.textContent).not.toContain('Chỉ kho TP.HCM nhận');
    expect(link(c, '/doi-rac/quy-dinh')).not.toBeNull();
    const login = c.querySelector('a[href*="/dang-nhap"]')!;
    expect(login.textContent).toContain('Đăng nhập để đổi rác');
    expect(c.textContent).toContain('Cần số điện thoại để cộng Điểm Xanh');
    expect(c.textContent!.indexOf('Tubu nhận những món này')).toBeLessThan(c.textContent!.indexOf('Đăng nhập để đổi rác'));
  });

  it('khách chưa đăng nhập: danh mục rỗng thì không hiện tiêu đề món với danh sách trống', async () => {
    state.phase = 'guest';
    state.catalogue = [];
    const c = await mount();
    expect(c.textContent).not.toContain('Tubu nhận những món này');
    expect(c.querySelector('a[href*="/dang-nhap"]')).not.toBeNull();
  });

  it('khách chưa đăng nhập: danh mục lỗi thì vẫn thấy bước và nút đăng nhập', async () => {
    state.phase = 'guest';
    state.fail.add('/waste/catalogue');
    const c = await mount();
    expect(c.querySelectorAll('ol li')).toHaveLength(3);
    expect(c.querySelector('a[href*="/dang-nhap"]')).not.toBeNull();
  });

  it('lối vào quầy nằm trên cùng, trước thẻ điểm; món chỉ kho nhận có nhãn; 0 điểm thì không dòng "Dùng như 0đ"', async () => {
    state.me = makeWasteMe({
      deskPoints: [{ id: 'pt-1', name: 'Đại lý Cô Ba', kind: 'PARTNER' }],
      items: [ITEM_CARTON, { ...ITEM_MILK, warehouseOnly: true }],
      balance: { pointsBalance: 0, pointsConvertedBalance: 0, redeemablePoints: 0 },
    });
    const c = await mount();
    expect(c.textContent!.indexOf('Nhận hàng tại điểm')).toBeLessThan(c.textContent!.indexOf('Điểm Xanh của bạn'));
    expect(c.textContent).not.toContain('Dùng như');
    expect(byText(c, '[data-item]', 'Vỏ hộp sữa')!.textContent).toContain('Chỉ kho TP.HCM nhận');
  });

  it('khách chưa đăng nhập + cấu hình chưa tải: mời đăng nhập, không nháy "tạm dừng"', async () => {
    state.phase = 'guest';
    state.config = { isLoaded: false, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } };
    const c = await mount();
    expect(c.querySelector('a[href*="/dang-nhap"]')).not.toBeNull();
    expect(c.textContent).not.toContain('Chương trình đang tạm dừng');
  });

  it('đang khôi phục phiên → "Đang tải…", không kẹt', async () => {
    state.phase = 'loading';
    const c = await mount();
    expect(c.textContent).toContain('Đang tải…');
  });

  it('phiên lỗi mạng → SessionUnavailable, không vẽ trang trống', async () => {
    state.phase = 'unavailable';
    const c = await mount();
    expect(c.textContent).toContain('Không kết nối được với Tubu Tree');
  });

  it('lỗi tải /waste/me → ErrorState, "Thử lại" tải lại được', async () => {
    state.fail.add('/waste/me');
    const c = await mount();
    expect(c.textContent).toContain('mất mạng');
    click(byText(c, 'button', 'Thử lại'));
    await flush(6);
    expect(c.textContent).toContain('Điểm Xanh của bạn');
  });

  it('một h1, không nút lồng nhau, vùng chạm đủ 44px, mọi điều khiển có tên', async () => {
    state.me = makeWasteMe({ openRequests: [makeRequestSummary()], deskPoints: [{ id: 'pt-1', name: 'Kho', kind: 'WAREHOUSE' }] });
    const c = await mount();
    expect(c.querySelectorAll('h1')).toHaveLength(1);
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    expect(c.querySelector('a a, button button, a button, button a')).toBeNull();
  });
});

describe('/doi-rac — diện mạo Mini App ở điện thoại', () => {
  it('nút lịch sử không chồng px-5 với px-0 nên icon History hiện đủ; thẻ điểm không viền; hàng Kho quà trơn trên nền trang', async () => {
    const c = await mount();
    const history = c.querySelector<HTMLAnchorElement>('a[aria-label="Yêu cầu của tôi"]')!;
    expect(history.className).not.toContain('px-5');
    expect(history.querySelector('svg')).not.toBeNull();
    const pointsCard = byText(c, 'p', 'Điểm Xanh của bạn')!.parentElement!;
    expect(pointsCard.className).toContain('max-md:border-transparent');
    const rows = link(c, '/kho-qua')!.parentElement!;
    expect(rows.className).toContain('max-md:bg-transparent');
    expect(rows.className).toContain('max-md:shadow-none');
    expect(rows.className).not.toContain('box-shadow:var(--elevation');
    expect(link(c, '/kho-qua')!.className).toContain('max-md:px-0');
  });

  it('tiêu đề chừa 48px cho nút lùi nổi vì thân trang được kéo lên ngang nút', async () => {
    const c = await mount();
    expect(c.querySelector('h1')!.parentElement!.className).toContain('max-md:pl-12');
    expect(c.querySelector('a[aria-label="Trang chủ"]')).toBeNull();
  });

  it('Cách đổi là danh sách chữ phẳng, không viền để khách khỏi tưởng bấm được', async () => {
    const c = await mount();
    const row = byText(c, 'p', 'Mang tới điểm nhận')!.parentElement!;
    expect(row.tagName).toBe('LI');
    expect(row.className).not.toContain('border');
    expect(row.className).not.toContain('shadow');
  });
});
