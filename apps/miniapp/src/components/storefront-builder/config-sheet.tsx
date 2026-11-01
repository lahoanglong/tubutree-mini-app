import { useState } from 'react';
import { Input, useSnackbar } from 'zmp-ui';
import { useMutation } from '@tanstack/react-query';
import { EyeOff } from 'lucide-react';
import { updateStorefront, type StorefrontEdit } from '../../services/storefront-api';
import { getErrorMessage } from '../../services/api';
import { haptic } from '../../utils/haptic';
import { vi } from '../../i18n/vi';
import { DEFAULT_STOREFRONT_THEME_COLOR, STOREFRONT_THEME_COLORS } from '../../utils/storefront-theme';
import { Button } from '../ui/button';
import { Field } from '../ui/form';
import { Heading, Text } from '../ui/text';
import { isPartnerStore } from '../../utils/partner-store';
import { SCROLL_BODY } from './shared';

/** Ô chọn màu: hình tròn 32px nhưng vùng chạm 44px, là nút thật có trạng thái chọn. */
function ThemeSwatch({ code, label, selected, onPress }: { code: string; label: string; selected: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      className="tubu-press"
      onClick={onPress}
      style={{ minWidth: 44, minHeight: 44, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          backgroundColor: code,
          border: selected ? '3px solid var(--color-text-primary)' : '2px solid var(--color-bg-surface)',
          boxShadow: 'var(--elevation-1)',
        }}
      />
    </button>
  );
}

