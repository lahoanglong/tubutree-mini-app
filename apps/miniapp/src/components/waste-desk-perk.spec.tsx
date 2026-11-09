import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentType, ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BottomSheetProps } from './ui/bottom-sheet';
import type { ButtonProps } from './ui/button';

const mocks = vi.hoisted(() => ({
  openSnackbar: vi.fn(),
  submitDeskPerk: vi.fn(),
  getDeskPointReport: vi.fn(),
}));
// Bọc BottomSheet/Button/Input để đọc props mới nhất: `dismissible=false`, nút `disabled`/`loading` và ô nhập `disabled`
// đã chặn mọi thao tác thật, nên chỉ gọi thẳng onClose/onPress/onChange mới chứng minh được guard trong WasteDeskPerk/WasteDeskReport.
type InputSpy = { value: string; disabled?: boolean; onChange: (e: { target: { value: string } }) => void };
const ctl = vi.hoisted(() => ({
  buttons: new Map<string, ButtonProps>(),
  sheet: null as BottomSheetProps | null,
  input: null as InputSpy | null,
}));
vi.mock('./ui/button', async (importOriginal) => {
  const orig = await importOriginal<{ Button: ComponentType<ButtonProps> }>();
  return {
    ...orig,
    Button: (p: ButtonProps) => {
      ctl.buttons.set(String(p.children), p);
      return <orig.Button {...p} />;
    },
  };
});
vi.mock('./ui/bottom-sheet', async (importOriginal) => {
  const orig = await importOriginal<{ BottomSheet: ComponentType<BottomSheetProps> }>();
  return {
    ...orig,
    BottomSheet: (p: BottomSheetProps) => {
      ctl.sheet = p;
      return <orig.BottomSheet {...p} />;
    },
  };
});

vi.mock('zmp-ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  const ZInput = orig.Input as ComponentType<InputSpy>;
  return {
    ...orig,
    Input: (p: InputSpy) => {
      ctl.input = p;
      return <ZInput {...p} />;
    },
    Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div data-testid="zaui-sheet">{children}</div> : null),
    useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
  };
});
vi.mock('../services/api', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi'),
  getLoadErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi'),
}));
vi.mock('../services/waste-api', async (orig) => ({
  ...(await orig<object>()),
  submitDeskPerk: mocks.submitDeskPerk,
  getDeskPointReport: mocks.getDeskPointReport,
}));

import { WasteDeskPerk, WasteDeskReport, vnMonthKey } from './waste-desk-perk';
import { makeDeskPoint, WAREHOUSE_DESK } from '../services/waste-test-fixtures';

