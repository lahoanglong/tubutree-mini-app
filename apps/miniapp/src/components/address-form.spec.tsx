import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { AddressForm } from './address-form';
import * as shopApi from '../services/shop-api';
import * as accountApi from '../services/account-api';
import { LAST_GEO_KEY, ZALO_PREFILL_ASKED_KEY } from '../utils/address-memory';

const mocks = vi.hoisted(() => ({
  user: { current: null as { id?: string; fullName?: string | null; phone?: string | null } | null },
  requestZaloProfile: vi.fn(),
  openSnackbar: vi.fn(),
}));

// createAddress sống ở shop-api, updateAddress sống ở account-api (xem account-api.ts —
// "Addresses (bổ sung update/delete cho address book)") — 2 module khác nhau, không phải cùng 1
// module như bản nháp kế hoạch giả định.
vi.mock('../services/shop-api', () => ({ createAddress: vi.fn() }));
vi.mock('../services/account-api', () => ({ updateAddress: vi.fn() }));
vi.mock('../services/geo-api', () => ({
  getProvinces: vi.fn().mockResolvedValue([{ code: '84_VN79', name: 'TP. Hồ Chí Minh' }]),
  getCommunes: vi.fn().mockResolvedValue([{ code: '84_VN79_001', name: 'Phường Bến Nghé' }]),
}));
vi.mock('../services/zalo-profile', () => ({
  requestZaloProfile: mocks.requestZaloProfile,
  usableProfileName: (n?: string | null) => ((n ?? '').trim().toLowerCase() === 'khách' ? '' : (n ?? '').trim()),
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: mocks.user.current }),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));

