import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WastePointDTO, WastePreviewDTO, WastePreviewRequest } from '@tubutree/shared-types';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  keySeq: 0,
  params: {} as Record<string, string>,
  location: { pathname: '/recycle/new', search: '', state: null as unknown },
  auth: { status: 'authenticated' as 'idle' | 'loading' | 'authenticated' | 'error' },
  login: vi.fn(),
  ensurePhone: vi.fn(),
  publicConfig: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } },
  getWasteMe: vi.fn(),
  getWastePoints: vi.fn(),
  getNearbyWastePoints: vi.fn(),
  previewWaste: vi.fn(),
  createWasteRequest: vi.fn(),
  invalidate: vi.fn(),
  getLoyaltyRewards: vi.fn(),
  getProvinces: vi.fn(),
  requestZaloLocation: vi.fn(),
  getZaloAccessToken: vi.fn(),
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div role="dialog">{children}</div> : null),
  useNavigate: () => mocks.navigate,
  useLocation: () => mocks.location,
  useParams: () => mocks.params,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/api', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi'),
  isNotFoundError: (e: unknown) => (e as { status?: number } | null)?.status === 404,
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { status: mocks.auth.status, login: mocks.login, ensurePhone: mocks.ensurePhone };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../utils/idempotency', () => ({ newIdempotencyKey: () => `key-${++mocks.keySeq}` }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.publicConfig }));
vi.mock('../services/waste-api', async (orig) => ({
  ...(await orig<object>()),
  getWasteMe: mocks.getWasteMe,
  getWastePoints: mocks.getWastePoints,
  getNearbyWastePoints: mocks.getNearbyWastePoints,
  previewWaste: mocks.previewWaste,
  createWasteRequest: mocks.createWasteRequest,
  invalidateAfterWasteWrite: mocks.invalidate,
}));
vi.mock('../utils/waste-labels', async (o) => ({ ...(await o<object>()), PREVIEW_DEBOUNCE_MS: 0 }));
vi.mock('../services/account-api', () => ({ getLoyaltyRewards: mocks.getLoyaltyRewards }));
vi.mock('../services/geo-api', () => ({ getProvinces: mocks.getProvinces }));
vi.mock('../services/zmp-bridge', () => ({ requestZaloLocation: mocks.requestZaloLocation, getZaloAccessToken: mocks.getZaloAccessToken }));

import RecycleNewPage, { toLineInputs, type WasteWizardDraft } from './recycle-new';
import { ITEM_CARTON, ITEM_MILK, makeWasteMe, makeWastePoint, makeRewardCatalog, makeRequestDetail } from '../services/waste-test-fixtures';
import { describeNested, findNestedInteractive } from '../components/ui/nested-interactive';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <RecycleNewPage />
    </QueryClientProvider>,
  );
  return { ...utils, qc, invalidate };
}

const preview = (over: Partial<WastePreviewDTO> = {}): WastePreviewDTO => ({ estimatedPoints: 6000, estimatedDrops: 0, estimatedGrams: null, pointsValueVnd: 6000, blocks: [], feeEstimate: null, itemCaps: [], pointsMonthRemaining: 190_000, ...over });
const DRAFT: WasteWizardDraft = { lines: { 'item-carton': 5, 'item-milk': 5 }, method: null, pointId: null, pickedPoint: null, provinceCode: null, nearby: null };
const atStep2 = (draft: WasteWizardDraft = DRAFT) => { mocks.location.search = '?step=method'; mocks.location.state = { draft }; };
const FEE = { zoneName: 'Miền Bắc', provinceCode: '01', provinceName: 'Hà Nội', low: 30000, high: 45000 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.keySeq = 0;
  mocks.location.search = ''; mocks.location.state = null;
  mocks.publicConfig.waste = { enabled: true, dropoff: true, mailin: true, pickup: true };
  mocks.getWasteMe.mockResolvedValue(makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: true } }));
  mocks.getWastePoints.mockResolvedValue([makeWastePoint()]);
  mocks.previewWaste.mockImplementation(async (b: WastePreviewRequest) => preview(b.method === 'MAIL_IN' ? { feeEstimate: { ...FEE, provinceCode: '79', provinceName: 'TP.HCM', low: 20000, high: 25000 }, estimatedPoints: 30_000, pointsValueVnd: 30000 } : {}));
  mocks.getLoyaltyRewards.mockResolvedValue(makeRewardCatalog({ redeemablePoints: 14_000 }));
  mocks.requestZaloLocation.mockResolvedValue(null);
  mocks.getProvinces.mockResolvedValue([{ code: '01', name: 'Hà Nội' }, { code: '79', name: 'TP.HCM' }]);
});

