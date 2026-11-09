import { act, render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WALLET_FORFEIT_AGREE, WALLET_FORFEIT_LOADING, WALLET_FORFEIT_UNKNOWN, walletForfeitNotice } from '../utils/account-deletion-copy';
import { formatVnd } from '../utils/format';
import type { ButtonProps } from './ui/button';
import type { CheckboxProps } from './ui/form';

const mocks = vi.hoisted(() => ({
  openSnackbar: vi.fn(),
  getWallet: vi.fn(),
  requestAccountDeletion: vi.fn(),
  hasOA: false,
  openOAChat: vi.fn(),
}));
// Bọc Button/Checkbox để đọc props mới nhất: nút `disabled`/`loading` đã chặn mọi lượt bấm thật,
// nên chỉ gọi thẳng onPress/onChange mới chứng minh được guard trong AccountDeletionSection.
const ctl = vi.hoisted(() => ({ buttons: new Map<string, ButtonProps>(), checkbox: null as CheckboxProps | null }));
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
vi.mock('./ui/form', async (importOriginal) => {
  const orig = await importOriginal<{ Checkbox: ComponentType<CheckboxProps> }>();
  return {
    ...orig,
    Checkbox: (p: CheckboxProps) => {
      ctl.checkbox = p;
      return <orig.Checkbox {...p} />;
    },
  };
});
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: (opt: unknown) => mocks.openSnackbar(opt), closeSnackbar: vi.fn() }),
}));
vi.mock('../services/account-api', () => ({ requestAccountDeletion: mocks.requestAccountDeletion, getWallet: mocks.getWallet }));
vi.mock('../services/zmp-bridge', () => ({
  get hasOA() {
    return mocks.hasOA;
  },
  openOAChat: mocks.openOAChat,
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getErrorMessage: () => 'lỗi gửi',
}));

import { AccountDeletionSection } from './account-deletion-section';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = rtlRender(
    <QueryClientProvider client={qc}>
      <AccountDeletionSection />
    </QueryClientProvider>,
  );
  return { ...view, qc };
};
const openCard = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Xoá tài khoản' }));
  await screen.findByText('Xoá tài khoản vĩnh viễn?');
};
const region = () => screen.getByRole('region', { name: 'Xác nhận xoá tài khoản' });
const submitBtn = () => screen.getByRole('button', { name: /Gửi yêu cầu xoá/ });
const cancelBtn = () => screen.getByRole('button', { name: 'Huỷ' });
const agreeName = new RegExp(WALLET_FORFEIT_AGREE.slice(0, 20));
const agreeBox = () => screen.getByRole('checkbox', { name: agreeName });
const findAgreeBox = () => screen.findByRole('checkbox', { name: agreeName });
const FORFEIT = 50000;
const consent = { acknowledgedWalletBalance: FORFEIT, acceptWalletForfeit: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasOA = false;
  mocks.getWallet.mockReset().mockResolvedValue({ walletBalance: 0 });
  mocks.requestAccountDeletion.mockReset().mockResolvedValue({ message: 'Đã ghi nhận yêu cầu' });
});

describe('AccountDeletionSection (Mini): khung xác nhận', () => {
  it('chưa mở: chỉ có dòng "Xoá tài khoản", không có vùng xác nhận và chưa hỏi số dư', async () => {
    mount();
    expect(await screen.findByRole('button', { name: 'Xoá tài khoản' })).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
    expect(mocks.getWallet).not.toHaveBeenCalled();
  });

  it('mở thẻ: vùng role="region" tên "Xác nhận xoá tài khoản"; tải số dư thì aria-busy + chữ đang kiểm tra nằm trong role="status"; xong thì hết cả hai', async () => {
    const wallet = deferred<{ walletBalance: number }>();
    mocks.getWallet.mockReturnValue(wallet.promise);
    mount();
    await openCard();
    expect(region()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(WALLET_FORFEIT_LOADING);
    expect(submitBtn()).toBeDisabled();
    await act(async () => wallet.resolve({ walletBalance: 0 }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.queryByText(WALLET_FORFEIT_LOADING)).toBeNull();
    expect(region()).not.toHaveAttribute('aria-busy');
    expect(submitBtn()).toBeEnabled();
  });

  it('tải số dư lỗi: role="alert" báo không biết số dư, hết chữ đang kiểm tra, vùng không còn bận, nút gửi khoá', async () => {
    mocks.getWallet.mockRejectedValue(new Error('mạng'));
    mount();
    await openCard();
    expect(await screen.findByRole('alert')).toHaveTextContent(WALLET_FORFEIT_UNKNOWN);
    expect(screen.queryByRole('status')).toBeNull();
    expect(region()).not.toHaveAttribute('aria-busy');
    expect(submitBtn()).toBeDisabled();
  });

  it('Ví còn tiền: thông báo mất số dư dùng số đều, ô đồng ý mở khoá nút gửi', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: FORFEIT });
    mount();
    await openCard();
    const notice = await screen.findByText(walletForfeitNotice(formatVnd(FORFEIT)));
    expect(notice.style.fontVariantNumeric).toBe('tabular-nums');
    expect(notice.style.fontWeight).toBe('700');
    expect(submitBtn()).toBeDisabled();
    fireEvent.click(await findAgreeBox());
    expect(agreeBox()).toBeChecked();
    expect(submitBtn()).toBeEnabled();
    fireEvent.click(agreeBox());
    expect(agreeBox()).not.toBeChecked();
    expect(submitBtn()).toBeDisabled();
  });

  it('Ví trống: không có thông báo mất số dư, gửi được ngay và không kèm đồng ý', async () => {
    mount();
    await openCard();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1));
    expect(mocks.requestAccountDeletion).toHaveBeenCalledWith(undefined, undefined);
  });
});

