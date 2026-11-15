'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { WasteHomePickupDTO } from '@tubutree/shared-types';
import { WASTE_QUERY_KEYS } from '@tubutree/app-core/api/waste';
import { HOME_PICKUP_WEIGHT_CHIPS_GRAMS, homePickupKgLabel } from '@tubutree/app-core/recycle-home-pickup-state';
import { homePickupDetailRows, type HomePickupQuoteState, type HomePickupQuoteView } from '@tubutree/app-core/recycle-home-pickup-view';
import { homePickupCopy } from '@tubutree/app-core/waste-copy';
import { AddressForm } from '@/components/address-form';
import { Chip } from '@/components/mini/chip';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';
import { addressToForm } from '@/lib/address-form';
import { skin } from '@/components/pro-shared/mini-skin';
import { createAddress, updateAddress, type AddressDTO } from '@/lib/shop-client';

const copy = homePickupCopy;
const addressLine = (a: AddressDTO) => [a.street, a.ward, a.district, a.province].filter(Boolean).join(', ');

export interface HomePickupComposerProps {
  addresses: readonly AddressDTO[];
  addressesStatus: 'loading' | 'error' | 'ready';
  onRetryAddresses: () => void;
  selectedAddressId: string | null;
  onSelectAddress: (id: string) => void;
  weightGrams: number;
  onWeight: (grams: number) => void;
  quoteState: HomePickupQuoteState;
  view: HomePickupQuoteView | null;
  /** Câu của máy chủ khi báo phí lỗi 503; không có thì dùng câu chung "Chưa tính được phí ship". */
  quoteErrorText?: string | null;
  onRetryQuote: () => void;
  /** Đang gửi đơn: khoá mọi ô chọn để nội dung không đổi giữa chừng. */
  disabled?: boolean;
}

type AddressMode = 'list' | 'add' | 'edit';