describe('bước 1: chọn món (§4.2)', () => {
  it('thẻ món: quy tắc, chuẩn bị, câu trần; món sắp nhận không có bộ đếm', async () => {
    renderPage();
    const carton = (await screen.findByText('Thùng carton')).closest('[data-item]') as HTMLElement;
    expect(within(carton).getByText('1 thùng = 1.000 điểm')).toBeInTheDocument();
    expect(within(carton).getByText('Tối đa 20 thùng mỗi tháng. Mỗi ngày mang tới điểm nhận tối đa 10 thùng')).toBeInTheDocument();
    expect(carton.querySelector('[data-item-media] img, [data-item-media] svg')).not.toBeNull();
    const battery = screen.getByText('Pin cũ').closest('[data-item]') as HTMLElement;
    expect(within(battery).queryByRole('button', { name: 'Tăng số lượng' })).toBeNull();
    expect(within(battery).getByText('Sắp nhận')).toBeInTheDocument();
    expect(within(battery).getByText('Đợt này Tubu chưa nhận pin')).toBeInTheDocument();
    expect(battery.style.opacity).toBe('');
    expect(battery).toHaveAttribute('aria-disabled', 'true');
    expect(carton.style.opacity).toBe('');
    expect(carton).not.toHaveAttribute('aria-disabled');
  });
  it('toLineInputs bỏ số lượng 0 và xếp theo itemId', () => {
    expect(toLineInputs({ 'item-milk': 2, 'item-carton': 0, 'item-battery': 1 })).toEqual([{ itemId: 'item-battery', declaredQty: 1 }, { itemId: 'item-milk', declaredQty: 2 }]);
  });
  it('bộ đếm kẹp theo phần trần tháng còn lại; món nhóm có "thêm N vỏ nữa được +1.000 điểm"', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ items: [{ ...ITEM_CARTON, monthRemainingQty: 1 }, ITEM_MILK] }));
    renderPage();
    const carton = (await screen.findByText('Thùng carton')).closest('[data-item]') as HTMLElement;
    fireEvent.click(within(carton).getByRole('button', { name: 'Tăng số lượng' }));
    expect(within(carton).getByRole('button', { name: 'Tăng số lượng' })).toHaveAttribute('aria-disabled', 'true');
    const milk = screen.getByText('Vỏ hộp sữa').closest('[data-item]') as HTMLElement;
    fireEvent.click(within(milk).getByRole('button', { name: 'Tăng số lượng' }));
    fireEvent.click(within(milk).getByRole('button', { name: 'Tăng số lượng' }));
    expect(within(milk).getByText('thêm 3 vỏ nữa được +1.000 điểm')).toBeInTheDocument();
    expect(within(milk).getByTestId('progress-fill')).toHaveStyle({ width: '40%' });
  });
  it('trần tháng đã bớt hoặc hết: thẻ món nói lý do dưới câu trần', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ items: [{ ...ITEM_CARTON, monthRemainingQty: 3 }, { ...ITEM_MILK, monthRemainingQty: 0 }] }));
    renderPage();
    const carton = (await screen.findByText('Thùng carton')).closest('[data-item]') as HTMLElement;
    expect(within(carton).getByText('Tháng này còn 3 thùng')).toBeInTheDocument();
    const milk = screen.getByText('Vỏ hộp sữa').closest('[data-item]') as HTMLElement;
    expect(within(milk).getByText('Tháng này bạn đã đủ trần cho món này')).toBeInTheDocument();
  });
  it('trần tháng còn nguyên: không có dòng "Tháng này còn"', async () => {
    renderPage();
    await screen.findByText('Thùng carton');
    expect(screen.queryByText(/Tháng này còn/)).toBeNull();
  });
  it('thanh dính đáy: điểm ước tính từ /waste/preview, quy ra tiền, câu so với quà kế tiếp; một lần gọi cho nhiều lần bấm nhanh', async () => {
    renderPage();
    const carton = (await screen.findByText('Thùng carton')).closest('[data-item]') as HTMLElement;
    const plus = within(carton).getByRole('button', { name: 'Tăng số lượng' });
    fireEvent.click(plus); fireEvent.click(plus); fireEvent.click(plus);
    await waitFor(() => expect(mocks.previewWaste).toHaveBeenCalledTimes(1));
    expect(mocks.previewWaste).toHaveBeenCalledWith({ lines: [{ itemId: 'item-carton', declaredQty: 3 }] });
    expect(await screen.findByText('Ước tính 6.000 điểm')).toBeInTheDocument();
    expect(screen.getByText(/6\.000đ/)).toBeInTheDocument();
    // redeemablePoints 14.000 + 6.000 ước tính = 20.000 → Miễn phí vận chuyển (20.000) đã đủ, quà kế tiếp là Gói hạt giống Tubu (25.000)
    expect(screen.getByText('Còn 5.000 điểm tới Gói hạt giống Tubu')).toBeInTheDocument();
  });
  it('trần tháng chạm ở bước 1 → thanh dính đáy hiện lời khoá thay cho ước tính, "Tiếp tục" khoá; trong trần thì ước tính và mở khoá', async () => {
    mocks.previewWaste.mockImplementation(async (b: WastePreviewRequest) => preview(b.lines[0]?.declaredQty === 3
      ? { estimatedPoints: 70_000, pointsValueVnd: 70_000, blocks: [{ code: 'POINTS_MONTH_CAP', pointsRemaining: 60_000 }] }
      : b.lines[0]?.declaredQty === 2
        ? { blocks: [{ code: 'ITEM_MONTH_CAP', itemId: 'item-carton' }], itemCaps: [{ itemId: 'item-carton', monthRemainingQty: 1, dayRemainingQty: null }] }
        : {}));
    renderPage();
    const carton = (await screen.findByText('Thùng carton')).closest('[data-item]') as HTMLElement;
    const plus = within(carton).getByRole('button', { name: 'Tăng số lượng' });
    fireEvent.click(plus);
    expect(await screen.findByText('Ước tính 6.000 điểm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).not.toBeDisabled();
    fireEvent.click(plus);
    expect(await screen.findByText('Tháng này Thùng carton chỉ còn 1 thùng')).toBeInTheDocument();
    expect(screen.queryByText(/Ước tính/)).toBeNull();
    expect(screen.queryByText(/Còn .* tới/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled();
    fireEvent.click(plus);
    expect(await screen.findByText('Tháng này bạn chỉ còn 60.000 điểm trong trần tháng')).toBeInTheDocument();
    expect(screen.queryByText(/Ước tính/)).toBeNull();
    expect(screen.queryByText(/Dùng như/)).toBeNull();
    expect(screen.queryByText(/Còn .* tới/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled();
  });
  it('"Tiếp tục" khoá cả lúc ước tính cũ chưa kịp thay (chờ debounce, đang tải), mở lại khi ước tính mới không khoá', async () => {
    let release: (v: WastePreviewDTO) => void = () => undefined;
    mocks.previewWaste.mockImplementation((b: WastePreviewRequest) => (b.lines[0]?.declaredQty === 2
      ? new Promise<WastePreviewDTO>((res) => { release = res; })
      : Promise.resolve(preview())));
    renderPage();
    const carton = (await screen.findByText('Thùng carton')).closest('[data-item]') as HTMLElement;
    const plus = within(carton).getByRole('button', { name: 'Tăng số lượng' });
    fireEvent.click(plus);
    expect(await screen.findByText('Ước tính 6.000 điểm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).not.toBeDisabled();
    fireEvent.click(plus);
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled();
    await waitFor(() => expect(mocks.previewWaste).toHaveBeenCalledWith({ lines: [{ itemId: 'item-carton', declaredQty: 2 }] }));
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled();
    release(preview({ blocks: [{ code: 'ITEM_MONTH_CAP', itemId: 'item-carton' }], itemCaps: [{ itemId: 'item-carton', monthRemainingQty: 1, dayRemainingQty: null }] }));
    expect(await screen.findByText('Tháng này Thùng carton chỉ còn 1 thùng')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled();
    fireEvent.click(within(carton).getByRole('button', { name: 'Giảm số lượng' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tiếp tục' })).not.toBeDisabled());
  });
  it('ước tính lỗi thì "Tiếp tục" vẫn mở (không đang tải, khoá khớp)', async () => {
    mocks.previewWaste.mockRejectedValue(new Error('Mất kết nối'));
    renderPage();
    const carton = (await screen.findByText('Thùng carton')).closest('[data-item]') as HTMLElement;
    fireEvent.click(within(carton).getByRole('button', { name: 'Tăng số lượng' }));
    await waitFor(() => expect(mocks.previewWaste).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tiếp tục' })).not.toBeDisabled());
  });
  it('"Tiếp tục" khoá khi chưa chọn món; bấm → lưu nháp vào mục hiện tại rồi đẩy ?step=method', async () => {
    renderPage();
    const next = await screen.findByRole('button', { name: 'Tiếp tục' });
    expect(next).toBeDisabled();
    const carton = screen.getByText('Thùng carton').closest('[data-item]') as HTMLElement;
    fireEvent.click(within(carton).getByRole('button', { name: 'Tăng số lượng' }));
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    const draft = { ...DRAFT, lines: { 'item-carton': 1 } };
    const stamped = { draft: expect.objectContaining({ ...draft, sid: expect.any(String) }) };
    expect(mocks.navigate.mock.calls).toEqual([
      ['/recycle/new', { replace: true, state: stamped }],
      ['/recycle/new?step=method', { state: stamped }],
    ]);
    const sids = mocks.navigate.mock.calls.map((c) => (c[1] as { state: { draft: WasteWizardDraft } }).state.draft.sid);
    expect(sids[0]).toBe(sids[1]);
  });
  it('chương trình tắt, chưa đủ điều kiện hoặc bị khoá → về /recycle', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ blocked: true }));
    renderPage();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/recycle', { replace: true }));
  });
});

describe('bước 2: chọn cách giao (§4.3)', () => {
  it('?step=method mà không có nháp → về bước 1', async () => {
    mocks.location.search = '?step=method';
    renderPage();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/recycle/new', { replace: true }));
  });
  it('không còn cách giao nào đang mở → câu giải thích thay cho nhóm chọn, "Tạo yêu cầu" khoá', async () => {
    mocks.publicConfig.waste = { enabled: true, dropoff: false, mailin: false, pickup: false };
    atStep2();
    renderPage();
    expect(await screen.findByText('Hiện chưa có cách giao nào đang mở, bạn quay lại sau nhé.')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByRole('button', { name: 'Tạo yêu cầu' })).toBeDisabled();
  });
  it('một preview cho mỗi cách đang bật, đúng thứ tự Mang tới, Thu kèm, Gửi về kho', async () => {
    atStep2();
    renderPage();
    const cards = await screen.findAllByRole('radio');
    expect(cards.map((c) => c.getAttribute('data-method'))).toEqual(['DROP_OFF', 'PICKUP', 'MAIL_IN']);
    await waitFor(() => expect(mocks.previewWaste).toHaveBeenCalledWith(expect.objectContaining({ method: 'MAIL_IN' })));
  });
  it('tỉnh của khách không có điểm nhận → Gửi về kho và Thu kèm lên đầu', async () => {
    mocks.getWastePoints.mockResolvedValue([makeWastePoint({ provinceCode: '01' })]);
    atStep2();
    renderPage();
    await waitFor(async () => expect((await screen.findAllByRole('radio')).map((c) => c.getAttribute('data-method'))).toEqual(['MAIL_IN', 'PICKUP', 'DROP_OFF']));
  });
  it('Gửi về kho: phí là khoảng giá theo bảng niêm yết, gói tối thiểu, dòng giới hạn kiện', async () => {
    atStep2();
    renderPage();
    const mail = await screen.findByRole('radio', { name: /Gửi về kho Tubu HCM/ });
    expect(await within(mail).findByText('Phí ship ước tính từ TP.HCM: 20.000đ – 25.000đ, ước tính theo bảng giá niêm yết')).toBeInTheDocument();
    expect(within(mail).getByText('Gói tối thiểu 15.000 điểm')).toBeInTheDocument();
    expect(within(mail.parentElement as HTMLElement).getByText('Mỗi kiện tối đa 10 kg, cạnh dài tối đa 60 cm. Hàng gửi về kho không hoàn lại. Kiện còn cước phải trả khi nhận bị kho từ chối ngay ở cửa.')).toBeInTheDocument();
    expect(screen.getByText('Mỗi kiện tối đa 10 kg, cạnh dài tối đa 60 cm.')).toBeInTheDocument();
    expect(screen.getAllByText(/Kiện còn cước phải trả khi nhận/)).toHaveLength(1);
  });
  it('giá trị điểm có thể thấp hơn phí (so với mức cao) → cảnh báo + lối thay thế đang bật', async () => {
    mocks.previewWaste.mockImplementation(async (b: WastePreviewRequest) => preview(b.method === 'MAIL_IN' ? { feeEstimate: FEE, estimatedPoints: 40_000, pointsValueVnd: 40000 } : {}));
    atStep2();
    renderPage();
    expect(await screen.findByText('Phí ship có thể cao hơn giá trị điểm bạn nhận được')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chọn Mang tới điểm nhận' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chọn Thu kèm đơn mua' })).toBeInTheDocument();
  });
  it('dưới ngưỡng gửi kho → thẻ khoá với "Cần thêm N điểm"; MAX_OPEN khoá mọi thẻ', async () => {
    mocks.previewWaste.mockImplementation(async (b: WastePreviewRequest) => preview({ blocks: b.method === 'MAIL_IN' ? [{ code: 'BELOW_MIN', missingPoints: 6000 }, { code: 'MAX_OPEN', openCount: 3 }] : [{ code: 'MAX_OPEN', openCount: 3 }] }));
    atStep2();
    renderPage();
    expect(await screen.findByText('Cần thêm 6.000 điểm')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('radio').every((r) => r.getAttribute('aria-disabled') === 'true')).toBe(true));
    expect(screen.getAllByText('Bạn đang có 3 yêu cầu chưa xong').length).toBeGreaterThan(0);
  });
  it('MONTH_CAP_FOR_MIN: thẻ Thu kèm đơn nói gói thu kèm đơn, thẻ Gửi về kho nói gói gửi kho', async () => {
    mocks.previewWaste.mockImplementation(async (b: WastePreviewRequest) => preview(b.method === 'PICKUP' || b.method === 'MAIL_IN' ? { blocks: [{ code: 'MONTH_CAP_FOR_MIN', pointsRemaining: 5_000 }] } : {}));
    atStep2();
    renderPage();
    const pickup = await screen.findByRole('radio', { name: /Thu kèm đơn/ });
    const mail = await screen.findByRole('radio', { name: /Gửi về kho/ });
    expect(await within(pickup).findByText('Tháng này bạn không còn đủ trần cho một gói thu kèm đơn')).toBeInTheDocument();
    expect(within(mail).getByText('Tháng này bạn không còn đủ trần cho một gói gửi kho')).toBeInTheDocument();
    expect(within(pickup).queryByText(/gói gửi kho/)).toBeNull();
  });
  it('phí ship ước tính ghi tên tỉnh từ danh sách, không ghi mã tỉnh', async () => {
    mocks.getProvinces.mockResolvedValue([{ code: '48', name: 'Đà Nẵng' }]);
    mocks.previewWaste.mockImplementation(async (b: WastePreviewRequest) => preview(b.method === 'MAIL_IN' ? { feeEstimate: { ...FEE, provinceCode: '48', provinceName: '48' } } : {}));
    atStep2();
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: /Gửi về kho/ }));
    expect(await screen.findByText(/Phí ship ước tính từ Đà Nẵng:/)).toBeInTheDocument();
    expect(screen.queryByText(/từ 48:/)).toBeNull();
  });
  it('danh sách tỉnh không tải được: phí ship ước tính bỏ cụm tên tỉnh thay vì in mã tỉnh', async () => {
    mocks.getProvinces.mockRejectedValue(new Error('offline'));
    mocks.previewWaste.mockImplementation(async (b: WastePreviewRequest) => preview(b.method === 'MAIL_IN' ? { feeEstimate: { ...FEE, provinceCode: '48', provinceName: '48' } } : {}));
    atStep2();
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: /Gửi về kho/ }));
    expect(await screen.findByText('Phí ship ước tính: 30.000đ – 45.000đ, ước tính theo bảng giá niêm yết')).toBeInTheDocument();
    expect(screen.queryByText(/từ 48/)).toBeNull();
  });
  it('NEED_PROVINCE → ô chọn tỉnh trên thẻ Gửi về kho; chọn → preview lại với provinceCode', async () => {
    mocks.previewWaste.mockImplementation(async (b: WastePreviewRequest) => preview(b.method === 'MAIL_IN' && !b.provinceCode ? { blocks: [{ code: 'NEED_PROVINCE' }] } : {}));
    atStep2();
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: /Gửi về kho/ }));
    const select = await screen.findByRole('combobox', { name: 'Chọn tỉnh để ước tính phí ship' });
    fireEvent.change(select, { target: { value: '01' } });
    await waitFor(() => expect(mocks.previewWaste).toHaveBeenCalledWith(expect.objectContaining({ method: 'MAIL_IN', provinceCode: '01' })));
  });
  it('chưa chọn Gửi về kho: không có ô chọn tỉnh và không có lời nhắc chọn tỉnh; chọn xong thì lời nhắc không dùng màu lỗi', async () => {
    mocks.previewWaste.mockImplementation(async (b: WastePreviewRequest) => preview(b.method === 'MAIL_IN' && !b.provinceCode ? { blocks: [{ code: 'NEED_PROVINCE' }] } : {}));
    atStep2();
    renderPage();
    const mail = await screen.findByRole('radio', { name: /Gửi về kho/ });
    await waitFor(() => expect(mocks.previewWaste).toHaveBeenCalledWith(expect.objectContaining({ method: 'MAIL_IN' })));
    expect(screen.queryByRole('combobox', { name: 'Chọn tỉnh để ước tính phí ship' })).toBeNull();
    expect(within(mail).queryByText('Chọn tỉnh để ước tính phí ship')).toBeNull();
    fireEvent.click(mail);
    const prompt = await within(await screen.findByRole('radio', { name: /Gửi về kho/ })).findByText('Chọn tỉnh để ước tính phí ship');
    expect(prompt.style.color).toBe('var(--color-text-secondary)');
  });
  it('thẻ khoá: chỉ phần tên, mô tả và ước tính bị làm mờ; lý do giữ nguyên độ đậm', async () => {
    mocks.previewWaste.mockImplementation(async (b: WastePreviewRequest) => preview({ blocks: b.method === 'MAIL_IN' ? [{ code: 'BELOW_MIN', missingPoints: 6000 }] : [] }));
    atStep2();
    renderPage();
    const reason = await screen.findByText('Cần thêm 6.000 điểm');
    expect(reason.closest('[style*="opacity"]')).toBeNull();
    const card = screen.getByRole('radio', { name: /Gửi về kho/ });
    expect((card.querySelector('[style*="opacity: 0.6"]') as HTMLElement).textContent).toContain('Gửi về kho Tubu HCM');
    expect(card.style.opacity).toBe('');
  });
  it('khoá đường kho → ẩn Gửi về kho và Thu kèm, hiện câu ghim', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ shipLockedAt: '2026-10-01T00:00:00.000Z', laneFlags: { dropoff: true, mailin: true, pickup: true } }));
    atStep2();
    renderPage();
    expect(await screen.findByText('Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn, liên hệ CSKH.')).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((c) => c.getAttribute('data-method'))).toEqual(['DROP_OFF']);
  });
  it('có vị trí và điểm gần nhất < 5 km → "Nhanh nhất" ở thẻ Mang tới điểm nhận; token chỉ trong body', async () => {
    mocks.requestZaloLocation.mockResolvedValue({ token: 'loc' });
    mocks.getZaloAccessToken.mockResolvedValue({ accessToken: 'acc', code: 'c' });
    mocks.getNearbyWastePoints.mockResolvedValue([makeWastePoint({ distanceKm: 1.2 })]);
    atStep2();
    renderPage();
    expect(await within(await screen.findByRole('radio', { name: /Mang tới điểm nhận/ })).findByText('Nhanh nhất')).toBeInTheDocument();
    expect(mocks.getNearbyWastePoints).toHaveBeenCalledWith({ locationToken: 'loc', zaloAccessToken: 'acc' });
  });
  it('xin vị trí đúng một lần, sau khi /waste/me về (Mang tới chỉ bật khi đã có me)', async () => {
    mocks.requestZaloLocation.mockResolvedValue({ token: 'loc' });
    mocks.getZaloAccessToken.mockResolvedValue({ accessToken: 'acc', code: 'c' });
    mocks.getNearbyWastePoints.mockResolvedValue([makeWastePoint({ distanceKm: 1.2 })]);
    atStep2();
    renderPage();
    expect(await screen.findByText('Nhanh nhất')).toBeInTheDocument();
    expect(mocks.requestZaloLocation).toHaveBeenCalledTimes(1);
  });
  it('máy chủ không đổi được vị trí (mọi distanceKm null) → coi như thất bại: nháp không giữ danh sách gần', async () => {
    mocks.requestZaloLocation.mockResolvedValue({ token: 'loc' });
    mocks.getZaloAccessToken.mockResolvedValue({ accessToken: 'acc', code: 'c' });
    mocks.getNearbyWastePoints.mockResolvedValue([makeWastePoint()]);
    atStep2();
    renderPage();
    await waitFor(() => expect(mocks.getNearbyWastePoints).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('radio', { name: /Mang tới điểm nhận/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Chọn điểm nhận' }));
    expect(mocks.navigate.mock.lastCall?.[1].state.draft.nearby).toBeNull();
    expect(screen.queryByText('Nhanh nhất')).toBeNull();
  });
  it('vị trí về trễ không xoá cách giao khách vừa chọn', async () => {
    let resolveNearby: (v: WastePointDTO[]) => void = () => {};
    mocks.requestZaloLocation.mockResolvedValue({ token: 'loc' });
    mocks.getZaloAccessToken.mockResolvedValue({ accessToken: 'acc', code: 'c' });
    mocks.getNearbyWastePoints.mockReturnValue(new Promise<WastePointDTO[]>((r) => { resolveNearby = r; }));
    atStep2();
    renderPage();
    await waitFor(() => expect(mocks.getNearbyWastePoints).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('radio', { name: /Mang tới điểm nhận/ }));
    await act(async () => { resolveNearby([makeWastePoint({ distanceKm: 1.2 })]); });
    expect(screen.getByRole('radio', { name: /Mang tới điểm nhận/ })).toHaveAttribute('aria-checked', 'true');
  });
  it('Mang tới điểm nhận: "Chọn điểm nhận" thay mục lịch sử bằng /recycle/points kèm nháp', async () => {
    atStep2();
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: /Mang tới điểm nhận/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Chọn điểm nhận' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle/points', { replace: true, state: { returnTo: '/recycle/new?step=method', draft: { ...DRAFT, method: 'DROP_OFF' }, selectedItemIds: ['item-carton', 'item-milk'] } });
  });
});