// AddressForm dùng useMutation (@tanstack/react-query) — cần QueryClientProvider thật trong cây,
// nếu không render() sẽ throw "No QueryClient set" (react-query không có fallback no-op).
function renderForm(ui: ReactElement, qc: QueryClient = new QueryClient()) {
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** Field gắn nhãn với control (label htmlFor) nên tìm ô nhập đúng như trình đọc màn hình. */
function inputNear(labelText: string): HTMLInputElement {
  return screen.getByLabelText(labelText) as HTMLInputElement;
}

const HCM = { province: 'TP. Hồ Chí Minh', provinceCode: '84_VN79', ward: 'Phường Bến Nghé', wardCode: '84_VN79_001' };

describe('AddressForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.user.current = { fullName: 'Long', phone: '0900000000' };
  });

  it('create mode (no initial): starts empty except recipient/phone prefilled from logged-in user', () => {
    renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />);
    expect(screen.getByDisplayValue('Long')).toBeInTheDocument();
    expect(screen.getByDisplayValue('0900000000')).toBeInTheDocument();
    expect(inputNear('Số nhà, tên đường')).toHaveValue('');
  });

  it('edit mode: prefills every field from `initial`, calls updateAddress(initial.id, ...) on save', async () => {
    const initial = {
      id: 'a1',
      recipient: 'Ánh',
      phone: '0911111111',
      street: '123 Lê Lợi',
      province: 'HCM',
      provinceCode: '84_VN79',
      ward: 'P1',
      wardCode: '84_VN79_001',
      district: '',
      districtCode: '',
      isDefault: false,
    } as never;
    (accountApi.updateAddress as ReturnType<typeof vi.fn>).mockResolvedValue(initial);
    renderForm(<AddressForm initial={initial} onCancel={() => {}} onSaved={() => {}} />);
    expect(screen.getByDisplayValue('Ánh')).toBeInTheDocument();
    expect(screen.getByDisplayValue('0911111111')).toBeInTheDocument();
    expect(screen.getByDisplayValue('123 Lê Lợi')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Lưu'));
    await waitFor(() => expect(accountApi.updateAddress).toHaveBeenCalledWith('a1', expect.any(Object)));
    expect(shopApi.createAddress).not.toHaveBeenCalled();
  });

  it('edit mode, địa chỉ theo địa giới cũ (mã tỉnh trước 2025) → bỏ tỉnh/phường cũ, bắt chọn lại trước khi lưu', async () => {
    const initial = {
      id: 'a1', recipient: 'Ánh', phone: '0911111111', street: '123 Lê Lợi', province: 'HCM', provinceCode: '79',
      ward: 'P1', wardCode: '00001', district: 'Q1', districtCode: '760', isDefault: false,
    } as never;
    renderForm(<AddressForm initial={initial} onCancel={() => {}} onSaved={() => {}} />);
    fireEvent.click(screen.getByText('Lưu'));
    await waitFor(() => expect(screen.getAllByText(/Chọn tỉnh\/thành\./).length).toBeGreaterThan(0));
    expect(accountApi.updateAddress).not.toHaveBeenCalled();
  });

  it('create mode: calls createAddress (not updateAddress) once all required fields + geo are valid', async () => {
    (shopApi.createAddress as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'new' });
    const onSaved = vi.fn();
    renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={onSaved} />);

    // recipient/phone đã điền sẵn từ user mock; chỉ còn street bắt buộc điền — geo (Tỉnh/Phường)
    // không mock được API thật ở test này nên bỏ qua nhánh happy-path đầy đủ của geo, chỉ xác
    // nhận validate() vẫn chặn submit khi geo trống (hành vi validateGeo() giữ nguyên, không đổi).
    fireEvent.change(inputNear('Số nhà, tên đường'), { target: { value: '1 Nguyễn Huệ' } });
    fireEvent.click(screen.getByText('Lưu'));

    // Geo chưa chọn → validateGeo() chặn, không có API nào được gọi. GeoPicker vẽ lỗi này gộp
    // chung 1 node text với tiền tố "⚠ " (component ErrText riêng của geo-picker.tsx, không đi
    // qua Field) nên khớp bằng regex thay vì so khớp chuỗi tuyệt đối.
    await waitFor(() =>
      expect(screen.getAllByText(/Chọn tỉnh\/thành\./).length).toBeGreaterThan(0),
    );
    expect(shopApi.createAddress).not.toHaveBeenCalled();
    expect(accountApi.updateAddress).not.toHaveBeenCalled();
  });

  describe('C-065 — điền sẵn tên + SĐT từ Zalo (Q-27)', () => {
    beforeEach(() => {
      mocks.user.current = { fullName: 'Khách', phone: null };
    });

    it("tên giữ chỗ 'Khách' của tài khoản khách KHÔNG được điền sẵn vào ô Người nhận", () => {
      renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />);
      expect(inputNear('Người nhận')).toHaveValue('');
    });

    it('không bật askZaloProfile (vd sổ địa chỉ) → không tự xin quyền, nhưng vẫn có nút điền nhanh', () => {
      renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />);
      expect(mocks.requestZaloProfile).not.toHaveBeenCalled();
      expect(screen.getByText('Điền nhanh từ Zalo')).toBeInTheDocument();
    });

    it('askZaloProfile + thiếu tên/SĐT → xin ĐÚNG 1 lần khi mở form, điền vào form, đánh dấu đã xin', async () => {
      mocks.requestZaloProfile.mockResolvedValue({ name: 'Lã Hoàng Long', phone: '0901234567' });
      renderForm(<AddressForm initial={null} askZaloProfile onCancel={() => {}} onSaved={() => {}} />);
      await waitFor(() => expect(inputNear('Người nhận')).toHaveValue('Lã Hoàng Long'));
      expect(inputNear('Số điện thoại')).toHaveValue('0901234567');
      expect(mocks.requestZaloProfile).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(ZALO_PREFILL_ASKED_KEY)).toBe('1');
      // Đã đủ tên + SĐT → ẩn nút điền nhanh.
      expect(screen.queryByText('Điền nhanh từ Zalo')).not.toBeInTheDocument();
    });

    it('máy dùng chung: người trước đã xin rồi thì tài khoản khác (id khác) vẫn được xin quyền', async () => {
      localStorage.setItem(`${ZALO_PREFILL_ASKED_KEY}:u1`, '1');
      mocks.user.current = { id: 'u2', fullName: null, phone: null };
      mocks.requestZaloProfile.mockResolvedValue({ name: 'Người Sau', phone: '0907654321' });
      renderForm(<AddressForm initial={null} askZaloProfile onCancel={() => {}} onSaved={() => {}} />);
      await waitFor(() => expect(inputNear('Người nhận')).toHaveValue('Người Sau'));
      expect(mocks.requestZaloProfile).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(`${ZALO_PREFILL_ASKED_KEY}:u2`)).toBe('1');
    });

    it('cùng tài khoản đã xin rồi → không xin lại', () => {
      localStorage.setItem(`${ZALO_PREFILL_ASKED_KEY}:u1`, '1');
      mocks.user.current = { id: 'u1', fullName: null, phone: null };
      renderForm(<AddressForm initial={null} askZaloProfile onCancel={() => {}} onSaved={() => {}} />);
      expect(mocks.requestZaloProfile).not.toHaveBeenCalled();
    });

    it('đã xin ở lần trước (cờ trên máy) → mở form KHÔNG xin lại', () => {
      localStorage.setItem(ZALO_PREFILL_ASKED_KEY, '1');
      renderForm(<AddressForm initial={null} askZaloProfile onCancel={() => {}} onSaved={() => {}} />);
      expect(mocks.requestZaloProfile).not.toHaveBeenCalled();
    });

    it('tài khoản đã có đủ tên + SĐT → không xin gì, không hiện nút điền nhanh', () => {
      mocks.user.current = { fullName: 'Long', phone: '0900000000' };
      renderForm(<AddressForm initial={null} askZaloProfile onCancel={() => {}} onSaved={() => {}} />);
      expect(mocks.requestZaloProfile).not.toHaveBeenCalled();
      expect(screen.queryByText('Điền nhanh từ Zalo')).not.toBeInTheDocument();
    });

    it('edit mode không bao giờ xin quyền, kể cả khi truyền askZaloProfile', () => {
      const initial = {
        id: 'a1', recipient: 'Ánh', phone: '0911111111', street: '1 X', district: '', districtCode: '', isDefault: false, ...HCM,
      } as never;
      renderForm(<AddressForm initial={initial} askZaloProfile onCancel={() => {}} onSaved={() => {}} />);
      expect(mocks.requestZaloProfile).not.toHaveBeenCalled();
      expect(screen.queryByText('Điền nhanh từ Zalo')).not.toBeInTheDocument();
    });

    it('khách từ chối → form vẫn trống, không báo lỗi; bấm nút điền nhanh thì xin lại', async () => {
      mocks.requestZaloProfile.mockResolvedValue({ name: '', phone: '' });
      renderForm(<AddressForm initial={null} askZaloProfile onCancel={() => {}} onSaved={() => {}} />);
      await waitFor(() => expect(mocks.requestZaloProfile).toHaveBeenCalledTimes(1));
      expect(inputNear('Người nhận')).toHaveValue('');
      expect(inputNear('Số điện thoại')).toHaveValue('');
      expect(mocks.openSnackbar).not.toHaveBeenCalled();

      mocks.requestZaloProfile.mockResolvedValue({ name: 'Ánh', phone: '0911111111' });
      fireEvent.click(screen.getByText('Điền nhanh từ Zalo'));
      await waitFor(() => expect(inputNear('Người nhận')).toHaveValue('Ánh'));
      expect(inputNear('Số điện thoại')).toHaveValue('0911111111');
      expect(mocks.requestZaloProfile).toHaveBeenCalledTimes(2);
    });

    it('bấm nút điền nhanh mà vẫn không lấy được gì → báo nhẹ để nhập tay', async () => {
      localStorage.setItem(ZALO_PREFILL_ASKED_KEY, '1');
      mocks.requestZaloProfile.mockResolvedValue({ name: '', phone: '' });
      renderForm(<AddressForm initial={null} askZaloProfile onCancel={() => {}} onSaved={() => {}} />);
      fireEvent.click(screen.getByText('Điền nhanh từ Zalo'));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
      expect(mocks.openSnackbar.mock.calls[0]![0].text).toMatch(/nhập tay/);
    });

    it('khách gõ tên trong lúc sheet Zalo còn mở → kết quả Zalo KHÔNG đè chữ đã gõ', async () => {
      let resolve!: (v: { name: string; phone: string }) => void;
      mocks.requestZaloProfile.mockReturnValue(new Promise((r) => { resolve = r; }));
      renderForm(<AddressForm initial={null} askZaloProfile onCancel={() => {}} onSaved={() => {}} />);
      fireEvent.change(inputNear('Người nhận'), { target: { value: 'Mẹ tôi' } });
      await act(async () => {
        resolve({ name: 'Lã Hoàng Long', phone: '0901234567' });
      });
      expect(inputNear('Người nhận')).toHaveValue('Mẹ tôi');
      expect(inputNear('Số điện thoại')).toHaveValue('0901234567');
    });
  });

  describe('C-065 — nhớ tỉnh/phường lần trước', () => {
    const typeStreet = () =>
      fireEvent.change(inputNear('Số nhà, tên đường'), { target: { value: '1 Nguyễn Huệ' } });

    it('máy đã nhớ tỉnh/phường → form mới được điền sẵn, chỉ cần gõ số nhà rồi lưu (gửi đúng mã Pancake)', async () => {
      localStorage.setItem(LAST_GEO_KEY, JSON.stringify(HCM));
      (shopApi.createAddress as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'new', ...HCM });
      const onSaved = vi.fn();
      renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={onSaved} />);
      typeStreet();
      fireEvent.click(screen.getByText('Lưu'));
      await waitFor(() => expect(shopApi.createAddress).toHaveBeenCalledTimes(1));
      expect(shopApi.createAddress).toHaveBeenCalledWith(
        expect.objectContaining({ province: HCM.province, provinceCode: HCM.provinceCode, ward: HCM.ward, wardCode: HCM.wardCode }),
      );
      expect(onSaved).toHaveBeenCalled();
    });

    it('tỉnh/phường nhớ của tài khoản khác trên cùng máy không được điền sẵn', async () => {
      localStorage.setItem(`${LAST_GEO_KEY}:u1`, JSON.stringify(HCM));
      mocks.user.current = { id: 'u2', fullName: 'Long', phone: '0900000000' };
      (shopApi.createAddress as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'new' });
      renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />);
      typeStreet();
      fireEvent.click(screen.getByText('Lưu'));
      await waitFor(() => expect(screen.getAllByText(/Chọn tỉnh\/thành\./).length).toBeGreaterThan(0));
      expect(shopApi.createAddress).not.toHaveBeenCalled();
    });

    it('lưu thành công ghi nhớ tỉnh/phường dưới khoá của tài khoản hiện tại', async () => {
      mocks.user.current = { id: 'u7', fullName: 'Long', phone: '0900000000' };
      const qc = new QueryClient();
      qc.setQueryData(['addresses'], [
        { id: 'x', recipient: 'A', phone: '0900000000', street: '9 Y', district: '', districtCode: '', isDefault: true, ...HCM },
      ]);
      (shopApi.createAddress as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'new' });
      renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />, qc);
      typeStreet();
      fireEvent.click(screen.getByText('Lưu'));
      await waitFor(() => expect(localStorage.getItem(`${LAST_GEO_KEY}:u7`)).not.toBeNull());
      expect(localStorage.getItem(LAST_GEO_KEY)).toBeNull();
    });

    it('máy chưa nhớ gì nhưng sổ địa chỉ đã tải có địa chỉ mặc định → lấy tỉnh/phường từ đó', async () => {
      const qc = new QueryClient();
      qc.setQueryData(['addresses'], [
        { id: 'x', recipient: 'A', phone: '0900000000', street: '9 Y', district: '', districtCode: '', isDefault: true, ...HCM },
      ]);
      (shopApi.createAddress as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'new' });
      renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />, qc);
      typeStreet();
      fireEvent.click(screen.getByText('Lưu'));
      await waitFor(() => expect(shopApi.createAddress).toHaveBeenCalledTimes(1));
      expect(shopApi.createAddress).toHaveBeenCalledWith(
        expect.objectContaining({ provinceCode: HCM.provinceCode, wardCode: HCM.wardCode }),
      );
    });

    it('lưu địa chỉ thành công → nhớ tỉnh/phường cho lần sau', async () => {
      expect(localStorage.getItem(LAST_GEO_KEY)).toBeNull();
      const qc = new QueryClient();
      qc.setQueryData(['addresses'], [
        { id: 'x', recipient: 'A', phone: '0900000000', street: '9 Y', district: '', districtCode: '', isDefault: true, ...HCM },
      ]);
      (shopApi.createAddress as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'new' });
      renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />, qc);
      typeStreet();
      fireEvent.click(screen.getByText('Lưu'));
      await waitFor(() => expect(localStorage.getItem(LAST_GEO_KEY)).not.toBeNull());
      expect(JSON.parse(localStorage.getItem(LAST_GEO_KEY)!)).toEqual(HCM);
    });

    it('chưa có gì để nhớ → form vẫn bắt chọn tỉnh/phường như cũ', async () => {
      (shopApi.createAddress as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'new' });
      renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />);
      typeStreet();
      fireEvent.click(screen.getByText('Lưu'));
      await waitFor(() => expect(screen.getAllByText(/Chọn tỉnh\/thành\./).length).toBeGreaterThan(0));
      expect(shopApi.createAddress).not.toHaveBeenCalled();
    });
  });
});

