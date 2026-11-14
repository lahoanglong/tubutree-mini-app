import { ADDRESS_INPUT_LIMIT } from '../utils/input-limits';
import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackbar, Input } from 'zmp-ui';
import { UserRound } from 'lucide-react';
import { createAddress, type AddressDTO } from '../services/shop-api';
import { updateAddress } from '../services/account-api';
import { getErrorMessage, isStaleStateError } from '../services/api';
import { isHttpError } from '../services/http';
import { requestZaloProfile } from '../services/zalo-profile';
import { usableProfileName } from '@tubutree/app-core/profile-name';
import { normalizeVnPhoneInput, parseVnPhoneInput } from '@tubutree/app-core/phone-input';
import { validateAddressFields, type AddressField } from '@tubutree/app-core/commerce/checkout-form';
import { useAuthStore } from '../store/auth';
import { vi } from '../i18n/vi';
import { haptic } from '../utils/haptic';
import { settleWithin } from '../utils/settle-within';
import {
  hasAskedZaloPrefill,
  markZaloPrefillAsked,
  isLegacyGeo,
  pickLastGeo,
  recallLastGeo,
  rememberLastGeo,
} from '../utils/address-memory';
import { GeoPicker, EMPTY_GEO, type GeoValue } from './geo-picker';
import { Field } from './ui/form';
import { Button } from './ui/button';
import { useLockedMutation } from './game/use-locked-mutation';

// Tỉnh/phường chọn qua GeoPicker (mã Pancake thật); chỉ 3 field text còn lại.
type FormFields = 'recipient' | 'phone' | 'street';
type FormState = Record<FormFields, string>;
const EMPTY_FORM: FormState = { recipient: '', phone: '', street: '' };
const FIELD_LABEL: Record<FormFields, string> = {
  recipient: vi.checkout.recipient,
  phone: vi.checkout.phone,
  street: vi.checkout.street,
};

export interface AddressFormProps {
  initial?: AddressDTO | null;
  /** Địa chỉ đầu tiên của đơn đầu: tự xin tên + SĐT Zalo 1 lần khi mở form (Q-27). Chỉ có tác dụng ở chế độ tạo mới. */
  askZaloProfile?: boolean;
  onCancel: () => void;
  onSaved: (a: AddressDTO) => void;
}

/**
 * Form địa chỉ dùng chung cho cả checkout (tạo mới, hiển thị inline) và sổ địa chỉ (tạo/sửa,
 * hiển thị trong sheet) — trước đây 2 bản gần như trùng byte-for-byte ở
 * checkout/address-section.tsx và pages/addresses.tsx (audit A4-19). `initial` quyết định
 * create/edit; phần header + sheet bao ngoài vẫn do trang gọi tự vẽ, form này CHỈ vẽ các field.
 */
