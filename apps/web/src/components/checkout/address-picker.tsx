'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Plus } from 'lucide-react';
import { compactAddressView, readRecentAddressIds, sortAddressesForPicker } from '@tubutree/app-core/commerce/checkout-display';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { AddressForm } from '@/components/address-form';
import { Badge } from '@/components/mini/badge';
import { BottomSheet } from '@/components/mini/bottom-sheet';
import { addressToForm, isLegacyGeo } from '@/lib/address-form';
import { trackWebEvent } from '@/lib/analytics';
import { browserStorage } from '@/lib/recently-viewed';
import { ui } from '@/lib/guest-ui';
import { createAddress, updateAddress, type AddressDTO } from '@/lib/shop-client';

const LEGACY_TEXT = 'Địa chỉ này theo địa giới cũ (trước khi sắp xếp tỉnh/phường năm 2025) nên chưa giao được. Bạn cập nhật lại tỉnh/thành và phường/xã giúp Tubu nhé.';
const MISMATCH_TEXT = 'Tỉnh/thành hoặc phường/xã của địa chỉ này chưa đúng nên Tubu chưa giao được. Bạn chọn lại tỉnh/thành và phường/xã giúp Tubu nhé.';

const fullLine = (a: AddressDTO) => [a.street, a.ward, a.district, a.province].filter(Boolean).join(', ');

/**
 * Địa chỉ giao ở trang thanh toán (như AddressSection của Mini App): một dòng (tên, SĐT che bớt, địa chỉ cắt một dòng, "Đổi").
 * Chạm dòng mở tấm chọn (điện thoại: tấm đáy; từ md: hộp giữa màn) xếp mặc định trước rồi dùng gần nhất; chạm một địa chỉ là chọn và đóng,
 * nên đổi sang địa chỉ đã lưu khác mất 2 chạm và danh sách dài không đẩy khối thanh toán xuống.
 */