describe('tạo yêu cầu (§15.2, §16.1 idempotency)', () => {
  const PICKED = { ...DRAFT, method: 'DROP_OFF' as const, pointId: 'pt-1', pickedPoint: makeWastePoint() };
  it('đồng ý bắt buộc; tạo xong → làm mới khoá, thay mục bằng /recycle/r/:id', async () => {
    mocks.createWasteRequest.mockResolvedValue(makeRequestDetail({ id: 'req-9' }));
    atStep2(PICKED);
    renderPage();
    const create = await screen.findByRole('button', { name: 'Tạo yêu cầu' });
    expect(create).toBeDisabled();
    screen.getByRole('checkbox', { name: 'Tôi đồng ý với Thể lệ Đổi rác và để Tubu Tree xử lý yêu cầu này' }).click();
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() => expect(mocks.createWasteRequest).toHaveBeenCalledWith({ method: 'DROP_OFF', lines: [{ itemId: 'item-carton', declaredQty: 5 }, { itemId: 'item-milk', declaredQty: 5 }], pointId: 'pt-1', consent: true }, 'key-1'));
    await waitFor(() => expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle/r/req-9', { replace: true }));
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });
  it('tạo xong rồi Back về mục bước 1 giữ nháp đã gửi → không hiện lại số lượng, thay mục bằng /recycle', async () => {
    mocks.createWasteRequest.mockResolvedValue(makeRequestDetail({ id: 'req-9' }));
    const lines = { 'item-carton': 3 };
    const itemsEntry = { draft: { ...DRAFT, lines, sid: 'wizard-1' } };
    atStep2({ ...PICKED, lines, sid: 'wizard-1' });
    const first = renderPage();
    (await screen.findByRole('checkbox', { name: 'Tôi đồng ý với Thể lệ Đổi rác và để Tubu Tree xử lý yêu cầu này' })).click();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo yêu cầu' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle/r/req-9', { replace: true }));
    first.unmount();
    mocks.navigate.mockClear();

    mocks.location.search = ''; mocks.location.state = itemsEntry;
    renderPage();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/recycle', { replace: true }));
    expect(screen.queryByText('Thùng carton')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tiếp tục' })).toBeNull();
    expect(mocks.createWasteRequest).toHaveBeenCalledTimes(1);
  });
  it('một lần mở bước 1 mới sau đó với cùng số lượng (phiên khác) không bị coi là đã gửi', async () => {
    mocks.createWasteRequest.mockResolvedValue(makeRequestDetail({ id: 'req-9' }));
    const lines = { 'item-carton': 3 };
    atStep2({ ...PICKED, lines, sid: 'wizard-1' });
    const first = renderPage();
    (await screen.findByRole('checkbox', { name: 'Tôi đồng ý với Thể lệ Đổi rác và để Tubu Tree xử lý yêu cầu này' })).click();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo yêu cầu' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle/r/req-9', { replace: true }));
    first.unmount();
    mocks.navigate.mockClear();

    mocks.location.search = ''; mocks.location.state = { draft: { ...DRAFT, lines, sid: 'other' } };
    renderPage();
    expect(await screen.findByText('Bước 1/2: Chọn món')).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalledWith('/recycle', expect.anything());
  });
  it('mục bước 1 có nháp chưa từng gửi (về từ chọn điểm hay nạp lại) vẫn hiện nguyên số lượng', async () => {
    mocks.location.search = ''; mocks.location.state = { draft: { ...DRAFT, lines: { 'item-carton': 7 } } };
    renderPage();
    expect(await screen.findByText('Bước 1/2: Chọn món')).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it('lỗi mạng → snackbar câu của máy chủ, bấm lại dùng CÙNG khoá', async () => {
    mocks.createWasteRequest.mockRejectedValueOnce(new Error('Điểm nhận đang tạm ngừng, hãy chọn điểm khác')).mockResolvedValue(makeRequestDetail());
    atStep2(PICKED);
    renderPage();
    (await screen.findByRole('checkbox', { name: 'Tôi đồng ý với Thể lệ Đổi rác và để Tubu Tree xử lý yêu cầu này' })).click();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo yêu cầu' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Điểm nhận đang tạm ngừng, hãy chọn điểm khác', type: 'error' })));
    fireEvent.click(screen.getByRole('button', { name: 'Tạo yêu cầu' }));
    await waitFor(() => expect(mocks.createWasteRequest).toHaveBeenCalledTimes(2));
    expect(mocks.createWasteRequest.mock.calls.map((c) => c[1])).toEqual(['key-1', 'key-1']);
  });
  it('Gửi về kho cần thêm hai cam kết, và gửi packagingConsent + postagePaidConsent', async () => {
    mocks.createWasteRequest.mockResolvedValue(makeRequestDetail({ method: 'MAIL_IN' }));
    atStep2({ ...DRAFT, method: 'MAIL_IN', lines: { 'item-carton': 20 } });
    renderPage();
    expect(await screen.findByText('Mỗi kiện là một yêu cầu riêng: có nhiều kiện thì tạo nhiều yêu cầu, mỗi kiện một mã TR-.')).toBeInTheDocument();
    (await screen.findByRole('checkbox', { name: 'Tôi đồng ý với Thể lệ Đổi rác và để Tubu Tree xử lý yêu cầu này' })).click();
    const create = screen.getByRole('button', { name: 'Tạo yêu cầu' });
    expect(create).toBeDisabled();
    screen.getByRole('checkbox', { name: 'Tôi đóng gói không lẫn pin, hoá chất, vật nhọn, đồ ướt hoặc bẩn' }).click();
    screen.getByRole('checkbox', { name: 'Tôi đã trả đủ cước gửi, kho từ chối kiện còn cước phải trả khi nhận' }).click();
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() => expect(mocks.createWasteRequest).toHaveBeenCalledWith({ method: 'MAIL_IN', lines: [{ itemId: 'item-carton', declaredQty: 20 }], consent: true, packagingConsent: true, postagePaidConsent: true }, 'key-1'));
  });
  it('một PageHeader, không lồng nút', async () => {
    atStep2();
    const { container } = renderPage();
    await screen.findAllByRole('radio');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(findNestedInteractive(container).map(describeNested)).toEqual([]);
  });
});

