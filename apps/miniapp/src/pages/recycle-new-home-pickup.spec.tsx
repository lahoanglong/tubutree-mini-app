import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WastePreviewDTO } from '@tubutree/shared-types';
import { HOME_PICKUP_BATTERY_TEXT } from '@tubutree/app-core/waste-copy';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  keySeq: 0,
  location: { pathname: '/recycle/new', search: '', state: null as unknown },
  auth: { status: 'authenticated' as const },
  publicConfig: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } },
  getWasteMe: vi.fn(),
  getWasteRules: vi.fn(),
  getWastePoints: vi.fn(),
  getNearbyWastePoints: vi.fn(),
  previewWaste: vi.fn(),
  createWasteRequest: vi.fn(),
  getWastePickupQuote: vi.fn(),
  getAddresses: vi.fn(),
  invalidate: vi.fn(),
  getLoyaltyRewards: vi.fn(),
  getProvinces: vi.fn(),
  requestZaloLocation: vi.fn(),
  getZaloAccessToken: vi.fn(),
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div data-testid="zaui-sheet">{children}</div> : null),
  useNavigate: () => mocks.navigate,
  useLocation: () => mocks.location,
  useParams: () => ({}),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { status: mocks.auth.status, login: vi.fn(), ensurePhone: vi.fn() };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../utils/idempotency', () => ({ newIdempotencyKey: () => `key-${++mocks.keySeq}` }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.publicConfig }));
vi.mock('../services/waste-api', async (orig) => ({
  ...(await orig<object>()),
  getWasteMe: mocks.getWasteMe,
  getWasteRules: mocks.getWasteRules,
  getWastePoints: mocks.getWastePoints,
  getNearbyWastePoints: mocks.getNearbyWastePoints,
  previewWaste: mocks.previewWaste,
  createWasteRequest: mocks.createWasteRequest,
  getWastePickupQuote: mocks.getWastePickupQuote,
  invalidateAfterWasteWrite: mocks.invalidate,
}));
vi.mock('../services/shop-api', async (orig) => ({ ...(await orig<object>()), getAddresses: mocks.getAddresses }));
vi.mock('../utils/waste-labels', async (o) => ({ ...(await o<object>()), PREVIEW_DEBOUNCE_MS: 0 }));
vi.mock('@tubutree/app-core/recycle-home-pickup-state', async (o) => ({ ...(await o<object>()), HOME_PICKUP_QUOTE_DEBOUNCE_MS: 0 }));
vi.mock('../services/account-api', () => ({ getLoyaltyRewards: mocks.getLoyaltyRewards }));
vi.mock('../services/geo-api', () => ({ getProvinces: mocks.getProvinces }));
vi.mock('../services/zmp-bridge', () => ({ requestZaloLocation: mocks.requestZaloLocation, getZaloAccessToken: mocks.getZaloAccessToken }));
vi.mock('../components/address-form', () => ({
  AddressForm: ({ initial, onCancel, onSaved }: { initial?: { id: string } | null; onCancel: () => void; onSaved: (a: unknown) => void }) => (
    <div data-testid="address-form" data-mode={initial ? 'edit' : 'add'}>
      <button type="button" onClick={() => onSaved({ ...makeAddress({ id: initial?.id ?? 'addr-new', street: '99 Hai Bà Trưng', isDefault: false }) })}>
        Lưu địa chỉ
      </button>
      <button type="button" onClick={onCancel}>Đóng form</button>
    </div>
  ),
}));

import RecycleNewPage, { type WasteWizardDraft } from './recycle-new';
import { ITEM_BATTERY, ITEM_CARTON, ITEM_MILK, makeRequestDetail, makeWasteMe, makeWastePoint, makeRewardCatalog } from '../services/waste-test-fixtures';
import { makeAddress, makeQuote } from '../services/waste-home-pickup-fixtures';
import { HttpError } from '../services/http';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { ...render(<QueryClientProvider client={qc}><RecycleNewPage /></QueryClientProvider>), qc };
}