export function AddressPicker({
  addresses,
  selectedId,
  quoteOutdated,
  loadFailed,
  autoOpen = false,
  userId,
  onSelect,
  onCreated,
  onUpdated,
}: {
  addresses: AddressDTO[];
  selectedId: string | null;
  quoteOutdated: boolean;
  /** Danh sách không tải được: đã có dòng lỗi riêng, không được nói "chưa thêm địa chỉ". */
  loadFailed: boolean;
  /** Sổ địa chỉ đã tải xong và trống: mở sẵn form một lần (như Mini App). Đang tải thì false, kẻo mở nhầm khi sổ có địa chỉ. */
  autoOpen?: boolean;
  userId?: string;
  onSelect: (id: string) => void;
  onCreated: (a: AddressDTO) => void;
  onUpdated: (a: AddressDTO) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpen || autoOpened.current) return;
    autoOpened.current = true;
    setAdding(true);
  }, [autoOpen]);

  const selected = addresses.find((a) => a.id === selectedId) ?? null;
  const editing = addresses.find((a) => a.id === editingId) ?? null;
  const view = selected ? compactAddressView(selected) : null;
  const legacy = selected ? isLegacyGeo(selected) : false;
  const pick = (id: string) => {
    setPicking(false);
    if (id === selectedId) return;
    setEditingId(null);
    trackWebEvent('checkout_address_switched', { from: 'sheet' });
    onSelect(id);
  };
  const openAdd = () => {
    setPicking(false);
    setEditingId(null);
    setAdding(true);
  };

  return (
    <div className="mt-2 space-y-2">
      {addresses.length === 0 && !adding && !loadFailed && (
        <p data-testid="address-empty" className="text-sm leading-[var(--type-body-sm-lh)] text-[color:var(--color-text-tertiary)]">
          {fillCopy('checkout.addressEmpty')}
        </p>
      )}

      {selected && view && !editing && (
        <div data-testid="checkout-address-row">
          <div className="flex items-center gap-1">
          <button
            type="button"
            data-ds="checkout-address-card"
            aria-haspopup="dialog"
            onClick={() => setPicking(true)}
            className="tubu-press flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-control py-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-border-focus)]"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold leading-[var(--type-body-sm-lh)] text-[color:var(--color-text-primary)]">{view.title}</span>
              <span className="mt-0.5 block truncate text-caption text-[color:var(--color-text-secondary)]">{view.line}</span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-sm font-semibold text-[color:var(--color-text-brand)]">
              {fillCopy('checkout.addressChange')}
            </span>
            <span className="sr-only">{fillCopy('checkout.addressChangeAria')}</span>
          </button>
          {/* Sửa ngay tại thanh toán ở mọi khổ (BUYERWEB-14): khách điện thoại gõ sai số nhà không phải rời trang sang Sổ địa chỉ. */}
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setEditingId(selected.id);
            }}
            aria-label={`Sửa địa chỉ của ${selected.recipient}`}
            className={`${ui.btnText} shrink-0`}
          >
            Sửa
          </button>
          </div>
          {(legacy || quoteOutdated) && (
            <div role="alert" className="mt-2 flex flex-col gap-2 rounded-control bg-warning-bg p-3">
              <span className="flex items-start gap-1.5 text-sm text-warning-fg">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
                {legacy ? LEGACY_TEXT : MISMATCH_TEXT}
              </span>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setEditingId(selected.id);
                }}
                className={`${ui.btnSecondary} self-start`}
              >
                {legacy ? 'Cập nhật địa chỉ' : 'Sửa địa chỉ'}
              </button>
            </div>
          )}
        </div>
      )}

      {editing && (
        <AddressForm
          key={editing.id}
          title="Sửa địa chỉ"
          submitLabel="Lưu"
          initial={addressToForm(editing)}
          userId={userId}
          onSubmit={async (payload) => {
            const saved = await updateAddress(editing.id, payload);
            setEditingId(null);
            onUpdated(saved);
          }}
          onCancel={() => setEditingId(null)}
        />
      )}

      {adding ? (
        <AddressForm
          title="Thêm địa chỉ"
          userId={userId}
          submitLabel="Lưu"
          onSubmit={async (payload) => {
            const created = await createAddress(payload);
            setAdding(false);
            onCreated(created);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        addresses.length === 0 && !loadFailed && <AddAddressButton onClick={openAdd} />
      )}

      <BottomSheet open={picking} onClose={() => setPicking(false)} title={fillCopy('checkout.addressSheetTitle')}>
        <div role="radiogroup" aria-label={fillCopy('checkout.addressSheetTitle')} className="space-y-2">
          {picking &&
            sortAddressesForPicker(addresses, readRecentAddressIds(browserStorage(), userId)).map((a) => {
              const active = a.id === selectedId;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-ds="checkout-address-card"
                  onClick={() => pick(a.id)}
                  className={`tubu-press block min-h-11 w-full rounded-control border-2 p-3 text-left text-sm ${
                    active ? 'border-[var(--color-border-selected)] bg-[var(--color-bg-subtle)]' : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]'
                  }`}
                >
                  <span className="flex items-center gap-x-1.5">
                    <span className="min-w-0 truncate font-semibold text-[color:var(--color-text-primary)]">
                      {a.recipient} · {a.phone}
                    </span>
                    {a.isDefault && (
                      <Badge tone="brand" className="shrink-0">
                        Mặc định
                      </Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block break-words text-caption text-[color:var(--color-text-secondary)]">{fullLine(a)}</span>
                </button>
              );
            })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4">
          <AddAddressButton onClick={openAdd} />
          <Link href="/tai-khoan/dia-chi" className="hidden min-h-11 items-center text-sm text-[color:var(--color-text-secondary)] hover:underline md:inline-flex">
            Quản lý sổ địa chỉ
          </Link>
        </div>
      </BottomSheet>
    </div>
  );
}

function AddAddressButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[color:var(--color-text-brand)] hover:underline">
      <span
        aria-hidden="true"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-[var(--color-action-primary-bg)]"
      >
        <Plus className="h-4 w-4" strokeWidth={1.75} />
      </span>
      {fillCopy('checkout.addressAddNew')}
    </button>
  );
}