export function MerchantConfigSheet({
  sf,
  onClose,
  onSaved,
  unpublishLabel,
  onUnpublish,
}: {
  sf: StorefrontEdit;
  onClose: () => void;
  onSaved: () => void;
  /** Có chữ thì gian hàng đang đăng/chờ duyệt: hiện nút gỡ đăng ở cuối cài đặt. */
  unpublishLabel: string | null;
  onUnpublish: () => void;
}) {
  const { openSnackbar } = useSnackbar();
  const [form, setForm] = useState({
    title: sf.title ?? '',
    subdomain: sf.subdomain ?? '',
    themeColor: sf.themeColor ?? DEFAULT_STOREFRONT_THEME_COLOR,
    warehouseAddress: sf.warehouseAddress ?? '',
    warehouseCity: sf.warehouseCity ?? '',
    warehousePhone: sf.warehousePhone ?? '',
  });

  // Kho/hotline chỉ có nghĩa với gian hàng tự giao (D4); chuỗi rỗng = xoá (BE đổi '' thành null).
  const selfFulfils = isPartnerStore(sf);
  // Chỉ gửi subdomain khi người dùng đã đổi: API kiểm từ khoá và trùng tên mỗi khi nhận subdomain.
  const typedSubdomain = form.subdomain.trim().toLowerCase();
  const subdomainChanged = typedSubdomain !== '' && typedSubdomain !== (sf.subdomain ?? '');
  const saveMut = useMutation({
    mutationFn: () =>
      updateStorefront({
        title: form.title.trim() || undefined,
        subdomain: sf.subdomainEnabled && subdomainChanged ? form.subdomain.trim().toLowerCase() : undefined,
        themeColor: form.themeColor,
        ...(selfFulfils && {
          warehouseAddress: form.warehouseAddress.trim(),
          warehouseCity: form.warehouseCity.trim(),
          warehousePhone: form.warehousePhone.trim(),
        }),
      }),
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: 'Đã lưu cấu hình gian hàng!', type: 'success' });
      onSaved();
      onClose();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  // Tài khoản ngân hàng nhập trước đây không được dùng để thu tiền (khách luôn trả cho Tubu Tree) — chỉ cho gỡ đi.
  const clearBankMut = useMutation({
    mutationFn: () => updateStorefront({ bankName: '', bankBin: '', bankAccountNo: '', bankAccountName: '' }),
    onSuccess: () => {
      openSnackbar({ text: 'Đã gỡ tài khoản ngân hàng khỏi gian hàng', type: 'success' });
      onSaved();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <div style={SCROLL_BODY}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Tên gian hàng">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>

        {sf.subdomainEnabled && (
          <div>
            <Field label="Subdomain riêng">
              <Input
                placeholder="vd: brand1"
                value={form.subdomain}
                onChange={(e) => setForm({ ...form, subdomain: e.target.value })}
              />
            </Field>
            <Text variant="label" tone="tertiary" as="div" style={{ marginTop: 2 }}>
              URL: {form.subdomain ? `${form.subdomain}.tubutree.com` : 'ten-ban.tubutree.com'}
            </Text>
          </div>
        )}

        <div>
          <Text variant="caption" tone="secondary" as="div" style={{ marginBottom: 2 }}>Màu sắc thương hiệu</Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {STOREFRONT_THEME_COLORS.map((c) => (
              <ThemeSwatch
                key={c.code}
                code={c.code}
                label={c.label}
                selected={form.themeColor === c.code}
                onPress={() => setForm({ ...form, themeColor: c.code })}
              />
            ))}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 12 }}>
          <Heading variant="title-sm" as="h3" style={{ marginBottom: 4 }}>Thanh toán</Heading>
          <Text variant="caption" tone="secondary" as="p" style={{ margin: 0 }}>
            Khách luôn thanh toán cho Tubu Tree.{' '}
            {selfFulfils
              ? 'Tiền hàng của bạn được đối soát và chuyển theo kỳ trên cổng người bán.'
              : 'Hoa hồng của bạn chuyển vào Ví Tubu ngay trong mục Cộng tác viên.'}
          </Text>
          {sf.bankAccountNo && (
            <div style={{ marginTop: 8 }}>
              <Text variant="caption" tone="secondary" as="p" style={{ margin: '0 0 6px' }}>
                Gian hàng đang lưu tài khoản {sf.bankName ?? 'ngân hàng'} ****{sf.bankAccountNo.slice(-4)} nhưng tài khoản này
                không được dùng để thu tiền.
              </Text>
              <Button
                variant="secondary"
                loading={clearBankMut.isPending}
                onPress={() => clearBankMut.mutate()}
              >
                Gỡ tài khoản đã lưu
              </Button>
            </div>
          )}
        </div>

        {selfFulfils && (
          <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 12 }}>
            <Heading variant="title-sm" as="h3" style={{ marginBottom: 4 }}>Kho gửi hàng & hotline</Heading>
            <Text variant="caption" tone="secondary" as="p" style={{ margin: '0 0 8px' }}>
              Dùng cho đơn gian hàng tự giao: khách thấy hotline này trong chi tiết đơn để liên hệ.
            </Text>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Input
                aria-label="Địa chỉ kho xuất hàng"
                placeholder="Địa chỉ kho xuất hàng"
                value={form.warehouseAddress}
                onChange={(e) => setForm({ ...form, warehouseAddress: e.target.value })}
              />
              <Input
                aria-label="Tỉnh / Thành phố"
                placeholder="Tỉnh / Thành phố"
                value={form.warehouseCity}
                onChange={(e) => setForm({ ...form, warehouseCity: e.target.value })}
              />
              <Input
                aria-label="Hotline kho liên hệ"
                placeholder="Hotline kho liên hệ"
                value={form.warehousePhone}
                onChange={(e) => setForm({ ...form, warehousePhone: e.target.value })}
              />
            </div>
          </div>
        )}

        <Button fullWidth style={{ marginTop: 12 }} loading={saveMut.isPending} onPress={() => saveMut.mutate()}>
          Lưu cấu hình gian hàng
        </Button>

        {unpublishLabel && (
          <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 12 }}>
            <Text variant="caption" tone="secondary" as="p" style={{ margin: '0 0 8px' }}>{vi.storefront.unpublishHint}</Text>
            <Button fullWidth variant="secondary" icon={EyeOff} onPress={onUnpublish}>
              {unpublishLabel}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