describe('khai món nhanh và báo trước (B-35/B-36/B-82)', () => {
  beforeEach(() => localStorage.clear());
  it('chưa chọn món: dòng lý do dưới nút Tiếp tục', async () => {
    renderPage();
    expect(await screen.findByText('Chọn ít nhất 1 món để tiếp tục')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled();
  });
  it('+5 cộng nhanh, gõ số trực tiếp, và không vượt trần tháng còn lại', async () => {
    renderPage();
    const carton = (await screen.findByText('Thùng carton')).closest('[data-item]') as HTMLElement;
    fireEvent.click(within(carton).getByRole('button', { name: 'Thêm 5' }));
    const box = within(carton).getByRole('textbox', { name: 'Số lượng' });
    expect(box).toHaveValue('5');
    fireEvent.change(box, { target: { value: '12' } });
    expect(box).toHaveValue('12');
    fireEvent.click(within(carton).getByRole('button', { name: 'Thêm 10' }));
    expect(box).toHaveValue('20');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeEnabled());
  });
  it('món chỉ kho nhận ghi "Chỉ kho TP.HCM nhận" và không in trần theo ngày của điểm', async () => {
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ items: [ITEM_CARTON, { ...ITEM_MILK, warehouseOnly: true, dailyCapQty: 50 }] }));
    renderPage();
    const milk = (await screen.findByText('Vỏ hộp sữa')).closest('[data-item]') as HTMLElement;
    expect(within(milk).getByText('Chỉ kho TP.HCM nhận')).toBeInTheDocument();
    expect(within(milk).queryByText(/mỗi ngày/)).toBeNull();
    const carton = screen.getByText('Thùng carton').closest('[data-item]') as HTMLElement;
    expect(within(carton).queryByText('Chỉ kho TP.HCM nhận')).toBeNull();
  });
  it('bước 2 nói lý do nút Tạo yêu cầu còn khoá theo từng việc còn thiếu', async () => {
    mocks.getWastePoints.mockResolvedValue([makeWastePoint()]);
    atStep2();
    renderPage();
    expect(await screen.findByText('Chọn cách giao để tạo yêu cầu')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('radio', { name: /Mang tới điểm nhận/ }));
    expect(await screen.findByText('Chọn điểm nhận để tạo yêu cầu')).toBeInTheDocument();
  });
  it('có điểm lần trước thì chọn sẵn Mang tới điểm nhận kèm điểm đó, chỉ còn tick đồng ý', async () => {
    const store = new Map<string, string>([['tubu.waste.lastPointId', 'pt-2']]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    mocks.getWastePoints.mockResolvedValue([makeWastePoint(), makeWastePoint({ id: 'pt-2', name: 'Đại lý Hai' })]);
    atStep2();
    renderPage();
    expect(await screen.findByText('Đại lý Hai')).toBeInTheDocument();
    expect(screen.getByText('Tick các ô đồng ý ở trên để tạo yêu cầu')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Mang tới điểm nhận/ })).toHaveAttribute('aria-checked', 'true');
    vi.unstubAllGlobals();
  });
  it('không có điểm lần trước và chưa có vị trí thì không chọn sẵn gì', async () => {
    atStep2();
    renderPage();
    await screen.findByRole('radio', { name: /Mang tới điểm nhận/ });
    expect(screen.getByRole('radio', { name: /Mang tới điểm nhận/ })).toHaveAttribute('aria-checked', 'false');
    expect(mocks.requestZaloLocation).toHaveBeenCalledTimes(1);
  });
  it('link Thể lệ cạnh ô đồng ý', async () => {
    atStep2({ ...DRAFT, method: 'DROP_OFF', pointId: 'pt-1', pickedPoint: makeWastePoint() });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem Thể lệ' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/rules');
  });
});