const preview = (): WastePreviewDTO => ({ estimatedPoints: 6000, estimatedDrops: 0, estimatedGrams: null, pointsValueVnd: 6000, blocks: [], feeEstimate: null, itemCaps: [], pointsMonthRemaining: 190_000 });
// 5 thùng × 300g + 5 vỏ × 100g = 2.000g → chip mặc định 2 kg.
const ITEMS = [{ ...ITEM_CARTON, gramsPerUnit: 300 }, { ...ITEM_MILK, gramsPerUnit: 100 }, ITEM_BATTERY];
const LINES = { 'item-carton': 5, 'item-milk': 5 };
const DRAFT: WasteWizardDraft = { lines: LINES, method: 'HOME_PICKUP', pointId: null, pickedPoint: null, provinceCode: null, nearby: null };
const CONSENT = 'Tôi đồng ý với Thể lệ Đổi rác và để Tubu Tree xử lý yêu cầu này';
const atStep2 = (draft: WasteWizardDraft = DRAFT) => { mocks.location.search = '?step=method'; mocks.location.state = { draft }; };
const SHORT_SENTENCE = 'Phí shipper lấy rác cần trả bằng Điểm Xanh, bạn còn thiếu 15.000 điểm. Hãy chọn mang tới điểm thu gom hoặc đổi rác kèm đơn mua nhé';
const FEE_UNAVAILABLE = 'Chưa báo được phí shipper lúc này, bạn thử lại sau ít phút nhé';
const short = (over: object = {}) => makeQuote({ pointsAvailable: 10_000, pointsApplicable: 10_000, remainingFeeVnd: 15_000, blocked: SHORT_SENTENCE, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.keySeq = 0;
  mocks.location.search = ''; mocks.location.state = null;
  mocks.publicConfig.waste = { enabled: true, dropoff: true, mailin: true, pickup: true };
  mocks.getWasteMe.mockResolvedValue(makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: true }, items: ITEMS }));
  mocks.getWasteRules.mockResolvedValue({ text: 'Thể lệ', version: 'v1' });
  mocks.getWastePoints.mockResolvedValue([makeWastePoint()]);
  mocks.previewWaste.mockImplementation(async () => preview());
  mocks.getLoyaltyRewards.mockResolvedValue(makeRewardCatalog({ redeemablePoints: 14_000 }));
  mocks.requestZaloLocation.mockResolvedValue(null);
  mocks.getProvinces.mockResolvedValue([]);
  mocks.getAddresses.mockResolvedValue([makeAddress()]);
  mocks.getWastePickupQuote.mockResolvedValue(makeQuote());
  mocks.createWasteRequest.mockResolvedValue(makeRequestDetail({ id: 'req-9', method: 'HOME_PICKUP' }));
});

const consentBox = () => screen.findByRole('checkbox', { name: CONSENT });
const createButton = () => screen.findByRole('button', { name: 'Tạo đơn thu gom' });
const quoteBody = (over: object = {}) => ({ addressId: 'addr-1', declaredWeightGrams: 2000, lines: [{ itemId: 'item-carton', declaredQty: 5 }, { itemId: 'item-milk', declaredQty: 5 }], ...over });

describe('Shipper lấy tận nhà: thẻ cách giao ở bước 2', () => {
  it('hiện cùng các cách khác khi cổng thu gom mở; ẩn khi cổng tắt hay khách bị khoá đường vận chuyển', async () => {
    atStep2({ ...DRAFT, method: null });
    const { unmount } = renderPage();
    expect(await screen.findByRole('radio', { name: /Shipper lấy tận nhà/ })).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('data-method'))).toEqual(['DROP_OFF', 'PICKUP', 'MAIL_IN', 'HOME_PICKUP']);
    unmount();

    mocks.publicConfig.waste = { enabled: true, dropoff: true, mailin: true, pickup: false };
    atStep2({ ...DRAFT, method: null });
    const second = renderPage();
    await screen.findByRole('radio', { name: /Mang tới điểm nhận/ });
    expect(screen.queryByRole('radio', { name: /Shipper lấy tận nhà/ })).toBeNull();
    second.unmount();

    mocks.publicConfig.waste = { enabled: true, dropoff: true, mailin: true, pickup: true };
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: true }, items: ITEMS, shipLockedAt: '2026-10-01T00:00:00.000Z' }));
    atStep2({ ...DRAFT, method: null });
    renderPage();
    await screen.findByRole('radio', { name: /Mang tới điểm nhận/ });
    expect(screen.queryByRole('radio', { name: /Shipper lấy tận nhà/ })).toBeNull();
  });

  it('không gọi xem trước /waste/preview cho thẻ này, và chưa chọn thì chưa tải sổ địa chỉ', async () => {
    atStep2({ ...DRAFT, method: null });
    renderPage();
    await screen.findByRole('radio', { name: /Shipper lấy tận nhà/ });
    await waitFor(() => expect(mocks.previewWaste).toHaveBeenCalled());
    expect(mocks.previewWaste.mock.calls.map((c) => c[0].method)).not.toContain('HOME_PICKUP');
    expect(mocks.getAddresses).not.toHaveBeenCalled();
    expect(mocks.getWastePickupQuote).not.toHaveBeenCalled();
  });
});

