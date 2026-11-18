import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus } from 'lucide-react';
import { compactAddressView, readRecentAddressIds, sortAddressesForPicker } from '@tubutree/app-core/commerce/checkout-display';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { AddressDTO } from '../../services/shop-api';
import { trackEvent } from '../../services/analytics';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { addressLine } from '../../utils/format';
import { isLegacyGeo } from '../../utils/address-memory';
import { browserStorage } from '../../utils/recently-viewed';
import { AddressForm } from '../address-form';
import { Badge } from '../ui/badge';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { SR_ONLY } from '../ui/sr-only';
import { Text } from '../ui/text';

interface AddressSectionProps {
  addresses: AddressDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Khách vừa lưu một địa chỉ (thêm mới hoặc sửa) và địa chỉ đó được chọn cho đơn. */
  onSaved?: () => void;
  /** Máy chủ từ chối báo giá cho địa chỉ đang chọn với mã ADDRESS_OUTDATED (vd phường không thuộc tỉnh) dù mã đã theo địa giới mới. */
  quoteOutdated?: boolean;
  /** Sổ địa chỉ đã tải xong và trống: mở sẵn form một lần, khỏi bắt khách tìm nút "Thêm địa chỉ". Đang tải thì false, kẻo mở nhầm khi sổ có địa chỉ. */
  autoOpen?: boolean;
  /** Tài khoản đang đặt: thứ tự "dùng gần nhất" trong tấm chọn lưu riêng từng tài khoản trên máy. */
  userId?: string | null;
}

/**
 * Địa chỉ giao ở màn thanh toán: một dòng (tên, SĐT che bớt, địa chỉ cắt một dòng, "Đổi"). Chạm dòng mở tấm chọn địa chỉ đã lưu
 * (mặc định đầu, rồi dùng gần nhất); chạm một địa chỉ là chọn và đóng: đổi sang địa chỉ khác mất 2 chạm, danh sách không đẩy nút Đặt hàng xuống.
 */
