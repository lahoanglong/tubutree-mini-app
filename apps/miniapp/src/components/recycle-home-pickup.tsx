import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { WasteHomePickupDTO } from '@tubutree/shared-types';
import { HOME_PICKUP_WEIGHT_CHIPS_GRAMS, homePickupKgLabel } from '@tubutree/app-core/recycle-home-pickup-state';
import { homePickupDetailRows, type HomePickupQuoteState, type HomePickupQuoteView } from '@tubutree/app-core/recycle-home-pickup-view';
import { homePickupCopy } from '@tubutree/app-core/waste-copy';
import { WASTE_QUERY_KEYS } from '../services/waste-api';
import type { AddressDTO } from '../services/shop-api';
import { addressLine } from '../utils/format';
import { haptic } from '../utils/haptic';
import { AddressForm } from './address-form';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Chip } from './ui/chip';
import { Icon } from './ui/icon';
import { Text } from './ui/text';
import '../css/recycle-home-pickup.css';

const copy = homePickupCopy;
const BOLD = { fontWeight: 600 } as const;

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

/** Phần mở ra khi khách chọn "Shipper lấy tận nhà": địa chỉ lấy rác, số kg, và một thẻ phí ship duy nhất. */
export function HomePickupComposer(props: HomePickupComposerProps) {
  const { addresses, addressesStatus, selectedAddressId, weightGrams, quoteState, view, disabled = false } = props;
  const qc = useQueryClient();
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
    <div className="tubu-hp" data-testid="home-pickup">
      <div className="tubu-hp-group">
        <Text variant="body-sm" as="div" style={BOLD}>
          {copy.addressTitle}
        </Text>
        {addressesStatus === 'loading' && (
          <Text variant="caption" tone="secondary" as="div">
            {copy.addressLoading}
          </Text>
        )}
        {addressesStatus === 'error' && (
          <>
            <Text variant="caption" tone="danger" as="div">
              {copy.addressLoadFailed}
            </Text>
            <Button variant="secondary" onPress={props.onRetryAddresses}>
              {copy.retry}
            </Button>
          </>
        )}
        {addressesStatus === 'ready' && addresses.length === 0 && mode !== 'add' && (
          <Text variant="caption" tone="secondary" as="div">
            {copy.addressEmpty}
          </Text>
        )}
        {addresses.length > 0 && (
          <div role="radiogroup" aria-label={copy.addressTitle} className="tubu-hp-list">
            {addresses.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={a.id === selectedAddressId}
                aria-disabled={disabled || undefined}
                data-address={a.id}
                className="tubu-hp-addr tubu-press"
                onClick={() => {
                  if (disabled) return;
                  haptic('light');
                  setMode('list');
                  props.onSelectAddress(a.id);
                }}
              >
                <span className="tubu-hp-addr-head">
                  <Text variant="body-sm" style={BOLD} className="tubu-hp-wrap">
                    {`${a.recipient} · ${a.phone}`}
                  </Text>
                  {a.isDefault && <Badge tone="brand">{copy.addressDefault}</Badge>}
                </span>
                <Text variant="caption" tone="secondary" as="span" className="tubu-hp-wrap">
                  {addressLine(a)}
                </Text>
              </button>
            ))}
          </div>
        )}
        {mode === 'edit' && selected && <AddressForm initial={selected} onCancel={() => setMode('list')} onSaved={keepSaved} />}
        {mode === 'add' && <AddressForm initial={null} askZaloProfile={addresses.length === 0} onCancel={() => setMode('list')} onSaved={keepSaved} />}
        {mode === 'list' && addressesStatus !== 'loading' && (
          <button
            type="button"
            className="tubu-hp-add tubu-press"
            disabled={disabled}
            onClick={() => {
              haptic('light');
              setMode('add');
            }}
          >
            <span aria-hidden className="tubu-hp-add-dot">
              <Icon icon={Plus} size="sm" tone="brand" />
            </span>
            <Text variant="body-sm" tone="brand" style={BOLD}>
              {copy.addressAdd}
            </Text>
          </button>
        )}
      </div>

      <div className="tubu-hp-group">
        <Text variant="body-sm" as="div" style={BOLD}>
          {copy.weightTitle}
        </Text>
        <div role="group" aria-label={copy.weightTitle} className="tubu-hp-chips">
          {HOME_PICKUP_WEIGHT_CHIPS_GRAMS.map((g) => (
            <Chip key={g} variant="choice" selected={g === weightGrams} disabled={disabled} onPress={() => props.onWeight(g)}>
              {`${homePickupKgLabel(g)} kg`}
            </Chip>
          ))}
        </div>
      </div>

      {quoteState !== 'idle' && (
        <div className="tubu-hp-fee" data-testid="home-pickup-fee" aria-live="polite">
          {quoteState === 'loading' && (
            <Text variant="caption" tone="secondary" as="div">
              {copy.quoteLoading}
            </Text>
          )}
          {quoteState === 'error' && (
            <>
              <Text variant="caption" tone="danger" as="div">
                {props.quoteErrorText ?? copy.quoteFailed}
              </Text>
              <Button variant="secondary" className="tubu-hp-retry" onPress={props.onRetryQuote}>
                {copy.retry}
              </Button>
            </>
          )}
          {quoteState === 'ready' && view && (
            <>
              <div className="tubu-hp-row">
                <Text variant="body-sm" tone="secondary" as="span">
                  {copy.feeLabel}
                </Text>
                <span className="tubu-hp-fee-value">
                  <Text variant="body-md" style={BOLD} numeric data-testid="home-pickup-fee-value">
                    {view.feeText}
                  </Text>
                  {view.estimated && (
                    <Badge tone="neutral" size="sm">
                      {copy.estimatedTag}
                    </Badge>
                  )}
                </span>
              </div>
              <Text variant="caption" tone="secondary" as="div" numeric data-testid="home-pickup-pay">
                {view.payLine}
              </Text>
              <Text variant="caption" tone={view.belowMin ? 'warning' : 'secondary'} as="div" numeric data-testid="home-pickup-points">
                {view.pointsLine}
              </Text>
              {view.notice && (
                <Text variant="caption" tone="warning" as="div" className="tubu-hp-wrap" data-testid="home-pickup-notice">
                  {view.notice}
                </Text>
              )}
              {!view.addressOk && selected && mode === 'list' && (
                <Button variant="secondary" className="tubu-hp-retry" onPress={() => setMode('edit')}>
                  {copy.addressFix}
                </Button>
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
    <div data-testid="home-pickup-detail">
      {homePickupDetailRows(homePickup).map((r) => (
        <div key={r.label} className="tubu-hp-kv">
          <Text variant="body-sm" tone="secondary" as="span">
            {r.label}
          </Text>
          <Text variant="body-sm" style={BOLD} as="span" numeric>
            {r.value}
          </Text>
        </div>
      ))}
    </div>
  );
}