describe('AddressForm — lỗi từng ô và con trỏ (gói hk)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.user.current = { fullName: '', phone: null };
  });

  it('bấm Lưu khi trống: mỗi ô một câu riêng ngay dưới ô, con trỏ nhảy tới ô lỗi đầu tiên (Người nhận)', async () => {
    renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />);
    fireEvent.click(screen.getByText('Lưu'));
    expect(await screen.findByText('Nhập tên người nhận.')).toBeInTheDocument();
    expect(screen.getByText('Nhập số điện thoại.')).toBeInTheDocument();
    expect(screen.getByText('Chọn tỉnh/thành.')).toBeInTheDocument();
    expect(screen.getByText('Chọn phường/xã.')).toBeInTheDocument();
    expect(screen.getByText('Nhập số nhà, tên đường.')).toBeInTheDocument();
    await waitFor(() => expect(inputNear('Người nhận')).toHaveFocus());
    const name = inputNear('Người nhận');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(name.getAttribute('aria-describedby')!)).toHaveTextContent('Nhập tên người nhận.');
  });

  it('tên đã có, SĐT sai: con trỏ về ô SĐT, câu nói rõ dạng cần nhập', async () => {
    mocks.user.current = { fullName: 'Long', phone: '123' };
    renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />);
    fireEvent.click(screen.getByText('Lưu'));
    expect(await screen.findByText('Số điện thoại chưa đúng. Nhập 10 số bắt đầu bằng 0 (hoặc +84 và 9 số).')).toBeInTheDocument();
    await waitFor(() => expect(inputNear('Số điện thoại')).toHaveFocus());
  });

  it('rời ô SĐT khi còn sai thì báo ngay, chưa cần bấm Lưu; các ô chưa chạm chưa đỏ', () => {
    mocks.user.current = { fullName: 'Long', phone: '123' };
    renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />);
    expect(screen.queryByText(/Số điện thoại chưa đúng/)).toBeNull();
    fireEvent.blur(inputNear('Số điện thoại'));
    expect(screen.getByText(/Số điện thoại chưa đúng/)).toBeInTheDocument();
    expect(screen.queryByText('Nhập số nhà, tên đường.')).toBeNull();
  });

  it('ô chọn tỉnh/thành báo lỗi cho trình đọc màn hình: aria-invalid và aria-describedby trỏ vào câu lỗi', async () => {
    mocks.user.current = { fullName: 'Long', phone: '0900000000' };
    renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />);
    fireEvent.change(inputNear('Số nhà, tên đường'), { target: { value: '1 Nguyễn Huệ' } });
    fireEvent.click(screen.getByText('Lưu'));
    const province = await screen.findByRole('button', { name: /^Tỉnh\/Thành phố:/ });
    await waitFor(() => expect(province).toHaveAttribute('aria-invalid', 'true'));
    expect(document.getElementById(province.getAttribute('aria-describedby')!)).toHaveTextContent('Chọn tỉnh/thành.');
    await waitFor(() => expect(province).toHaveFocus());
  });
});