function renderWith(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const REPORT = { pointId: 'pt-1', month: '2026-10', confirmations: 12, pointsAwarded: 120_000, quotaUsed: 120_000, units: [{ itemId: 'item-carton', itemName: 'Thùng carton', unitLabel: 'thùng', qty: 80 }] };
const sheetOpen = () => screen.queryByTestId('zaui-sheet') !== null;
const editBtn = () => screen.getByRole('button', { name: 'Chỉnh sửa', hidden: true });
const sendBtn = () => screen.getByRole('button', { name: 'Gửi duyệt' });
const openSheet = async () => {
  fireEvent.click(editBtn());
  return (await screen.findByLabelText('Nội dung ưu đãi')) as HTMLInputElement;
};

beforeEach(() => {
  vi.clearAllMocks();
  ctl.buttons.clear();
  ctl.sheet = null;
  ctl.input = null;
});

describe('WasteDeskPerk (§4.10, §5.6)', () => {
  it('đại lý: thẻ ưu đãi tách khỏi Điểm Xanh, nội dung hiện tại', () => {
    renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    expect(screen.getByText('Ưu đãi riêng của cửa hàng')).toBeInTheDocument();
    expect(screen.getByText('Cửa hàng tự chịu, không liên quan Điểm Xanh')).toBeInTheDocument();
    expect(screen.getByText('Giảm 10% hoá đơn đầu')).toBeInTheDocument();
  });
  it('"Chỉnh sửa" chỉ với OWNER', () => {
    renderWith(<WasteDeskPerk point={makeDeskPoint({ myRole: 'STAFF' })} />);
    expect(screen.queryByRole('button', { name: 'Chỉnh sửa' })).toBeNull();
  });
  it('nội dung đang chờ duyệt → "Đang chờ Tubu duyệt"', () => {
    renderWith(<WasteDeskPerk point={makeDeskPoint({ perkPendingText: 'Tặng túi vải' })} />);
    expect(screen.getByText('Đang chờ Tubu duyệt: Tặng túi vải')).toBeInTheDocument();
  });
  it('OWNER gửi nội dung mới → PUT perk, báo chờ duyệt, làm mới desk', async () => {
    mocks.submitDeskPerk.mockResolvedValue(makeDeskPoint({ perkPendingText: 'Tặng túi vải' }));
    const { qc } = renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));
    fireEvent.change(await screen.findByLabelText('Nội dung ưu đãi'), { target: { value: '  Tặng túi vải  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    await waitFor(() => expect(mocks.submitDeskPerk).toHaveBeenCalledWith('pt-1', { perkText: 'Tặng túi vải' }));
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã gửi, chờ Tubu duyệt' }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['waste', 'desk'] });
  });
  it.each(['Tặng 10k cho khách', 'Hoàn tiền mặt 5%', 'Chuyển khoản lại tiền chai'])(
    'chữ trả/thưởng tiền mặt (%s): báo lỗi ngay, khoá nút Gửi duyệt, không gọi API',
    async (text) => {
      renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));
      fireEvent.change(await screen.findByLabelText('Nội dung ưu đãi'), { target: { value: text } });
      expect(screen.getByRole('alert').textContent).toContain('Zalo không cho phép');
      expect(screen.getByRole('alert').textContent).toContain(`Chữ "${{ 'Tặng 10k cho khách': 'Tặng 10k', 'Hoàn tiền mặt 5%': 'tiền mặt', 'Chuyển khoản lại tiền chai': 'Chuyển khoản' }[text]}"`);
      const send = screen.getByRole('button', { name: 'Gửi duyệt' });
      expect(send).toBeDisabled();
      fireEvent.click(send);
      expect(mocks.submitDeskPerk).not.toHaveBeenCalled();
    },
  );
  it('giảm giá và quà thường không bị chặn', async () => {
    renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));
    fireEvent.change(await screen.findByLabelText('Nội dung ưu đãi'), { target: { value: 'Giảm 10k đơn từ 100k, tặng túi vải' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Gửi duyệt' })).not.toBeDisabled();
  });
  it('kho Tubu → không render gì', () => {
    const { container } = renderWith(<WasteDeskPerk point={WAREHOUSE_DESK} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('chưa có ưu đãi → "Chưa có ưu đãi"', () => {
    renderWith(<WasteDeskPerk point={makeDeskPoint({ perkText: null })} />);
    expect(screen.getByText('Chưa có ưu đãi')).toBeInTheDocument();
  });
  it('gửi duyệt lỗi → snackbar câu của máy chủ', async () => {
    mocks.submitDeskPerk.mockRejectedValue(new Error('Bạn không phải chủ điểm'));
    renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));
    fireEvent.change(await screen.findByLabelText('Nội dung ưu đãi'), { target: { value: 'Tặng túi vải' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Bạn không phải chủ điểm', type: 'error' })));
  });
});

describe('WasteDeskReport (§15.3)', () => {
  it('tháng theo giờ VN, kể cả khi máy ở UTC', () => {
    expect(vnMonthKey(new Date('2026-10-31T17:30:00.000Z'))).toBe('2026-11');
    expect(vnMonthKey(new Date('2026-10-31T16:59:00.000Z'))).toBe('2026-10');
  });
  it('báo cáo tháng: số lượt, điểm, hạn mức đã dùng, số món', async () => {
    mocks.getDeskPointReport.mockResolvedValue({ pointId: 'pt-1', month: '2026-10', confirmations: 12, pointsAwarded: 120_000, quotaUsed: 120_000, units: [{ itemId: 'item-carton', itemName: 'Thùng carton', unitLabel: 'thùng', qty: 80 }] });
    renderWith(<WasteDeskReport pointId="pt-1" />);
    expect(await screen.findByText('12 lượt xác nhận')).toBeInTheDocument();
    expect(screen.getByText('Tubu đã cộng 120.000 điểm cho khách')).toBeInTheDocument();
    expect(screen.getByText('Thùng carton: 80 thùng')).toBeInTheDocument();
    expect(mocks.getDeskPointReport).toHaveBeenCalledWith('pt-1', expect.stringMatching(/^\d{4}-\d{2}$/));
  });
  it('báo cáo lỗi → "Chưa tải được báo cáo", "Thử lại" tải lại', async () => {
    mocks.getDeskPointReport.mockRejectedValueOnce(new Error('x')).mockResolvedValue({ pointId: 'pt-1', month: '2026-10', confirmations: 3, pointsAwarded: 0, quotaUsed: 0, units: [] });
    renderWith(<WasteDeskReport pointId="pt-1" />);
    expect(await screen.findByText('Chưa tải được báo cáo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('3 lượt xác nhận')).toBeInTheDocument();
  });
});

describe('WasteDeskPerk (Mini): vùng có tên và khoá "Chỉnh sửa"', () => {
  it('thẻ là vùng role="region" tên "Ưu đãi riêng của cửa hàng" bọc cả nút Chỉnh sửa; kho thì không có vùng', () => {
    const { unmount } = renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    const region = screen.getByRole('region', { name: 'Ưu đãi riêng của cửa hàng' });
    expect(region).toContainElement(screen.getByText('Giảm 10% hoá đơn đầu'));
    expect(region).toContainElement(editBtn());
    unmount();
    renderWith(<WasteDeskPerk point={WAREHOUSE_DESK} />);
    expect(screen.queryByRole('region')).toBeNull();
  });
  it('nút "Chỉnh sửa" không bị disabled (giữ focus bàn phím); bấm khi sheet đang mở không nạp lại chữ, đóng sheet rồi bấm thì mở lại', async () => {
    renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    expect(editBtn()).toBeEnabled();
    const input = await openSheet();
    expect(editBtn()).toBeEnabled();
    fireEvent.change(input, { target: { value: 'Quà đang gõ' } });
    fireEvent.click(editBtn());
    expect(screen.getByLabelText('Nội dung ưu đãi')).toHaveValue('Quà đang gõ');
    act(() => ctl.sheet!.onClose());
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect((await openSheet()).value).toBe('Giảm 10% hoá đơn đầu');
  });
  it('mở sheet nạp sẵn nội dung đang chờ duyệt, nếu không có thì nội dung hiện tại', async () => {
    const { unmount } = renderWith(<WasteDeskPerk point={makeDeskPoint({ perkPendingText: 'Tặng túi vải' })} />);
    expect((await openSheet()).value).toBe('Tặng túi vải');
    unmount();
    renderWith(<WasteDeskPerk point={makeDeskPoint({ perkText: null })} />);
    expect((await openSheet()).value).toBe('');
  });
  it('ô nhập giới hạn 200 ký tự; chưa có nội dung chờ duyệt thì không có dòng "Đang chờ Tubu duyệt"', async () => {
    renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    expect(screen.queryByText(/Đang chờ Tubu duyệt/)).toBeNull();
    expect(await openSheet()).toHaveAttribute('maxlength', '200');
  });
});

describe('WasteDeskPerk (Mini): đang gửi duyệt', () => {
  it('khoá ô nhập, nút Gửi duyệt báo bận, sheet không đóng được; xong thì đóng và báo', async () => {
    const send = deferred<unknown>();
    mocks.submitDeskPerk.mockReturnValue(send.promise);
    renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    const input = await openSheet();
    expect(input).toBeEnabled();
    expect(ctl.sheet!.dismissible).toBe(true);
    expect(sendBtn()).not.toHaveAttribute('aria-busy');
    fireEvent.change(input, { target: { value: 'Tặng túi vải' } });
    fireEvent.click(sendBtn());
    await waitFor(() => expect(sendBtn()).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByLabelText('Nội dung ưu đãi')).toBeDisabled();
    expect(ctl.sheet!.dismissible).toBe(false);
    expect(editBtn()).toBeEnabled();

    await act(async () => send.resolve(makeDeskPoint({ perkPendingText: 'Tặng túi vải' })));
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã gửi, chờ Tubu duyệt', type: 'success' }));
    expect(editBtn()).toBeEnabled();
  });
  it('handler gọi thẳng (qua mặt nút khoá) bị bỏ qua: không đóng sheet, không đổi chữ, không gửi lần hai', async () => {
    const send = deferred<unknown>();
    mocks.submitDeskPerk.mockReturnValue(send.promise);
    renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    fireEvent.change(await openSheet(), { target: { value: 'Tặng túi vải' } });
    fireEvent.click(sendBtn());
    await waitFor(() => expect(ctl.sheet!.dismissible).toBe(false));

    await act(async () => {
      ctl.sheet!.onClose();
      ctl.input!.onChange({ target: { value: 'Chữ khác' } });
      ctl.buttons.get('Gửi duyệt')!.onPress?.();
      ctl.buttons.get('Gửi duyệt')!.onPress?.();
      ctl.buttons.get('Chỉnh sửa')!.onPress?.();
    });
    expect(sheetOpen()).toBe(true);
    expect(screen.getByLabelText('Nội dung ưu đãi')).toHaveValue('Tặng túi vải');
    expect(ctl.sheet!.dismissible).toBe(false);
    expect(mocks.submitDeskPerk).toHaveBeenCalledTimes(1);

    await act(async () => send.resolve(makeDeskPoint()));
    await waitFor(() => expect(sheetOpen()).toBe(false));
  });
  it('rảnh thì onClose đóng sheet và onChange đổi chữ', async () => {
    renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    await openSheet();
    act(() => ctl.input!.onChange({ target: { value: 'Quà mới' } }));
    expect(screen.getByLabelText('Nội dung ưu đãi')).toHaveValue('Quà mới');
    act(() => ctl.sheet!.onClose());
    await waitFor(() => expect(sheetOpen()).toBe(false));
  });
  it('onPress của Gửi duyệt bị bỏ qua khi chữ rỗng hoặc có chữ trả tiền mặt; chữ hợp lệ thì gửi đúng một lần', async () => {
    mocks.submitDeskPerk.mockResolvedValue(makeDeskPoint());
    renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    const input = await openSheet();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(sendBtn()).toBeDisabled();
    await act(async () => ctl.buttons.get('Gửi duyệt')!.onPress?.());
    fireEvent.change(input, { target: { value: 'Tặng 10k cho khách' } });
    await act(async () => ctl.buttons.get('Gửi duyệt')!.onPress?.());
    expect(mocks.submitDeskPerk).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Tặng túi vải' } });
    await act(async () => ctl.buttons.get('Gửi duyệt')!.onPress?.());
    expect(mocks.submitDeskPerk).toHaveBeenCalledTimes(1);
    expect(mocks.submitDeskPerk).toHaveBeenCalledWith('pt-1', { perkText: 'Tặng túi vải' });
  });
});

describe('WasteDeskPerk (Mini): gửi lỗi', () => {
  it('lỗi báo bằng snackbar và role="alert" tông danger ngay trong sheet; sheet vẫn mở, hết bận, chữ còn nguyên', async () => {
    mocks.submitDeskPerk.mockRejectedValue(new Error('Bạn không phải chủ điểm'));
    renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(await openSheet(), { target: { value: 'Tặng túi vải' } });
    fireEvent.click(sendBtn());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Bạn không phải chủ điểm');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('Bạn không phải chủ điểm').style.color).toBe('var(--color-text-danger)');
    expect(screen.getByTestId('zaui-sheet')).toContainElement(alert);
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Bạn không phải chủ điểm', type: 'error' }));
    await waitFor(() => expect(ctl.sheet!.dismissible).toBe(true));
    expect(screen.getByLabelText('Nội dung ưu đãi')).toBeEnabled();
    expect(screen.getByLabelText('Nội dung ưu đãi')).toHaveValue('Tặng túi vải');
    expect(sendBtn()).not.toHaveAttribute('aria-busy');
  });
  it('sửa chữ sau lỗi: lời lỗi cũ biến mất', async () => {
    mocks.submitDeskPerk.mockRejectedValue(new Error('Bạn không phải chủ điểm'));
    renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    const input = await openSheet();
    fireEvent.change(input, { target: { value: 'Tặng túi vải' } });
    fireEvent.click(sendBtn());
    await screen.findByRole('alert');
    fireEvent.change(input, { target: { value: 'Tặng túi vải xanh' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('đóng sheet rồi mở lại bằng "Chỉnh sửa": lời lỗi cũ biến mất', async () => {
    mocks.submitDeskPerk.mockRejectedValue(new Error('Bạn không phải chủ điểm'));
    renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    fireEvent.change(await openSheet(), { target: { value: 'Tặng túi vải' } });
    fireEvent.click(sendBtn());
    await screen.findByRole('alert');
    act(() => ctl.sheet!.onClose());
    await waitFor(() => expect(sheetOpen()).toBe(false));
    await openSheet();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('gửi lại sau lỗi: lời lỗi cũ biến mất lúc đang gửi', async () => {
    mocks.submitDeskPerk.mockRejectedValueOnce(new Error('Bạn không phải chủ điểm'));
    renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    fireEvent.change(await openSheet(), { target: { value: 'Tặng túi vải' } });
    fireEvent.click(sendBtn());
    await screen.findByRole('alert');
    const again = deferred<unknown>();
    mocks.submitDeskPerk.mockReturnValue(again.promise);
    fireEvent.click(sendBtn());
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await act(async () => again.resolve(makeDeskPoint()));
    await waitFor(() => expect(sheetOpen()).toBe(false));
  });
  it('sau lỗi gửi, đóng rồi mở lại: lời lỗi cũ mất, chữ tiền mặt mới chỉ có một alert', async () => {
    mocks.submitDeskPerk.mockRejectedValue(new Error('Bạn không phải chủ điểm'));
    renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    const input = await openSheet();
    fireEvent.change(input, { target: { value: 'Tặng túi vải' } });
    fireEvent.click(sendBtn());
    await screen.findByRole('alert');
    act(() => ctl.sheet!.onClose());
    await waitFor(() => expect(sheetOpen()).toBe(false));
    const again = await openSheet();
    fireEvent.change(again, { target: { value: 'Tặng 10k cho khách' } });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toContain('Zalo không cho phép');
  });
});

describe('WasteDeskReport (Mini): vùng, số đều, lỗi và nút Thử lại', () => {
  it('có số liệu: vùng role="region" tên "Báo cáo tháng này"; ba dòng số dùng số đều, nhãn thì không', async () => {
    mocks.getDeskPointReport.mockResolvedValue(REPORT);
    renderWith(<WasteDeskReport pointId="pt-1" />);
    const region = await screen.findByRole('region', { name: 'Báo cáo tháng này' });
    expect(region).toContainElement(screen.getByText('12 lượt xác nhận'));
    expect(screen.getByText('12 lượt xác nhận').style.fontVariantNumeric).toBe('tabular-nums');
    expect(screen.getByText('Tubu đã cộng 120.000 điểm cho khách').style.fontVariantNumeric).toBe('tabular-nums');
    expect(screen.getByText('Thùng carton: 80 thùng').style.fontVariantNumeric).toBe('tabular-nums');
    expect(within(region).getByText('Báo cáo tháng này').style.fontVariantNumeric).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('chưa có số liệu và chưa lỗi: không vẽ gì', () => {
    mocks.getDeskPointReport.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWith(<WasteDeskReport pointId="pt-1" />);
    expect(container).toBeEmptyDOMElement();
  });
  it('báo cáo lỗi: vùng cùng tên, lời báo là role="alert", nút Thử lại dùng được', async () => {
    mocks.getDeskPointReport.mockRejectedValue(new Error('x'));
    renderWith(<WasteDeskReport pointId="pt-1" />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Chưa tải được báo cáo');
    expect(screen.getByRole('region', { name: 'Báo cáo tháng này' })).toContainElement(alert);
    expect(screen.getByRole('button', { name: 'Thử lại' })).not.toHaveAttribute('aria-busy');
  });
  it('lỗi lần đầu rồi bấm Thử lại: thẻ lỗi vẫn còn, nút báo bận, bấm thêm hay gọi thẳng onPress không tải lần hai; xong thì ra số liệu', async () => {
    mocks.getDeskPointReport.mockRejectedValueOnce(new Error('x'));
    renderWith(<WasteDeskReport pointId="pt-1" />);
    await screen.findByRole('alert');
    const slow = deferred<typeof REPORT>();
    mocks.getDeskPointReport.mockReturnValue(slow.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Thử lại' })).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Báo cáo tháng này' })).toBeInTheDocument();
    expect(mocks.getDeskPointReport).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await act(async () => {
      ctl.buttons.get('Thử lại')!.onPress?.();
    });
    expect(mocks.getDeskPointReport).toHaveBeenCalledTimes(2);

    await act(async () => slow.resolve(REPORT));
    expect(await screen.findByText('12 lượt xác nhận')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('đã có số liệu mà tải lại lỗi: Thử lại báo bận khi đang tải, bấm thêm hay gọi thẳng onPress không tải lần hai', async () => {
    mocks.getDeskPointReport.mockResolvedValueOnce(REPORT);
    const { qc } = renderWith(<WasteDeskReport pointId="pt-1" />);
    await screen.findByText('12 lượt xác nhận');
    mocks.getDeskPointReport.mockRejectedValueOnce(new Error('x'));
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['waste', 'desk'] });
    });
    await screen.findByRole('alert');
    expect(mocks.getDeskPointReport).toHaveBeenCalledTimes(2);

    const slow = deferred<typeof REPORT>();
    mocks.getDeskPointReport.mockReturnValue(slow.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Thử lại' })).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(mocks.getDeskPointReport).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await act(async () => {
      ctl.buttons.get('Thử lại')!.onPress?.();
      ctl.buttons.get('Thử lại')!.onPress?.();
    });
    expect(mocks.getDeskPointReport).toHaveBeenCalledTimes(3);

    await act(async () => slow.resolve({ ...REPORT, confirmations: 15 }));
    expect(await screen.findByText('15 lượt xác nhận')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