/** Phần mở ra khi khách chọn "Shipper lấy tận nhà": địa chỉ lấy rác, số kg, và một thẻ phí ship duy nhất (cùng bố cục với Mini App). */
export function HomePickupComposer(props: HomePickupComposerProps) {
  const { addresses, addressesStatus, selectedAddressId, weightGrams, quoteState, view, disabled = false } = props;
  const qc = useQueryClient();
  const { user } = useAuth();
  const [mode, setMode] = useState<AddressMode>('list');
  const selected = addresses.find((a) => a.id === selectedAddressId) ?? null;

  // Đưa địa chỉ vừa lưu vào danh sách trước khi chọn (danh sách tải lại về sau), và báo phí lại vì địa chỉ sửa có thể đổi tỉnh/phường.
  const keepSaved = (a: AddressDTO) => {
    qc.setQueryData<AddressDTO[]>(['addresses'], (old = []) => (old.some((x) => x.id === a.id) ? old.map((x) => (x.id === a.id ? a : x)) : [...old, a]));
    void qc.invalidateQueries({ queryKey: ['addresses'] });
    void qc.invalidateQueries({ queryKey: [...WASTE_QUERY_KEYS.all, 'pickup-quote'] });
    props.onSelectAddress(a.id);
    setMode('list');
  };

  return (
    <div data-testid="home-pickup" className="flex flex-col gap-3 tabular-nums">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-stone-900">{copy.addressTitle}</p>
        {addressesStatus === 'loading' && <p className="text-xs text-stone-600">{copy.addressLoading}</p>}
        {addressesStatus === 'error' && (
          <>
            <p className="text-xs text-danger-fg">{copy.addressLoadFailed}</p>
            <button type="button" className={`${skin.btnSecondary} self-start`} onClick={props.onRetryAddresses}>
              {copy.retry}
            </button>
          </>
        )}
        {addressesStatus === 'ready' && addresses.length === 0 && mode !== 'add' && <p className="text-xs text-stone-600">{copy.addressEmpty}</p>}
        {addresses.length > 0 && (
          <div role="radiogroup" aria-label={copy.addressTitle} className="flex flex-col gap-2">
            {addresses.map((a) => {
              const active = a.id === selectedAddressId;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-disabled={disabled || undefined}
                  data-address={a.id}
                  onClick={() => {
                    if (disabled) return;
                    setMode('list');
                    props.onSelectAddress(a.id);
                  }}
                  className={`tubu-press flex min-h-11 w-full flex-col gap-0.5 rounded-control border-2 p-3 text-left ${active ? 'border-forest-600 bg-stone-50' : 'border-stone-200 bg-stone-0'} ${disabled ? 'cursor-default opacity-60' : 'cursor-pointer'}`}
                >
                  <span className="flex flex-wrap items-center gap-x-1.5">
                    <span className="min-w-0 break-words text-sm font-semibold text-stone-900">{`${a.recipient} · ${a.phone}`}</span>
                    {a.isDefault && <Badge tone="brand">{copy.addressDefault}</Badge>}
                  </span>
                  <span className="break-words text-xs text-stone-600">{addressLine(a)}</span>
                </button>
              );
            })}
          </div>
        )}
        {mode === 'edit' && selected && (
          <AddressForm
            title={copy.addressFix}
            submitLabel="Lưu"
            initial={addressToForm(selected)}
            userId={user?.id}
            onSubmit={async (payload) => keepSaved(await updateAddress(selected.id, payload))}
            onCancel={() => setMode('list')}
          />
        )}
        {mode === 'add' && (
          <AddressForm
            title={copy.addressAdd}
            submitLabel="Lưu"
            userId={user?.id}
            onSubmit={async (payload) => keepSaved(await createAddress(payload))}
            onCancel={() => setMode('list')}
          />
        )}
        {mode === 'list' && addressesStatus !== 'loading' && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setMode('add')}
            className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-[color:var(--color-text-brand)] hover:underline disabled:opacity-60"
          >
            <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-dashed border-forest-600">
              <Plus className="h-4 w-4" strokeWidth={1.75} />
            </span>
            {copy.addressAdd}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-stone-900">{copy.weightTitle}</p>
        <div role="group" aria-label={copy.weightTitle} className="flex flex-wrap gap-2">
          {HOME_PICKUP_WEIGHT_CHIPS_GRAMS.map((g) => (
            <Chip key={g} variant="choice" selected={g === weightGrams} disabled={disabled} onPress={() => props.onWeight(g)}>
              {`${homePickupKgLabel(g)} kg`}
            </Chip>
          ))}
        </div>
      </div>

      {quoteState !== 'idle' && (
        <div data-testid="home-pickup-fee" aria-live="polite" className="flex flex-col gap-1 rounded-control bg-stone-50 p-3">
          {quoteState === 'loading' && <p className="text-xs text-stone-600">{copy.quoteLoading}</p>}
          {quoteState === 'error' && (
            <>
              <p className="text-xs text-danger-fg">{props.quoteErrorText ?? copy.quoteFailed}</p>
              <button type="button" className={`${skin.btnSecondary} self-start`} onClick={props.onRetryQuote}>
                {copy.retry}
              </button>
            </>
          )}
          {quoteState === 'ready' && view && (
            <>
              <div className="flex min-h-11 items-center justify-between gap-3">
                <span className="min-w-0 flex-1 break-words text-sm text-stone-600">{copy.feeLabel}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span data-testid="home-pickup-fee-value" className="text-base font-semibold text-stone-900">
                    {view.feeText}
                  </span>
                  {view.estimated && (
                    <Badge tone="neutral" size="sm">
                      {copy.estimatedTag}
                    </Badge>
                  )}
                </span>
              </div>
              <p data-testid="home-pickup-pay" className="text-xs text-stone-600">
                {view.payLine}
              </p>
              <p data-testid="home-pickup-points" className={`text-xs ${view.belowMin ? 'text-warning-fg' : 'text-stone-600'}`}>
                {view.pointsLine}
              </p>
              {view.notice && (
                <p data-testid="home-pickup-notice" className="break-words text-xs text-warning-fg">
                  {view.notice}
                </p>
              )}
              {!view.addressOk && selected && mode === 'list' && (
                <button type="button" className={`${skin.btnSecondary} self-start`} onClick={() => setMode('edit')}>
                  {copy.addressFix}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Các dòng tóm tắt của yêu cầu HOME_PICKUP ở trang chi tiết: địa chỉ, cân nặng, phí shipper, điểm đã trừ/hoàn. */
export function HomePickupDetail({ homePickup }: { homePickup: WasteHomePickupDTO }) {
  return (
    <div data-testid="home-pickup-detail" className="tabular-nums">
      {homePickupDetailRows(homePickup).map((r) => (
        <div key={r.label} className="flex items-start justify-between gap-3 py-1.5">
          <span className="shrink-0 text-sm text-stone-600">{r.label}</span>
          <span className="min-w-0 break-words text-right text-sm font-semibold text-stone-900">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