describe('AccountDeletionSection (Mini): đang gửi yêu cầu', () => {
  it('khoá Huỷ + ô đồng ý, vùng và nút gửi báo bận; bấm Huỷ không đóng thẻ; xong thì đóng và báo', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: FORFEIT });
    const send = deferred<{ message: string }>();
    mocks.requestAccountDeletion.mockReturnValue(send.promise);
    mount();
    await openCard();
    fireEvent.click(await findAgreeBox());
    fireEvent.click(submitBtn());
    await waitFor(() => expect(region()).toHaveAttribute('aria-busy', 'true'));
    expect(mocks.requestAccountDeletion).toHaveBeenCalledWith(undefined, consent);
    expect(cancelBtn()).toBeDisabled();
    expect(agreeBox()).toBeDisabled();
    expect(agreeBox()).toBeChecked();
    expect(submitBtn()).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(cancelBtn());
    fireEvent.click(submitBtn());
    expect(region()).toBeInTheDocument();
    expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1);

    await act(async () => send.resolve({ message: 'Đã ghi nhận yêu cầu' }));
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã ghi nhận yêu cầu', type: 'info' });
  });

  it('đang gửi: handler gọi thẳng (qua mặt nút khoá) bị bỏ qua, không đóng thẻ, không đổi tick, không gửi lần hai', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: FORFEIT });
    const send = deferred<{ message: string }>();
    mocks.requestAccountDeletion.mockReturnValue(send.promise);
    mount();
    await openCard();
    fireEvent.click(await findAgreeBox());
    fireEvent.click(submitBtn());
    await waitFor(() => expect(region()).toHaveAttribute('aria-busy', 'true'));

    // mutate() chạy mutationFn sau vài microtask: phải đợi act bất đồng bộ thì lượt gửi thừa mới lộ ra.
    await act(async () => {
      ctl.buttons.get('Huỷ')!.onPress?.();
      ctl.buttons.get('Gửi yêu cầu xoá')!.onPress?.();
      ctl.buttons.get('Gửi yêu cầu xoá')!.onPress?.();
      ctl.checkbox!.onChange?.(undefined as never);
    });
    expect(region()).toBeInTheDocument();
    expect(agreeBox()).toBeChecked();
    expect(region()).toHaveAttribute('aria-busy', 'true');
    expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1);

    await act(async () => send.resolve({ message: 'Đã ghi nhận yêu cầu' }));
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
  });

  it('rảnh thì Huỷ và ô đồng ý dùng được, vùng không báo bận', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: FORFEIT });
    mount();
    await openCard();
    fireEvent.click(await findAgreeBox());
    expect(cancelBtn()).toBeEnabled();
    expect(agreeBox()).toBeEnabled();
    expect(region()).not.toHaveAttribute('aria-busy');
    expect(submitBtn()).not.toHaveAttribute('aria-busy');
  });

  it('gửi xong rồi mở lại: ô đồng ý của lần trước không còn tick, nút gửi khoá', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: FORFEIT });
    mount();
    await openCard();
    fireEvent.click(await findAgreeBox());
    fireEvent.click(submitBtn());
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
    await openCard();
    expect(await findAgreeBox()).not.toBeChecked();
    expect(submitBtn()).toBeDisabled();
  });

  it('gửi xong với Zalo OA: mở sẵn cuộc trò chuyện; không có OA thì không mở', async () => {
    mocks.hasOA = true;
    const first = mount();
    await openCard();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.openOAChat).toHaveBeenCalledWith('Tôi muốn xoá tài khoản Tubu Tree'));
    first.unmount();

    mocks.openOAChat.mockClear();
    mocks.hasOA = false;
    mount();
    await openCard();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    fireEvent.click(submitBtn());
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
    expect(mocks.openOAChat).not.toHaveBeenCalled();
  });
});