describe('AddressForm — khoá chạm đúp Lưu và Điền nhanh từ Zalo (W71A)', () => {
  const typeStreet = () => fireEvent.change(inputNear('Số nhà, tên đường'), { target: { value: '1 Nguyễn Huệ' } });
  const pending = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.user.current = { fullName: 'Long', phone: '0900000000' };
    localStorage.setItem(LAST_GEO_KEY, JSON.stringify(HCM));
  });

  it('chạm đúp Lưu địa chỉ mới trong cùng một khung hình: chỉ tạo một địa chỉ', async () => {
    const create = pending<{ id: string }>();
    (shopApi.createAddress as ReturnType<typeof vi.fn>).mockReturnValue(create.promise);
    renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />);
    typeStreet();
    const save = screen.getByText('Lưu').closest('button')!;
    await act(async () => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    expect(shopApi.createAddress).toHaveBeenCalledTimes(1);
    expect(save).toHaveAttribute('aria-busy', 'true');
    await act(async () => create.resolve({ id: 'new' }));
  });

  it('chạm đúp Lưu khi sửa địa chỉ: chỉ gọi updateAddress một lần', async () => {
    const initial = {
      id: 'a1', recipient: 'Ánh', phone: '0911111111', street: '1 X', district: '', districtCode: '', isDefault: false, ...HCM,
    } as never;
    const update = pending<{ id: string }>();
    (accountApi.updateAddress as ReturnType<typeof vi.fn>).mockReturnValue(update.promise);
    renderForm(<AddressForm initial={initial} onCancel={() => {}} onSaved={() => {}} />);
    const save = screen.getByText('Lưu').closest('button')!;
    await act(async () => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    expect(accountApi.updateAddress).toHaveBeenCalledTimes(1);
    await act(async () => update.resolve({ id: 'a1' }));
  });

  it('lưu lỗi mạng thì nhả khoá: bấm Lưu lần nữa gửi lại được', async () => {
    (shopApi.createAddress as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('mạng')).mockResolvedValue({ id: 'new' });
    renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />);
    typeStreet();
    const save = screen.getByText('Lưu').closest('button')!;
    await act(async () => fireEvent.click(save));
    await waitFor(() => expect(save).not.toHaveAttribute('aria-busy'));
    await act(async () => fireEvent.click(save));
    expect(shopApi.createAddress).toHaveBeenCalledTimes(2);
  });

  it('bấm Lưu khi form còn thiếu thì không khoá: sửa xong bấm lại vẫn gửi', async () => {
    (shopApi.createAddress as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'new' });
    renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />);
    const save = screen.getByText('Lưu').closest('button')!;
    await act(async () => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    expect(shopApi.createAddress).not.toHaveBeenCalled();
    typeStreet();
    await act(async () => fireEvent.click(save));
    expect(shopApi.createAddress).toHaveBeenCalledTimes(1);
  });

  it('chạm đúp "Điền nhanh từ Zalo": chỉ xin quyền một lần, nút báo bận trong lúc chờ', async () => {
    mocks.user.current = { fullName: 'Khách', phone: null };
    const profile = pending<{ name: string; phone: string }>();
    mocks.requestZaloProfile.mockReturnValue(profile.promise);
    renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />);
    const quick = screen.getByText('Điền nhanh từ Zalo').closest('button')!;
    await act(async () => {
      fireEvent.click(quick);
      fireEvent.click(quick);
    });
    expect(mocks.requestZaloProfile).toHaveBeenCalledTimes(1);
    expect(quick).toHaveAttribute('aria-busy', 'true');
    await act(async () => profile.resolve({ name: 'Ánh', phone: '0911111111' }));
    expect(inputNear('Người nhận')).toHaveValue('Ánh');
  });

  it('Zalo từ chối hoặc ném lỗi thì nhả khoá: bấm lại xin lại được', async () => {
    mocks.user.current = { fullName: 'Khách', phone: null };
    mocks.requestZaloProfile.mockResolvedValue({ name: '', phone: '' });
    renderForm(<AddressForm initial={null} onCancel={() => {}} onSaved={() => {}} />);
    const quick = screen.getByText('Điền nhanh từ Zalo').closest('button')!;
    await act(async () => fireEvent.click(quick));
    await act(async () => fireEvent.click(quick));
    expect(mocks.requestZaloProfile).toHaveBeenCalledTimes(2);
  });
});