export function AddressSection({ addresses, selectedId, onSelect, onSaved, quoteOutdated = false, autoOpen = false, userId }: AddressSectionProps) {
  // 'auto': form tự mở vì sổ trống. Lúc đó KHÔNG tự xin tên/SĐT Zalo: tấm xin quyền của Zalo không được bật lên khi khách chưa chạm gì;
  // khách vẫn lấy nhanh được bằng nút "Điền nhanh từ Zalo" trong form.
  const [adding, setAdding] = useState<false | 'auto' | 'tap'>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const queryClient = useQueryClient();
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpen || autoOpened.current) return;
    autoOpened.current = true;
    setAdding('auto');
  }, [autoOpen]);
  const editing = addresses.find((a) => a.id === editingId) ?? null;
  const selected = addresses.find((a) => a.id === selectedId) ?? null;
  // Đưa địa chỉ vừa lưu vào danh sách trước khi chọn: danh sách tải lại về sau, mà trang thanh toán thấy id đang chọn không có trong danh sách
  // thì chọn lại địa chỉ mặc định, đơn đi về địa chỉ cũ.
  const keepSaved = (a: AddressDTO) => {
    queryClient.setQueryData<AddressDTO[]>(['addresses'], (old = []) =>
      old.some((x) => x.id === a.id) ? old.map((x) => (x.id === a.id ? a : x)) : [...old, a],
    );
    void queryClient.invalidateQueries({ queryKey: ['addresses'] });
    onSelect(a.id);
    onSaved?.();
  };
  const pick = (id: string) => {
    haptic('light');
    setPicking(false);
    if (id === selectedId) return;
    setEditingId(null);
    trackEvent('checkout_address_switched', 'miniapp', { from: 'sheet' });
    onSelect(id);
  };
  const openAdd = () => {
    haptic('light');
    setPicking(false);
    setEditingId(null);
    setAdding('tap');
  };
  const legacy = selected ? isLegacyGeo(selected) : false;
  const view = selected ? compactAddressView(selected) : null;

  return (
    <div style={{ padding: 16, marginTop: 8, background: 'var(--color-bg-surface)' }}>
      <Text variant="body-sm" as="div" data-ds="checkout-block-title" style={{ fontWeight: 600, marginBottom: 8 }}>
        {vi.checkout.address}
      </Text>

      {addresses.length === 0 && !adding && (
        <Text variant="body-sm" tone="tertiary" as="div">
          {vi.checkout.addressEmpty}
        </Text>
      )}

      {selected && view && (
        <div data-testid="checkout-address-row">
          <button
            type="button"
            data-ds="checkout-address-card"
            className="tubu-press"
            aria-haspopup="dialog"
            onClick={() => {
              haptic('light');
              setPicking(true);
            }}
            style={{
              // Giữ chữ ẩn (SR_ONLY, tuyệt đối) trong nút: không thì nó bám vào body và thoát khung cuộn của trang.
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-inline-md)',
              width: '100%',
              // Hai dòng chữ (20 + 16) cộng khoảng cách và đệm dọc: vùng chạm ≥ 44px mà không cần số viết tay.
              padding: 'var(--space-stack-xs) 0',
              borderRadius: 'var(--radius-control)',
              boxSizing: 'border-box',
              border: 'none',
              background: 'transparent',
              font: 'inherit',
              color: 'inherit',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <Text variant="body-sm" as="span" style={{ display: 'block', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {view.title}
              </Text>
              <Text variant="caption" tone="secondary" as="span" style={{ display: 'block', marginTop: 'var(--space-inline-xs)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {view.line}
              </Text>
            </span>
            <span aria-hidden style={{ flexShrink: 0 }}>
              <Text variant="body-sm" as="span" style={{ fontWeight: 600, color: 'var(--color-text-brand)' }}>
                {fillCopy('checkout.addressChange')}
              </Text>
            </span>
            <span style={SR_ONLY}>{fillCopy('checkout.addressChangeAria')}</span>
          </button>
          {(legacy || quoteOutdated) && editing === null && (
            <GeoFixNotice
              text={legacy ? vi.checkout.addressLegacy : vi.checkout.addressMismatch}
              cta={legacy ? vi.checkout.addressLegacyCta : vi.checkout.addressFixCta}
              onFix={() => {
                haptic('light');
                setAdding(false);
                setEditingId(selected.id);
              }}
            />
          )}
        </div>
      )}

      {editing && (
        <div style={{ marginTop: 8 }}>
          <AddressForm
            initial={editing}
            onCancel={() => setEditingId(null)}
            onSaved={(a) => {
              void queryClient.invalidateQueries({ queryKey: ['quote'] });
              keepSaved(a);
              setEditingId(null);
            }}
          />
        </div>
      )}

      {adding ? (
        <div style={{ marginTop: 8 }}>
          <AddressForm
            initial={null}
            askZaloProfile={adding === 'tap' && addresses.length === 0}
            onCancel={() => setAdding(false)}
            onSaved={(a) => {
              keepSaved(a);
              setAdding(false);
            }}
          />
        </div>
      ) : (
        addresses.length === 0 && <AddAddressButton onClick={openAdd} />
      )}

      <BottomSheet open={picking} onClose={() => setPicking(false)} title={fillCopy('checkout.addressSheetTitle')}>
        <div role="radiogroup" aria-label={fillCopy('checkout.addressSheetTitle')}>
          {picking &&
            sortAddressesForPicker(addresses, readRecentAddressIds(browserStorage(), userId)).map((a) => (
              <AddressCard key={a.id} address={a} active={selectedId === a.id} onClick={() => pick(a.id)} />
            ))}
        </div>
        <AddAddressButton onClick={openAdd} />
      </BottomSheet>
    </div>
  );
}

function AddAddressButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="tubu-press"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        marginTop: 8,
        padding: '12px 0',
        minHeight: 44,
        boxSizing: 'border-box',
        border: 'none',
        background: 'none',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          border: '1.5px dashed var(--color-action-primary-bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon icon={Plus} size="sm" tone="brand" />
      </span>
      <Text variant="body-sm" style={{ fontWeight: 600, color: 'var(--color-text-brand)' }}>
        {fillCopy('checkout.addressAddNew')}
      </Text>
    </button>
  );
}

/** Cảnh báo nằm trong chính thẻ địa chỉ đang chọn để khách biết địa chỉ nào cần chọn lại tỉnh/phường. */
function GeoFixNotice({ text, cta, onFix }: { text: string; cta: string; onFix: () => void }) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        margin: '0 12px 12px',
        borderRadius: 'var(--radius-control)',
        background: 'var(--color-status-warning-bg)',
      }}
    >
      <span style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <AlertTriangle size={16} color="var(--color-status-warning-fg)" aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
        <Text variant="body-sm" as="span" style={{ color: 'var(--color-status-warning-fg)' }}>
          {text}
        </Text>
      </span>
      <Button variant="secondary" onPress={onFix}>
        {cta}
      </Button>
    </div>
  );
}

function AddressCard({
  address,
  active,
  onClick,
}: {
  address: AddressDTO;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      data-ds="checkout-address-card"
      style={{
        marginBottom: 8,
        border: `1.5px solid ${active ? 'var(--color-border-selected)' : 'var(--color-border-subtle)'}`,
        background: active ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-control)',
      }}
    >
      <button
        type="button"
        role="radio"
        aria-checked={active}
        className="tubu-press"
        onClick={() => {
          haptic('light');
          onClick();
        }}
        style={{
          display: 'block',
          width: '100%',
          padding: 12,
          minHeight: 44,
          boxSizing: 'border-box',
          border: 'none',
          background: 'transparent',
          borderRadius: 'var(--radius-control)',
          font: 'inherit',
          color: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Text variant="body-sm" style={{ fontWeight: 600 }}>
            {address.recipient} · {address.phone}
          </Text>
          {address.isDefault && <Badge tone="brand">{vi.checkout.addressDefault}</Badge>}
        </span>
        <Text variant="caption" tone="secondary" as="span" style={{ display: 'block', marginTop: 2 }}>
          {addressLine(address)}
        </Text>
      </button>
    </div>
  );
}