describe('Shipper lấy tận nhà: báo phí', () => {
  it('chọn thẻ → địa chỉ mặc định được chọn sẵn, số kg theo ước lượng món, một lần báo phí đúng thân', async () => {
    atStep2();
    renderPage();
    expect(await screen.findByText('Phí shipper thu gom tận nơi')).toBeInTheDocument();
    expect(mocks.getWastePickupQuote).toHaveBeenCalledTimes(1);
    expect(mocks.getWastePickupQuote).toHaveBeenCalledWith(quoteBody());
    expect(screen.getByRole('radio', { name: /Nguyễn Văn An/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: '2 kg' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button', { name: /kg$/ }).map((b) => b.textContent)).toEqual(['0,5 kg', '1 kg', '2 kg', '3 kg', '5 kg', '10 kg']);
  });

  it('báo phí thật: phí, điểm dùng được và điểm sẽ trừ, không công tắc, không nhãn "Ước tính" cạnh phí', async () => {
    atStep2();
    renderPage();
    expect(await screen.findByTestId('home-pickup-fee-value')).toHaveTextContent('25.000đ');
    expect(screen.getByTestId('home-pickup-pay')).toHaveTextContent('Điểm Xanh dùng được 40.000 · sẽ trừ 25.000 điểm');
    expect(screen.queryByRole('checkbox', { name: /Điểm Xanh/ })).toBeNull();
    expect(screen.getByTestId('home-pickup-points')).toHaveTextContent('Ước tính 6.000 điểm');
    expect(within(screen.getByTestId('home-pickup-fee')).queryByText('Ước tính')).toBeNull();
    expect(screen.queryByTestId('home-pickup-notice')).toBeNull();
  });

  it('không còn chữ thu hộ / COD / tiền mặt / "khi bưu tá tới" ở bất kỳ trạng thái nào của thẻ phí', async () => {
    mocks.getWastePickupQuote.mockResolvedValue(short());
    atStep2();
    renderPage();
    await screen.findByTestId('home-pickup-notice');
    expect(screen.getByTestId('home-pickup').textContent).not.toMatch(/thu hộ|COD|tiền mặt|khi bưu tá|khi shipper/i);
  });

  it('thiếu Điểm Xanh: đúng câu của máy chủ một lần, không số tiền còn lại, nút Tạo đơn khoá dù đã tick đồng ý', async () => {
    mocks.getWastePickupQuote.mockResolvedValue(short());
    atStep2();
    renderPage();
    expect(await screen.findByTestId('home-pickup-notice')).toHaveTextContent(SHORT_SENTENCE);
    expect(screen.getAllByText(SHORT_SENTENCE)).toHaveLength(1);
    expect(screen.getByTestId('home-pickup-pay')).toHaveTextContent('Điểm Xanh dùng được 10.000');
    expect(screen.getByTestId('home-pickup-pay').textContent).not.toMatch(/sẽ trừ/);
    (await consentBox()).click();
    expect(await createButton()).toBeDisabled();
    expect(mocks.createWasteRequest).not.toHaveBeenCalled();
  });

  it('không có Điểm Xanh nào: vẫn đúng câu chặn của máy chủ, nút khoá', async () => {
    mocks.getWastePickupQuote.mockResolvedValue(short({ pointsAvailable: 0, pointsApplicable: 0, remainingFeeVnd: 25_000, blocked: SHORT_SENTENCE.replace('15.000', '25.000') }));
    atStep2();
    renderPage();
    expect(await screen.findByTestId('home-pickup-notice')).toHaveTextContent('bạn còn thiếu 25.000 điểm');
    expect(screen.getByTestId('home-pickup-pay')).toHaveTextContent('Điểm Xanh dùng được 0');
    (await consentBox()).click();
    expect(await createButton()).toBeDisabled();
  });

  it('phí ước lượng: nhãn "Ước tính" cạnh phí, câu chưa báo được phí, nút Tạo đơn khoá dù đã tick đồng ý', async () => {
    mocks.getWastePickupQuote.mockResolvedValue(makeQuote({ estimated: true }));
    atStep2();
    renderPage();
    const card = await screen.findByTestId('home-pickup-fee');
    expect(await within(card).findByText('Ước tính')).toBeInTheDocument();
    expect(screen.getByTestId('home-pickup-notice')).toHaveTextContent(FEE_UNAVAILABLE);
    (await consentBox()).click();
    expect(await createButton()).toBeDisabled();
    expect(mocks.createWasteRequest).not.toHaveBeenCalled();
  });

  it('đổi số kg: báo phí lại với số kg mới, nút khoá tới khi phí mới về', async () => {
    let release: (q: ReturnType<typeof makeQuote>) => void = () => {};
    atStep2();
    renderPage();
    await screen.findByTestId('home-pickup-fee-value');
    mocks.getWastePickupQuote.mockReturnValueOnce(new Promise((r) => { release = r; }));
    fireEvent.click(screen.getByRole('button', { name: '5 kg' }));
    await waitFor(() => expect(mocks.getWastePickupQuote).toHaveBeenLastCalledWith(quoteBody({ declaredWeightGrams: 5000 })));
    expect(await screen.findByText('Đang tính phí ship…')).toBeInTheDocument();
    expect(await createButton()).toBeDisabled();
    release(makeQuote({ shipFeeVnd: 35_000, pointsApplicable: 35_000, remainingFeeVnd: 0 }));
    expect(await screen.findByText('35.000đ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5 kg' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('máy chủ chặn: một dòng lý do dưới thẻ, nút Tạo đơn khoá', async () => {
    mocks.getWastePickupQuote.mockResolvedValue(makeQuote({ blocked: 'Bạn đang có 3 yêu cầu chưa xong, hãy hoàn tất hoặc huỷ bớt trước khi tạo thêm' }));
    atStep2();
    renderPage();
    expect(await screen.findByTestId('home-pickup-notice')).toHaveTextContent('Bạn đang có 3 yêu cầu chưa xong, hãy hoàn tất hoặc huỷ bớt trước khi tạo thêm');
    (await consentBox()).click();
    expect(await createButton()).toBeDisabled();
  });

  it('dưới ngưỡng điểm: "Dự kiến X / Y điểm", nút khoá, không lặp câu "cần tối thiểu" của máy chủ', async () => {
    mocks.getWastePickupQuote.mockResolvedValue(makeQuote({ estimatedPoints: 3000, minPoints: 5000, blocked: 'Đơn thu gom cần tối thiểu 5.000 điểm ước tính' }));
    atStep2();
    renderPage();
    expect(await screen.findByTestId('home-pickup-points')).toHaveTextContent('Dự kiến 3.000 / 5.000 điểm');
    expect(screen.queryByTestId('home-pickup-notice')).toBeNull();
    (await consentBox()).click();
    expect(await createButton()).toBeDisabled();
  });

  it('địa chỉ không giao được: lời của máy chủ cùng nút "Sửa địa chỉ này", nút Tạo đơn khoá', async () => {
    mocks.getWastePickupQuote.mockResolvedValue(makeQuote({ addressOk: false, addressMessage: 'Đơn vị vận chuyển chưa nhận diện được địa chỉ này' }));
    atStep2();
    renderPage();
    expect(await screen.findByTestId('home-pickup-notice')).toHaveTextContent('Đơn vị vận chuyển chưa nhận diện được địa chỉ này');
    fireEvent.click(screen.getByRole('button', { name: 'Sửa địa chỉ này' }));
    expect(screen.getByTestId('address-form')).toHaveAttribute('data-mode', 'edit');
    (await consentBox()).click();
    expect(await createButton()).toBeDisabled();
  });

  it('báo phí lỗi: câu lỗi và nút Thử lại, nút Tạo đơn khoá; thử lại thành công thì mở', async () => {
    mocks.getWastePickupQuote.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(makeQuote());
    atStep2();
    renderPage();
    expect(await screen.findByText('Chưa tính được phí ship, bạn thử lại nhé')).toBeInTheDocument();
    expect(await createButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByTestId('home-pickup-fee-value')).toHaveTextContent('25.000đ');
  });
});

describe('Shipper lấy tận nhà: báo phí gặp 503', () => {
  it('máy chủ trả 503 kèm câu "chưa báo được phí": hiện đúng câu đó thay câu chung, nút Tạo đơn khoá, Thử lại được', async () => {
    mocks.getWastePickupQuote
      .mockRejectedValueOnce(new HttpError(FEE_UNAVAILABLE, undefined, { status: 503, data: { message: FEE_UNAVAILABLE } } as never))
      .mockResolvedValue(makeQuote());
    atStep2();
    renderPage();
    expect(await screen.findByText(FEE_UNAVAILABLE)).toBeInTheDocument();
    expect(screen.queryByText('Chưa tính được phí ship, bạn thử lại nhé')).toBeNull();
    expect(await createButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByTestId('home-pickup-fee-value')).toHaveTextContent('25.000đ');
  });
});

describe('Shipper lấy tận nhà: Pin cũ ngoài TP.HCM', () => {
  const withBattery = () => {
    const battery = { ...ITEM_BATTERY, status: 'ACTIVE' as const, hazardous: true, gramsPerUnit: 50, unitsPerPoint: 1, pointsPerGroup: 1000 };
    mocks.getWasteMe.mockResolvedValue(makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: true }, items: [ITEM_CARTON, battery] }));
    atStep2({ ...DRAFT, lines: { 'item-carton': 2, 'item-battery': 4 } });
  };

  it('địa chỉ ngoài TP.HCM: câu cố định, nút khoá', async () => {
    withBattery();
    mocks.getAddresses.mockResolvedValue([makeAddress({ province: 'Hà Nội' })]);
    renderPage();
    expect(await screen.findByTestId('home-pickup-notice')).toHaveTextContent(HOME_PICKUP_BATTERY_TEXT);
    (await consentBox()).click();
    expect(await createButton()).toBeDisabled();
  });

  it('địa chỉ ở TP.HCM: không có câu chặn, tạo được', async () => {
    withBattery();
    renderPage();
    await screen.findByTestId('home-pickup-fee-value');
    expect(screen.queryByTestId('home-pickup-notice')).toBeNull();
    (await consentBox()).click();
    await waitFor(async () => expect(await createButton()).toBeEnabled());
  });

  it('không có Pin trong giỏ thì địa chỉ ngoài TP.HCM vẫn tạo được', async () => {
    mocks.getAddresses.mockResolvedValue([makeAddress({ province: 'Hà Nội' })]);
    atStep2();
    renderPage();
    await screen.findByTestId('home-pickup-fee-value');
    expect(screen.queryByTestId('home-pickup-notice')).toBeNull();
  });
});

describe('Shipper lấy tận nhà: sổ địa chỉ', () => {
  it('chưa có địa chỉ: câu mời thêm, nút Tạo đơn khoá và nhắc chọn địa chỉ; thêm xong thì chọn và báo phí', async () => {
    mocks.getAddresses.mockResolvedValue([]);
    atStep2();
    renderPage();
    expect(await screen.findByText(/Bạn chưa có địa chỉ nào/)).toBeInTheDocument();
    expect(screen.getByText('Chọn địa chỉ lấy rác để tạo đơn thu gom')).toBeInTheDocument();
    expect(mocks.getWastePickupQuote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm địa chỉ' }));
    expect(screen.getByTestId('address-form')).toHaveAttribute('data-mode', 'add');
    mocks.getAddresses.mockResolvedValue([makeAddress({ id: 'addr-new', street: '99 Hai Bà Trưng', isDefault: false })]);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu địa chỉ' }));
    await waitFor(() => expect(mocks.getWastePickupQuote).toHaveBeenCalledWith(quoteBody({ addressId: 'addr-new' })));
    expect(screen.getByRole('radio', { name: /99 Hai Bà Trưng/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('chọn địa chỉ khác → báo phí lại cho địa chỉ đó', async () => {
    mocks.getAddresses.mockResolvedValue([makeAddress(), makeAddress({ id: 'addr-2', recipient: 'Trần Thị Bình', street: '5 Nguyễn Huệ', isDefault: false })]);
    atStep2();
    renderPage();
    await screen.findByTestId('home-pickup-fee-value');
    fireEvent.click(screen.getByRole('radio', { name: /Trần Thị Bình/ }));
    await waitFor(() => expect(mocks.getWastePickupQuote).toHaveBeenLastCalledWith(quoteBody({ addressId: 'addr-2' })));
  });

  it('sổ địa chỉ không tải được: câu lỗi và nút Thử lại', async () => {
    mocks.getAddresses.mockRejectedValueOnce(new Error('x')).mockResolvedValue([makeAddress()]);
    atStep2();
    renderPage();
    expect(await screen.findByText('Chưa tải được sổ địa chỉ')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByTestId('home-pickup-fee-value')).toBeInTheDocument();
  });
});

describe('Shipper lấy tận nhà: tạo đơn thu gom', () => {
  it('thân tạo đơn đủ trường kèm Idempotency-Key, một nút duy nhất, xong thì sang chi tiết yêu cầu', async () => {
    atStep2();
    renderPage();
    await screen.findByTestId('home-pickup-fee-value');
    const create = await createButton();
    expect(create).toBeDisabled();
    expect(screen.getByText('Tick ô đồng ý ở trên để tạo đơn thu gom')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tạo yêu cầu' })).toBeNull();
    (await consentBox()).click();
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() =>
      expect(mocks.createWasteRequest).toHaveBeenCalledWith(
        {
          method: 'HOME_PICKUP',
          lines: [{ itemId: 'item-carton', declaredQty: 5 }, { itemId: 'item-milk', declaredQty: 5 }],
          consent: true,
          consentVersion: 'v1',
          pickupAddressId: 'addr-1',
          declaredWeightGrams: 2000,
          usePointsForShipFee: true,
        },
        expect.stringMatching(/^key-\d+$/),
      ),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle/r/req-9', { replace: true }));
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });

  it('luôn gửi usePointsForShipFee=true, kể cả khi đổi số kg', async () => {
    atStep2();
    renderPage();
    await screen.findByTestId('home-pickup-fee-value');
    fireEvent.click(screen.getByRole('button', { name: '5 kg' }));
    await waitFor(() => expect(mocks.getWastePickupQuote).toHaveBeenLastCalledWith(quoteBody({ declaredWeightGrams: 5000 })));
    await screen.findByTestId('home-pickup-fee-value');
    (await consentBox()).click();
    const create = await createButton();
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() => expect(mocks.createWasteRequest).toHaveBeenCalledTimes(1));
    expect(mocks.createWasteRequest.mock.calls[0]![0]).toMatchObject({ declaredWeightGrams: 5000, usePointsForShipFee: true });
  });

  it('503 chưa báo được phí khi tạo: snackbar đúng câu của máy chủ, nút mở lại để thử lại', async () => {
    mocks.createWasteRequest.mockRejectedValueOnce(new HttpError(FEE_UNAVAILABLE, undefined, { status: 503, data: { message: FEE_UNAVAILABLE } } as never));
    atStep2();
    renderPage();
    await screen.findByTestId('home-pickup-fee-value');
    (await consentBox()).click();
    const create = await createButton();
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: FEE_UNAVAILABLE, type: 'error' })));
    await waitFor(() => expect(create).toBeEnabled());
  });

  it('lỗi 400 của máy chủ (thiếu Điểm Xanh lúc tạo): snackbar đúng câu của máy chủ; bấm lại dùng CÙNG khoá, không gửi trùng khi đang gửi', async () => {
    mocks.createWasteRequest
      .mockRejectedValueOnce(new HttpError(SHORT_SENTENCE, undefined, { status: 400, data: { message: SHORT_SENTENCE } } as never))
      .mockResolvedValue(makeRequestDetail({ id: 'req-9', method: 'HOME_PICKUP' }));
    atStep2();
    renderPage();
    await screen.findByTestId('home-pickup-fee-value');
    (await consentBox()).click();
    const create = await createButton();
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    fireEvent.click(create);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: SHORT_SENTENCE, type: 'error' })));
    expect(mocks.createWasteRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Tạo đơn thu gom' }));
    await waitFor(() => expect(mocks.createWasteRequest).toHaveBeenCalledTimes(2));
    const [first, second] = mocks.createWasteRequest.mock.calls.map((c) => c[1]);
    expect(first).toMatch(/^key-\d+$/);
    expect(second).toBe(first);
  });

  it('409 báo dữ liệu cũ: tải lại báo phí', async () => {
    mocks.createWasteRequest.mockRejectedValueOnce(new HttpError('Phí ship đã đổi, bạn xem lại giúp Tubu nhé', undefined, { status: 409, data: { message: 'Phí ship đã đổi, bạn xem lại giúp Tubu nhé' } } as never));
    atStep2();
    renderPage();
    await screen.findByTestId('home-pickup-fee-value');
    (await consentBox()).click();
    const create = await createButton();
    await waitFor(() => expect(create).toBeEnabled());
    mocks.getWastePickupQuote.mockClear();
    fireEvent.click(create);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(mocks.getWastePickupQuote).toHaveBeenCalled());
  });

  it('nháp giữ lựa chọn thu gom khi mở Thể lệ rồi quay lại', async () => {
    atStep2({ ...DRAFT, homePickup: { addressId: 'addr-1', weightGrams: 5000 } });
    renderPage();
    await screen.findByTestId('home-pickup-fee-value');
    expect(mocks.getWastePickupQuote).toHaveBeenCalledWith(quoteBody({ declaredWeightGrams: 5000 }));
    expect(screen.getByRole('button', { name: '5 kg' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('home-pickup-pay')).toHaveTextContent('Điểm Xanh dùng được 40.000 · sẽ trừ 25.000 điểm');
  });

  it('W178 thiếu Điểm Xanh (NEED_FEE_PAYMENT): hiện "Miễn phí lấy rác 100%", một chạm đổi sang PICKUP / DROP_OFF giữ nguyên món, và trả phần thiếu bằng Ví Tubu', async () => {
    mocks.getWastePickupQuote.mockResolvedValue(
      short({
        pointsAvailable: 8_000,
        pointsApplicable: 8_000,
        remainingFeeVnd: 17_000,
        cashDueVnd: 17_000,
        blockedCode: 'NEED_FEE_PAYMENT',
        feePaths: {
          wallet: { balance: 40_000, enough: true },
          bankTransfer: { enabled: false },
          attachNextOrder: { available: true, reason: null, existingRequestId: null },
        },
      }),
    );
    atStep2();
    const { unmount } = renderPage();
    const block = await screen.findByTestId('home-pickup-fee-short');
    expect(block).toHaveTextContent('Miễn phí lấy rác 100%');
    expect(block).toHaveTextContent('Khuyên dùng');
    expect(screen.getByTestId('home-pickup-cash-due')).toHaveTextContent('17.000đ');
    (await consentBox()).click();

    // Chưa chọn cách trả -> nút dính đáy duy nhất hiện "Chọn cách trả phí" và bị khoá
    const pickBtn = await screen.findByRole('button', { name: 'Chọn cách trả phí' });
    expect(pickBtn).toBeDisabled();

    // Chọn trả bằng Ví -> nhãn nút đổi thành "Trả 17.000đ từ Ví và đặt lấy rác", gửi kèm shipFeePayment + expectedCashVnd
    fireEvent.click(screen.getByRole('radio', { name: /Trả 17.000đ bằng Ví Tubu/ }));
    const payBtn = await screen.findByRole('button', { name: 'Trả 17.000đ từ Ví và đặt lấy rác' });
    await waitFor(() => expect(payBtn).toBeEnabled());
    fireEvent.click(payBtn);
    await waitFor(() =>
      expect(mocks.createWasteRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'HOME_PICKUP',
          usePointsForShipFee: true,
          shipFeePayment: 'WALLET',
          expectedCashVnd: 17_000,
        }),
        expect.stringMatching(/^key-\d+$/),
      ),
    );
    unmount();

    // Một chạm "Gửi kèm đơn mua kế tiếp" đổi phương thức sang PICKUP, khối thiếu phí biến mất
    mocks.createWasteRequest.mockClear();
    atStep2();
    renderPage();
    fireEvent.click(await screen.findByTestId('fee-path-attach'));
    expect(screen.queryByTestId('home-pickup-fee-short')).toBeNull();
    expect(screen.getByRole('radio', { name: /Thu kèm đơn mua/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Tạo yêu cầu' })).toBeInTheDocument();
  });
});
