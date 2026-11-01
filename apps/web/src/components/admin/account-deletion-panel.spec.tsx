// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AccountDeletionPanel, type AdminDeletionRequest } from './account-deletion-panel';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';

/** Ô nhập theo chữ nhãn hiện của Field (tên truy cập lấy từ nhãn, không còn aria-label riêng). */
const field = (root: ParentNode, label: string) =>
  Array.from(root.querySelectorAll('label'))
    .find((l) => l.querySelector('span')?.textContent === label)
    ?.querySelector('input') ?? null;

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const req = (over: Partial<AdminDeletionRequest> = {}): AdminDeletionRequest => ({
  id: 'r1',
  userId: 'u1',
  reason: 'Không dùng nữa',
  status: 'PENDING',
  adminNote: null,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-10-01T03:00:00.000Z',
  user: {
    id: 'u1',
    fullName: 'Nguyễn Văn A',
    phone: '0912345678',
    role: 'CUSTOMER',
    walletBalance: 0,
    pointsConvertedBalance: 0,
    cashbackPending: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  blockers: [],
  ...over,
});

describe('AccountDeletionPanel (C-016)', () => {
  it('mở từ thẻ Hôm nay (seed > 0): cuộn tới khối yêu cầu xoá tài khoản và quay về hàng chờ xử lý; không seed thì không cuộn', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const api = mockFetch({ '/admin/account-deletion-requests': { body: [req()] } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const plain = mount(<AccountDeletionPanel />);
    await flush();
    expect(scroll).not.toHaveBeenCalled();
    plain.unmount();
    mounted = [];

    const { container } = mount(<AccountDeletionPanel seed={1} />);
    await flush();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(container.querySelector('#account-deletions'));
    expect(container.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('Chờ xử lý');
  });

  it('khối được cuộn tới chừa chỗ cho thanh "Đổi mục" dính ở đầu trang dưới khổ lg, để tiêu đề không nằm dưới thanh', async () => {
    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/admin/account-deletion-requests': { body: [req()] } }).fn));
    const { container } = mount(<AccountDeletionPanel seed={1} />);
    await flush();
    const classes = container.querySelector('#account-deletions')!.classList;
    expect(classes.contains('scroll-mt-20')).toBe(true);
    expect(classes.contains('lg:scroll-mt-4')).toBe(true);
  });

  it('khách đã đồng ý bỏ số dư Ví: admin thấy số tiền và thời điểm đồng ý', async () => {
    const api = mockFetch({
      '/admin/account-deletion-requests': { body: [req({ walletForfeitAmount: 42000, walletForfeitConsentAt: '2026-10-25T03:00:00.000Z' })] },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<AccountDeletionPanel />);
    await flush();
    expect(container.textContent).toContain('Khách đã đồng ý bỏ số dư Ví 42.000đ');
  });

  it('liệt kê yêu cầu chờ xử lý kèm tên, SĐT, lý do', async () => {
    const api = mockFetch({ '/admin/account-deletion-requests': { body: [req()] } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<AccountDeletionPanel />);
    await flush();
    expect(api.calls[0]!.url).toContain('/admin/account-deletion-requests?status=PENDING');
    expect(container.textContent).toContain('Yêu cầu xoá tài khoản');
    expect(container.textContent).toContain('Nguyễn Văn A');
    expect(container.textContent).toContain('0912345678');
    expect(container.textContent).toContain('Không dùng nữa');
  });

  it('yêu cầu chờ xử lý hiện số Điểm Xanh không hết hạn của khách, không còn "xu"', async () => {
    const base = req();
    const api = mockFetch({
      '/admin/account-deletion-requests': { body: [req({ user: { ...base.user!, pointsConvertedBalance: 1250 } })] },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<AccountDeletionPanel />);
    await flush();
    expect(container.textContent).toContain('1.250 Điểm Xanh không hết hạn');
    expect(container.textContent).not.toMatch(/(?<![\p{L}_])xu(?![\p{L}_])/iu);
  });

  it('còn lý do chặn → hiện lý do, nút Xử lý bị khoá', async () => {
    const api = mockFetch({
      '/admin/account-deletion-requests': {
        body: [req({ blockers: [{ code: 'WALLET_BALANCE', message: 'Ví Tubu còn 50.000đ, khách cần rút hết trước' }] })],
      },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<AccountDeletionPanel />);
    await flush();
    expect(container.textContent).toContain('Ví Tubu còn 50.000đ');
    const btn = byText(container, 'button', 'Xử lý') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('bấm Xử lý + xác nhận → POST process với ghi chú; huỷ xác nhận thì không gọi', async () => {
    const api = mockFetch({
      '/process': { body: { alreadyProcessed: false } },
      '/admin/account-deletion-requests': { body: [req()] },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const native = vi.spyOn(window, 'confirm');
    const { container } = mount(<AccountDeletionPanel />);
    await flush();
    typeInto(field(container, 'Ghi chú xử lý (tuỳ chọn)'), 'đã gọi xác nhận');
    click(byText(container, 'button', 'Xử lý'));
    await flush();
    const d = confirmDialog()!;
    expect(d).not.toBeNull();
    expect(d.textContent).toContain('Nguyễn Văn A');
    expect(d.textContent).toMatch(/Không hoàn tác được/);
    expect(d.querySelector('[data-confirm="accept"]')?.className).toContain('bg-danger-fg');
    answerConfirm(false);
    await flush();
    expect(api.calls.some((c) => c.url.includes('/process'))).toBe(false);
    click(byText(container, 'button', 'Xử lý'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(native).not.toHaveBeenCalled();
    const call = api.calls.find((c) => c.url.includes('/process'));
    expect(call?.url).toContain('/admin/account-deletion-requests/r1/process');
    expect(call?.init?.method).toBe('POST');
    expect(call?.init?.body).toBe(JSON.stringify({ note: 'đã gọi xác nhận' }));
  });

  describe('xoá dù còn tiền Ví', () => {
    const wallet = (balance: number, code = 'WALLET_BALANCE') =>
      req({
        user: { ...req().user!, walletBalance: balance },
        blockers: [{ code, message: 'Ví Tubu còn 50.000đ mà khách chưa đồng ý bỏ số dư' }],
      });
    const setup = async (r: AdminDeletionRequest) => {
      const api = mockFetch({
        '/process': { body: { alreadyProcessed: false } },
        '/admin/account-deletion-requests': { body: [r] },
      });
      vi.stubGlobal('fetch', vi.fn(api.fn));
      const view = mount(<AccountDeletionPanel />);
      await flush();
      return { api, ...view };
    };

    it('Ví dương bị chặn: có nút, hộp thoại nêu số tiền, bắt buộc lý do >= 10 ký tự, rồi POST overrideWalletBalance', async () => {
      const { api, container } = await setup(wallet(50_000));
      click(byText(container, 'button', 'Xoá dù còn tiền Ví'));
      await flush();
      const d = confirmDialog()!;
      expect(d.textContent).toContain('50.000đ');
      const accept = d.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!;
      expect(accept.disabled).toBe(true);
      const ta = d.querySelector('textarea')!;
      typeInto(ta, 'ngắn');
      await flush();
      expect(accept.disabled).toBe(true);
      typeInto(ta, '  khách đã thu hồi đồng ý trên Zalo  ');
      await flush();
      expect(accept.disabled).toBe(false);
      answerConfirm(true);
      await flush();
      const call = api.calls.find((c) => c.url.includes('/process'));
      expect(call?.init?.body).toBe(JSON.stringify({ overrideWalletBalance: { reason: 'khách đã thu hồi đồng ý trên Zalo', expectedWalletBalance: 50_000 } }));
    });

    it('lý do chứa số điện thoại bị chặn ngay trong hộp thoại, hộp nêu rõ không ghi tên/SĐT', async () => {
      const { container } = await setup(wallet(50_000));
      click(byText(container, 'button', 'Xoá dù còn tiền Ví'));
      await flush();
      const d = confirmDialog()!;
      expect(d.textContent).toContain('không ghi tên hay số điện thoại khách');
      typeInto(d.querySelector('textarea'), 'gọi khách 0912 345 678 xác nhận');
      await flush();
      expect(d.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!.disabled).toBe(true);
      expect(d.textContent).toContain('không được chứa số điện thoại');
    });

    it.each(['khách 0912345678 đồng ý', 'khách 0912.345.678 đồng ý', 'khách +84 912 345 678 đồng ý', 'khách 84912345678 đồng ý', 'khách 0912  345 678 đồng ý'])(
      'số điện thoại bị chặn: %s',
      async (text) => {
        const { container } = await setup(wallet(50_000));
        click(byText(container, 'button', 'Xoá dù còn tiền Ví'));
        await flush();
        const d = confirmDialog()!;
        typeInto(d.querySelector('textarea'), text);
        await flush();
        expect(d.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!.disabled).toBe(true);
      },
    );

    it.each(['đơn TUBU2610310012 đã huỷ', 'đơn TUBUSUB7659607093 chờ xử lý', 'Ví 500.000.000đ do lỗi nạp', 'thu hồi lúc 2026-11-01 07:43'])(
      'mã đơn, số tiền, mốc giờ không bị coi là số điện thoại: %s',
      async (text) => {
        const { container } = await setup(wallet(50_000));
        click(byText(container, 'button', 'Xoá dù còn tiền Ví'));
        await flush();
        const d = confirmDialog()!;
        typeInto(d.querySelector('textarea'), text);
        await flush();
        expect(d.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!.disabled).toBe(false);
      },
    );

    it('lý do 9 emoji (18 đơn vị UTF-16 nhưng 9 ký tự) vẫn bị coi là ngắn', async () => {
      const { container } = await setup(wallet(50_000));
      click(byText(container, 'button', 'Xoá dù còn tiền Ví'));
      await flush();
      const d = confirmDialog()!;
      typeInto(d.querySelector('textarea'), '😀'.repeat(9));
      await flush();
      expect(d.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!.disabled).toBe(true);
    });

    it('Ví + vướng mắc khác: nút Xoá dù còn tiền Ví hiện nhưng khoá, kèm gợi ý liệt kê vướng mắc cần giải quyết', async () => {
      const r = req({
        user: { ...req().user!, walletBalance: 50_000 },
        blockers: [
          { code: 'WALLET_BALANCE', message: 'Ví Tubu còn 50.000đ mà khách chưa đồng ý bỏ số dư' },
          { code: 'ORDER_IN_PROGRESS', message: 'còn 1 đơn hàng chưa hoàn tất' },
        ],
      });
      const { container } = await setup(r);
      const btn = byText(container, 'button', 'Xoá dù còn tiền Ví') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(container.textContent).toContain('Cần giải quyết trước: còn 1 đơn hàng chưa hoàn tất');
    });

    it('huỷ hộp thoại thì không gọi API', async () => {
      const { api, container } = await setup(wallet(50_000));
      click(byText(container, 'button', 'Xoá dù còn tiền Ví'));
      await flush();
      answerConfirm(false);
      await flush();
      expect(api.calls.some((c) => c.url.includes('/process'))).toBe(false);
    });

    it('nút thường vẫn khoá khi còn blocker', async () => {
      const { container } = await setup(wallet(50_000));
      expect((byText(container, 'button', 'Xử lý (ẩn danh)') as HTMLButtonElement).disabled).toBe(true);
    });

    it('không có nút khi blocker không phải Ví, hoặc Ví âm', async () => {
      const a = await setup(wallet(50_000, 'ORDER_IN_PROGRESS'));
      expect(byText(a.container, 'button', 'Xoá dù còn tiền Ví')).toBeNull();
      a.unmount();
      mounted = [];
      const b = await setup(wallet(-5_000));
      expect(byText(b.container, 'button', 'Xoá dù còn tiền Ví')).toBeNull();
    });

    it('yêu cầu đã xử lý bằng ghi đè: hiện số tiền đã trừ và lý do', async () => {
      const { container } = await setup(
        req({ status: 'RESOLVED', reviewedAt: '2026-10-02T03:00:00.000Z', walletOverrideAmount: 50_000, walletOverrideBy: 'adm1', walletOverrideByName: 'Admin Lan', walletOverrideReason: 'khách mất liên lạc' }),
      );
      expect(container.textContent).toContain('bởi Admin Lan');
      expect(container.textContent).toContain('Xoá dù còn tiền Ví: đã trừ 50.000đ');
      expect(container.textContent).toContain('khách mất liên lạc');
    });
  });

  it('server từ chối (vừa phát sinh số dư) → hiện thông báo lỗi tiếng Việt', async () => {
    const api = mockFetch({
      '/process': { status: 400, body: { code: 'ACCOUNT_DELETION_BLOCKED', message: 'Chưa thể xoá tài khoản: còn 1 đơn hàng chưa hoàn tất.' } },
      '/admin/account-deletion-requests': { body: [req()] },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<AccountDeletionPanel />);
    await flush();
    click(byText(container, 'button', 'Xử lý'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('còn 1 đơn hàng chưa hoàn tất');
  });

  it('yêu cầu đã xử lý: không có nút Xử lý, hiện thời điểm xử lý', async () => {
    const api = mockFetch({
      '/admin/account-deletion-requests': {
        body: [req({ status: 'RESOLVED', reviewedAt: '2026-10-02T03:00:00.000Z', adminNote: 'xong', user: null })],
      },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<AccountDeletionPanel />);
    await flush();
    click(byText(container, 'button', 'Đã xử lý'));
    await flush();
    expect(api.calls.some((c) => c.url.includes('status=RESOLVED'))).toBe(true);
    expect(byText(container, 'button', /^Xử lý/)).toBeNull();
    expect(container.textContent).toContain('xong');
  });

  // D7-11: vai trò hiện nhãn tiếng Việt, không lộ mã enum.
  it('huy hiệu vai trò của người xin xoá: "CTV", không phải AFFILIATE', async () => {
    const base = req();
    const api = mockFetch({ '/admin/account-deletion-requests': { body: [req({ user: { ...base.user!, role: 'AFFILIATE' } })] } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<AccountDeletionPanel />);
    await flush();
    expect(container.textContent).toContain('CTV');
    expect(container.textContent).not.toContain('AFFILIATE');
  });
});