export function AddressForm({ initial, askZaloProfile = false, onCancel, onSaved }: AddressFormProps) {
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [form, setForm] = useState<FormState>(
    initial
      ? { recipient: initial.recipient, phone: initial.phone, street: initial.street }
      : // Địa chỉ mới: điền sẵn tên + SĐT lấy từ tài khoản Zalo (spec §6.1) để bớt thao tác.
        { ...EMPTY_FORM, recipient: usableProfileName(user?.fullName), phone: user?.phone ?? '' },
  );
  // Prefill địa giới chỉ khi mã hợp lệ (địa chỉ cũ '00' / mã tỉnh trước 2025 → buộc chọn lại để có mã Pancake thật).
  // Địa chỉ mới: điền sẵn tỉnh/phường của lần lưu trước (Q-27), dự phòng từ sổ địa chỉ đã tải.
  const [geo, setGeo] = useState<GeoValue>(() =>
    initial
      ? !isLegacyGeo(initial)
        ? {
            province: initial.province,
            provinceCode: initial.provinceCode,
            ward: initial.ward,
            wardCode: initial.wardCode,
          }
        : EMPTY_GEO
      : (recallLastGeo(undefined, user?.id) ?? pickLastGeo(queryClient.getQueryData<AddressDTO[]>(['addresses'])) ?? EMPTY_GEO),
  );
  const [touched, setTouched] = useState<Partial<Record<FormFields, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [askingZalo, setAskingZalo] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Cùng luật, cùng câu với form địa chỉ của web: ô chữ báo khi rời ô hoặc khi bấm Lưu; tỉnh/phường báo khi bấm Lưu.
  const all = validateAddressFields(form, geo);
  const shown = (f: AddressField) => (submitted || touched[f as FormFields] ? all[f] : undefined);

  // Chỉ điền vào ô còn trống: khách có thể đã gõ trong lúc sheet quyền của Zalo còn mở.
  const fillFromZalo = async (announceMiss: boolean) => {
    setAskingZalo(true);
    try {
      const p = await requestZaloProfile();
      setForm((f) => ({
        ...f,
        recipient: f.recipient.trim() ? f.recipient : p.name,
        phone: f.phone.trim() ? f.phone : p.phone,
      }));
      if (announceMiss && !p.name && !p.phone) {
        openSnackbar({ text: 'Chưa lấy được thông tin từ Zalo, bạn nhập tay giúp Tubu nhé.', type: 'info' });
      }
    } finally {
      setAskingZalo(false);
    }
  };

  // Xin quyền tên + SĐT Zalo đúng 1 lần ở địa chỉ đầu tiên (Q-27): từ chối thì để khách nhập tay,
  // không hỏi lại mỗi lần mở form — muốn thử lại thì có nút "Điền nhanh từ Zalo".
  useEffect(() => {
    if (initial || !askZaloProfile) return;
    if (form.recipient.trim() && form.phone.trim()) return;
    if (hasAskedZaloPrefill(undefined, user?.id)) return;
    markZaloPrefillAsked(undefined, user?.id);
    void fillFromZalo(false);
  }, []);

  const save = useLockedMutation({
    mutationFn: () => {
      const payload = {
        recipient: form.recipient.trim(),
        phone: normalizeVnPhoneInput(form.phone),
        street: form.street.trim(),
        province: geo.province,
        ward: geo.ward,
        district: '', // hệ 2 cấp (Pancake) — không còn quận/huyện
        provinceCode: geo.provinceCode,
        wardCode: geo.wardCode,
        districtCode: '',
      };
      return initial ? updateAddress(initial.id, payload) : createAddress(payload);
    },
    onSuccess: (a) => {
      haptic('medium');
      rememberLastGeo(geo, undefined, user?.id);
      openSnackbar({ text: initial ? 'Đã cập nhật địa chỉ.' : 'Đã thêm địa chỉ.', type: 'success' });
      onSaved(a);
    },
    // Máy chủ từ chối vì sổ không còn khớp (đủ số địa chỉ ở máy khác, địa chỉ đang sửa đã bị xoá): tải lại sổ rồi mới nhả khoá, kẻo khách bấm
    // Lưu lại trên số liệu cũ và nhận đúng lỗi đó. Mất mạng, quá hạn, 401, 5xx không nói gì về sổ thật: nhả ngay để thử lại.
    onError: (e: unknown) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      if (!isStaleStateError(e)) return undefined;
      // Sửa mà 404: địa chỉ không còn nữa, form này không lưu được nữa nên gỡ thẻ khỏi sổ và đóng form ngay. Không đợi sổ mới về: trong lúc chờ
      // khách có thể đã mở form của thẻ khác, và `onCancel` muộn sẽ đóng nhầm form đó.
      const gone = initial != null && isHttpError(e) && e.response?.status === 404;
      if (gone) {
        queryClient.setQueryData<AddressDTO[]>(['addresses'], (list) => list?.filter((x) => x.id !== initial.id));
        onCancel();
      }
      return settleWithin(queryClient.invalidateQueries({ queryKey: ['addresses'] }));
    },
  });

  const setField = (k: FormFields) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Chuẩn hoá SĐT khi rời ô và khi dán cả số, không phải từng phím: sửa chữ đang gõ giữa chừng sẽ làm con trỏ nhảy.
  const blurField = (k: FormFields) => () => {
    setTouched((t) => (t[k] ? t : { ...t, [k]: true }));
    if (k !== 'phone') return;
    setForm((f) => {
      const phone = parseVnPhoneInput(f.phone) ?? f.phone;
      return phone === f.phone ? f : { ...f, phone };
    });
  };
  const pastePhone = (e: ClipboardEvent<HTMLInputElement>) => {
    // Chỉ khi khách bôi chọn MỘT PHẦN ô thì để trình duyệt chèn vào đúng đoạn chọn (không xoá phần còn lại); ô trống, bôi hết, hay con trỏ không bôi gì thì chữ dán là cả số mới nên thay cả ô.
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd && !(el.selectionStart === 0 && el.selectionEnd === el.value.length)) return;
    const phone = parseVnPhoneInput(e.clipboardData.getData('text'));
    if (phone === null) return;
    e.preventDefault();
    setForm((f) => ({ ...f, phone }));
  };
  const submit = () => {
    setSubmitted(true);
    if (Object.keys(all).length > 0) {
      setFocusTick((n) => n + 1);
      return;
    }
    save.mutate();
  };
  // Ô lỗi đầu tiên theo thứ tự trên màn hình nhận con trỏ (và được cuộn vào giữa màn): khách không phải tự dò ô đỏ giữa form dài.
  useEffect(() => {
    if (focusTick === 0) return;
    const el = rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    el?.focus();
    el?.scrollIntoView?.({ block: 'center' });
  }, [focusTick]);
  const renderField = (k: FormFields) => (
    <Field label={FIELD_LABEL[k]} error={shown(k)}>
      <Input
        value={form[k]}
        maxLength={ADDRESS_INPUT_LIMIT[k]}
        onChange={setField(k)}
        onBlur={blurField(k)}
        inputMode={k === 'phone' ? 'numeric' : undefined}
        autoComplete={k === 'phone' ? 'tel' : undefined}
        inputClassName={k === 'phone' ? 'tubu-nums' : undefined}
        onPaste={k === 'phone' ? pastePhone : undefined}
        status={shown(k) ? 'error' : undefined}
      />
    </Field>
  );

  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!initial && (!form.recipient.trim() || !form.phone.trim()) && (
        <Button variant="secondary" icon={UserRound} loading={askingZalo} onPress={() => fillFromZalo(true)}>
          Điền nhanh từ Zalo
        </Button>
      )}
      {renderField('recipient')}
      {renderField('phone')}
      <GeoPicker
        value={geo}
        onChange={setGeo}
        errorProvince={shown('province')}
        errorWard={shown('ward')}
      />
      {renderField('street')}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <Button variant="secondary" onPress={onCancel}>
          {vi.common.cancel}
        </Button>
        {/* Chỉ cần loading — không cần disabled song song: Button (Task 10) đã tự chặn double-tap
        NGAY BÊN TRONG khi loading=true (xem handlePress trong ui/button.tsx), độc lập với
        disabled, nên spinner vẫn hiện bình thường (loading && !disabled) MÀ vẫn chặn được bấm 2
        lần trong lúc save đang bay. button-guard.spec.ts đã được cập nhật để không đòi disabled=
        cho Button import từ ./ui/button nữa (guard giờ nằm trong component). */}
        <Button loading={save.isPending} onPress={submit} fullWidth>
          {vi.common.save}
        </Button>
      </div>
    </div>
  );
}