describe('AccountDeletionSection (Mini): gửi lỗi, Huỷ và mở lại', () => {
  it('gửi lỗi: báo bằng snackbar và role="alert" ngay trong thẻ (tông danger), bỏ tick, tải lại số dư; thẻ vẫn mở', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: FORFEIT });
    mocks.requestAccountDeletion.mockRejectedValueOnce(new Error('x'));
    mount();
    await openCard();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(await findAgreeBox());
    fireEvent.click(submitBtn());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('lỗi gửi');
    expect(screen.getByText('lỗi gửi').style.color).toBe('var(--color-text-danger)');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'lỗi gửi', type: 'error' });
    expect(region()).toBeInTheDocument();
    expect(region()).not.toHaveAttribute('aria-busy');
    await waitFor(() => expect(mocks.getWallet).toHaveBeenCalledTimes(2));
    expect(await findAgreeBox()).not.toBeChecked();
    expect(submitBtn()).toBeDisabled();
  });

  it('gửi lỗi rồi tick lại lúc ví chưa tải xong: ví ra số dư khác thì tick cũ hết hiệu lực, nút gửi khoá, không gửi kèm số mới', async () => {
    const refetch = deferred<{ walletBalance: number }>();
    mocks.getWallet.mockReset().mockResolvedValueOnce({ walletBalance: FORFEIT }).mockReturnValueOnce(refetch.promise);
    mocks.requestAccountDeletion.mockRejectedValueOnce(new Error('x'));
    mount();
    await openCard();
    fireEvent.click(await findAgreeBox());
    fireEvent.click(submitBtn());
    await screen.findByRole('alert');
    await waitFor(() => expect(mocks.getWallet).toHaveBeenCalledTimes(2));
    fireEvent.click(agreeBox());
    expect(agreeBox()).toBeChecked();
    await act(async () => refetch.resolve({ walletBalance: 80000 }));
    await screen.findByText(walletForfeitNotice(formatVnd(80000)));
    expect(agreeBox()).not.toBeChecked();
    expect(submitBtn()).toBeDisabled();
    expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1);
  });

  it('đã tick rồi ví tự tải lại ra số khác: tick hết hiệu lực; tick lại theo số mới thì gửi kèm đúng số mới', async () => {
    mocks.getWallet.mockReset().mockResolvedValueOnce({ walletBalance: FORFEIT }).mockResolvedValue({ walletBalance: 80000 });
    const { qc } = mount();
    await openCard();
    fireEvent.click(await findAgreeBox());
    expect(submitBtn()).toBeEnabled();
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['wallet'] });
    });
    await screen.findByText(walletForfeitNotice(formatVnd(80000)));
    expect(agreeBox()).not.toBeChecked();
    expect(submitBtn()).toBeDisabled();
    fireEvent.click(agreeBox());
    expect(submitBtn()).toBeEnabled();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1));
    expect(mocks.requestAccountDeletion).toHaveBeenCalledWith(undefined, { acknowledgedWalletBalance: 80000, acceptWalletForfeit: true });
  });

  it('Huỷ sau lỗi: thẻ đóng; mở lại thì lời lỗi cũ và ô đồng ý đều sạch', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: FORFEIT });
    mocks.requestAccountDeletion.mockRejectedValueOnce(new Error('x'));
    mount();
    await openCard();
    fireEvent.click(await findAgreeBox());
    fireEvent.click(submitBtn());
    await screen.findByRole('alert');
    fireEvent.click(cancelBtn());
    expect(screen.queryByRole('region')).toBeNull();
    await openCard();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(await findAgreeBox()).not.toBeChecked();
  });

  it('Huỷ khi đã tick: mở lại thì chưa tick', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: FORFEIT });
    mount();
    await openCard();
    fireEvent.click(await findAgreeBox());
    expect(agreeBox()).toBeChecked();
    fireEvent.click(cancelBtn());
    expect(screen.queryByRole('region')).toBeNull();
    await openCard();
    expect(await findAgreeBox()).not.toBeChecked();
    expect(mocks.requestAccountDeletion).not.toHaveBeenCalled();
  });

  it('gửi lại sau lỗi: lời lỗi cũ biến mất lúc đang gửi và thẻ đóng khi thành công', async () => {
    mocks.requestAccountDeletion.mockRejectedValueOnce(new Error('x'));
    mount();
    await openCard();
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    fireEvent.click(submitBtn());
    await screen.findByRole('alert');
    const again = deferred<{ message: string }>();
    mocks.requestAccountDeletion.mockReturnValue(again.promise);
    fireEvent.click(submitBtn());
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await act(async () => again.resolve({ message: 'Đã ghi nhận yêu cầu' }));
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
  });
});
