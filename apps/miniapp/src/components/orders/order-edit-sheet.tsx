import { useState, type ChangeEvent, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'zmp-ui';
import type { EditOrderDeliveryBody, ShippingAddressSnapshot } from '@tubutree/shared-types';
import { editOrderDelivery } from '@tubutree/app-core/api/order-edit';
import {
  ORDER_EDIT_COPY as COPY,
  orderEditAddressEditable,
  orderEditBody,
  orderEditFormOf,
  orderEditProvinceLine,
  orderEditSaved,
  orderEditSplitNote,
  orderEditsLeftText,
  type OrderEditForm,
} from '@tubutree/app-core/order-edit-copy';
import { normalizeVnPhoneInput } from '@tubutree/app-core/phone-input';
import { coreHttp } from '../../services/core-http';
import { getErrorCode, getErrorMessage } from '../../services/api';
import { haptic } from '../../utils/haptic';
import { useLockedMutation } from '../game/use-locked-mutation';
import { GeoPicker } from '../geo-picker';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Text } from '../ui/text';

const NOTE_MAX = 500;
const STACK: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-sm)' };

/**
 * Tấm "Sửa địa chỉ và ghi chú" của chi tiết đơn (chunk tải lười, cùng web `tai-khoan/don-hang/[code]/order-edit-sheet.tsx`): người nhận, SĐT,
 * phường/xã, số nhà trong tỉnh của đơn và ghi chú. Chỉ gửi phần khách đổi (`orderEditBody`). Lưu xong hay máy chủ từ chối vì đơn đã đổi (đã đóng
 * gói, hết lượt, kho đã nhận) thì báo, tải lại đơn và đóng tấm; lỗi nhập (SĐT sai, phường không khớp) ở lại trong tấm.
 */
export default function OrderEditSheet({
  code,
  address,
  note,
  split,
  onClose,
}: {
  code: string;
  address: ShippingAddressSnapshot;
  note: string | null;
  split: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [form, setForm] = useState<OrderEditForm>(() => orderEditFormOf(address, note));
  const [error, setError] = useState<string | null>(null);
  const editable = orderEditAddressEditable(address);
  const set = (k: keyof OrderEditForm) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['order', code] }), qc.invalidateQueries({ queryKey: ['orders'] })]);

  const save = useLockedMutation({
    mutationFn: (body: EditOrderDeliveryBody) => editOrderDelivery(coreHttp, code, body),
    onSuccess: (res) => {
      haptic('success');
      openSnackbar({ text: `${orderEditSaved(code)}. ${orderEditsLeftText(res.editsLeft)}`, type: 'success', position: 'top' });
      onClose();
      return refresh();
    },
    onError: (err: unknown) => {
      if (getErrorCode(err) !== 'ORDER_EDIT_REFUSED') {
        setError(getErrorMessage(err));
        return;
      }
      openSnackbar({ text: getErrorMessage(err), type: 'error', position: 'top' });
      onClose();
      return refresh();
    },
  });

  const submit = () => {
    const body = orderEditBody(address, note, { ...form, phone: normalizeVnPhoneInput(form.phone) });
    if (body === null || body === 'REQUIRED') {
      setError(body === null ? COPY.noChange : COPY.required);
      return;
    }
    setError(null);
    save.mutate(body);
  };

  return (
    <BottomSheet
      open
      onClose={onClose}
      dismissible={!save.isPending}
      title={COPY.title}
      footer={
        <Button fullWidth loading={save.isPending} onPress={submit}>
          {COPY.save}
        </Button>
      }
    >
      <div data-testid="order-edit-sheet" style={STACK}>
        {split && (
          <Text variant="body-sm" tone="secondary" as="p">
            {orderEditSplitNote(code)}
          </Text>
        )}
        {editable ? (
          <>
            <div>
              <Text variant="body-sm" as="p" style={{ fontWeight: 600 }}>
                {orderEditProvinceLine(address.province)}
              </Text>
              <Text variant="caption" tone="secondary" as="p">
                {COPY.provinceHint}
              </Text>
            </div>
            <Input label={COPY.recipientLabel} value={form.recipient} onChange={set('recipient')} maxLength={120} autoComplete="name" aria-required="true" />
            <Input
              label={COPY.phoneLabel}
              value={form.phone}
              onChange={set('phone')}
              maxLength={20}
              autoComplete="tel"
              inputMode="tel"
              inputClassName="tubu-nums"
              aria-required="true"
            />
            <GeoPicker
              provinceLocked
              value={{ province: address.province, provinceCode: address.provinceCode, ward: form.ward, wardCode: form.wardCode }}
              onChange={(g) => setForm((f) => ({ ...f, ward: g.ward, wardCode: g.wardCode }))}
            />
            <Input label={COPY.streetLabel} value={form.street} onChange={set('street')} maxLength={255} autoComplete="street-address" aria-required="true" />
          </>
        ) : (
          <Text variant="body-sm" tone="secondary" as="p">
            {COPY.noteOnly}
          </Text>
        )}
        <Input.TextArea label={COPY.noteLabel} value={form.note} onChange={set('note')} maxLength={NOTE_MAX} placeholder={COPY.notePlaceholder} />
        {error && (
          <p role="alert" data-testid="order-edit-error" style={{ margin: 0 }}>
            <Text variant="body-sm" tone="danger">
              {error}
            </Text>
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
