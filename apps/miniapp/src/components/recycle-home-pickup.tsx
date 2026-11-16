import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { WasteFeeCashMethod, WasteHomePickupDTO } from '@tubutree/shared-types';
import { HOME_PICKUP_WEIGHT_CHIPS_GRAMS, homePickupKgLabel } from '@tubutree/app-core/recycle-home-pickup-state';
import { homePickupDetailRows, type HomePickupQuoteState, type HomePickupQuoteView } from '@tubutree/app-core/recycle-home-pickup-view';
import { homePickupCopy } from '@tubutree/app-core/waste-copy';
import { hideBrokenImage } from '@tubutree/app-core/image-fallback';
import { WASTE_QUERY_KEYS, getWasteFeeQr, invalidateAfterWasteWrite } from '../services/waste-api';
import type { AddressDTO } from '../services/shop-api';
import { useRemaining } from '../hooks/use-remaining';
import { copyText } from '../utils/clipboard';
import { addressLine, formatVnd } from '../utils/format';
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
  selectedPayment?: WasteFeeCashMethod | null;
  onSelectPayment?: (method: WasteFeeCashMethod) => void;
  onAttachNextOrder?: () => void;
  onOpenExistingPickup?: (requestId: string) => void;
  onSwitchDropOff?: () => void;
  /** Đang gửi đơn: khoá mọi ô chọn để nội dung không đổi giữa chừng. */
  disabled?: boolean;
}

type AddressMode = 'list' | 'add' | 'edit';

/** Phần mở ra khi khách chọn "Shipper lấy tận nhà": địa chỉ lấy rác, số kg, và một thẻ phí ship duy nhất. */
export function HomePickupComposer(props: HomePickupComposerProps) {
  const {
    addresses,
    addressesStatus,
    selectedAddressId,
    weightGrams,
    quoteState,
    view,
    selectedPayment = null,
    disabled = false,
  } = props;
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

  const fs = copy.feeShort;
  const opts = view?.needFeePayment ? view.feeOptions : null;

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
          {quoteState === 'ready' && view && !opts && (
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
          {quoteState === 'ready' && view && opts && (
            <div data-testid="home-pickup-fee-short">
              <div className="tubu-hp-short-row">
                <Text variant="body-sm" tone="secondary" as="span">
                  {fs.feeRowLabel}
                </Text>
                <Text variant="body-sm" style={BOLD} as="span" numeric data-testid="home-pickup-fee-value">
                  {view.feeText}
                </Text>
              </div>
              <div className="tubu-hp-short-row">
                <Text variant="body-sm" tone="secondary" as="span">
                  {fs.pointsRowLabel}
                </Text>
                <Text variant="body-sm" tone="secondary" as="span" numeric data-testid="home-pickup-pay">
                  {view.pointsDeductText}
                </Text>
              </div>
              <div className="tubu-hp-short-row">
                <Text variant="body-sm" style={BOLD} as="span">
                  {fs.shortRowLabel}
                </Text>
                <Text variant="body-md" style={BOLD} as="span" numeric data-testid="home-pickup-cash-due">
                  {view.cashDueText}
                </Text>
              </div>
              <Text variant="caption" tone="secondary" as="div" numeric data-testid="home-pickup-points">
                {view.pointsLine}
              </Text>
              <hr className="tubu-hp-sep" />
              <div className="tubu-hp-opts">
                {opts.attachNextOrder.available && props.onAttachNextOrder ? (
                  <button
                    type="button"
                    data-testid="fee-path-attach"
                    disabled={disabled}
                    className="tubu-hp-opt tubu-hp-opt-recommend tubu-press"
                    onClick={() => {
                      if (disabled) return;
                      haptic('light');
                      props.onAttachNextOrder?.();
                    }}
                  >
                    <span className="tubu-hp-opt-head">
                      <Text variant="body-sm" style={BOLD} className="tubu-hp-wrap">
                        {`› ${fs.attachTitle}`}
                      </Text>
                      {opts.attachNextOrder.badge && <Badge tone="brand" size="sm">{opts.attachNextOrder.badge}</Badge>}
                    </span>
                    <Text variant="caption" tone="secondary" as="span" className="tubu-hp-wrap">
                      {opts.attachNextOrder.subtitle}
                    </Text>
                  </button>
                ) : opts.attachNextOrder.existingRequestId && props.onOpenExistingPickup ? (
                  <button
                    type="button"
                    data-testid="fee-path-attach-existing"
                    disabled={disabled}
                    className="tubu-hp-opt tubu-press"
                    onClick={() => {
                      if (disabled || !opts.attachNextOrder.existingRequestId) return;
                      haptic('light');
                      props.onOpenExistingPickup?.(opts.attachNextOrder.existingRequestId);
                    }}
                  >
                    <span className="tubu-hp-opt-head">
                      <Text variant="body-sm" style={BOLD} className="tubu-hp-wrap">
                        {`› ${fs.attachTitle}`}
                      </Text>
                      <Text variant="caption" tone="brand" style={BOLD}>
                        {fs.attachOpenExisting}
                      </Text>
                    </span>
                    <Text variant="caption" tone="secondary" as="span" className="tubu-hp-wrap">
                      {opts.attachNextOrder.subtitle}
                    </Text>
                  </button>
                ) : (
                  <div className="tubu-hp-opt" aria-disabled="true" data-testid="fee-path-attach-disabled">
                    <Text variant="body-sm" style={BOLD} className="tubu-hp-wrap">
                      {fs.attachTitle}
                    </Text>
                    <Text variant="caption" tone="secondary" as="span" className="tubu-hp-wrap">
                      {opts.attachNextOrder.subtitle}
                    </Text>
                  </div>
                )}

                {(opts.wallet || opts.bankTransfer) && (
                  <div role="radiogroup" aria-label={fs.paymentGroupAria} className="tubu-hp-opts">
                    {opts.wallet && (
                      <button
                        type="button"
                        role="radio"
                        data-testid="fee-path-wallet"
                        data-payment="WALLET"
                        aria-checked={selectedPayment === 'WALLET'}
                        aria-disabled={!opts.wallet.enough || disabled || undefined}
                        className="tubu-hp-opt tubu-press"
                        onClick={() => {
                          if (!opts.wallet?.enough || disabled) return;
                          haptic('light');
                          props.onSelectPayment?.('WALLET');
                        }}
                      >
                        <Text variant="body-sm" style={BOLD} className="tubu-hp-wrap">
                          {opts.wallet.title}
                        </Text>
                        <Text variant="caption" tone={opts.wallet.enough ? 'secondary' : 'warning'} as="span" className="tubu-hp-wrap">
                          {opts.wallet.subtitle}
                        </Text>
                      </button>
                    )}
                    {opts.bankTransfer && (
                      <button
                        type="button"
                        role="radio"
                        data-testid="fee-path-bank"
                        data-payment="BANK_TRANSFER"
                        aria-checked={selectedPayment === 'BANK_TRANSFER'}
                        aria-disabled={disabled || undefined}
                        className="tubu-hp-opt tubu-press"
                        onClick={() => {
                          if (disabled) return;
                          haptic('light');
                          props.onSelectPayment?.('BANK_TRANSFER');
                        }}
                      >
                        <Text variant="body-sm" style={BOLD} className="tubu-hp-wrap">
                          {opts.bankTransfer.title}
                        </Text>
                        <Text variant="caption" tone="secondary" as="span" className="tubu-hp-wrap">
                          {opts.bankTransfer.subtitle}
                        </Text>
                      </button>
                    )}
                  </div>
                )}

                {props.onSwitchDropOff && (
                  <button
                    type="button"
                    data-testid="fee-path-dropoff"
                    disabled={disabled}
                    className="tubu-hp-link tubu-press"
                    onClick={() => {
                      if (disabled) return;
                      haptic('light');
                      props.onSwitchDropOff?.();
                    }}
                  >
                    <Text variant="body-sm" tone="brand" style={BOLD}>
                      {fs.dropOffLink}
                    </Text>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Các dòng tóm tắt của yêu cầu HOME_PICKUP ở trang chi tiết: địa chỉ, cân nặng, phí shipper, điểm và phí tiền đã trừ/hoàn. */
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

/** Gói 178-E: thẻ VietQR nhúng thẳng trong chi tiết phiếu đang chờ chuyển khoản phí lấy rác (poll 4s, không thêm route). */
export function HomePickupFeeQrCard({ requestId, onPaid }: { requestId: string; onPaid?: () => void }) {
  const qc = useQueryClient();
  const d = copy.detail;
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const qrQ = useQuery({
    queryKey: WASTE_QUERY_KEYS.feeQr(requestId),
    queryFn: () => getWasteFeeQr(requestId),
    refetchInterval: (q) => (q.state.data && q.state.data.paymentStatus !== 'UNPAID' ? false : 4000),
  });
  const qr = qrQ.data;
  const remaining = useRemaining(qr?.paymentDeadline);

  useEffect(() => {
    if (qr && qr.paymentStatus !== 'UNPAID') {
      void invalidateAfterWasteWrite(qc);
      onPaid?.();
    }
  }, [qr, qc, onPaid]);

  const handleCopy = async (key: string, value: string) => {
    haptic('light');
    if (await copyText(value)) {
      setCopiedKey(key);
    }
  };

  const handleManualCheck = async () => {
    haptic('medium');
    setChecking(true);
    try {
      const res = await qrQ.refetch();
      if (res.data && res.data.paymentStatus !== 'UNPAID') {
        await invalidateAfterWasteWrite(qc);
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="tubu-hp-qr" data-testid="home-pickup-fee-qr">
      <Text variant="body-md" style={BOLD} as="div">
        {d.qrTitle}
      </Text>
      <Text variant="caption" tone="secondary" as="div" className="tubu-hp-wrap">
        {d.qrHint}
      </Text>
      {qrQ.isPending && (
        <Text variant="caption" tone="secondary" as="div">
          {d.qrLoading}
        </Text>
      )}
      {qrQ.isError && (
        <>
          <Text variant="caption" tone="danger" as="div">
            {d.qrError}
          </Text>
          <Button variant="secondary" onPress={() => void qrQ.refetch()}>
            {copy.retry}
          </Button>
        </>
      )}
      {qr && qr.paymentStatus === 'UNPAID' && (
        <>
          {qr.qrImageUrl && <img src={qr.qrImageUrl} alt={d.qrTitle} className="tubu-hp-qr-img" onError={hideBrokenImage} />}
          {remaining && (
            <Text variant="caption" tone={remaining.expired ? 'danger' : 'secondary'} as="div" numeric>
              {remaining.expired ? d.qrExpired : d.qrDeadline(remaining.text)}
            </Text>
          )}
          <div className="tubu-hp-qr-row">
            <div>
              <Text variant="caption" tone="secondary" as="div">{d.qrBankLabel}</Text>
              <Text variant="body-sm" style={BOLD} as="div">{qr.bank.name || qr.bank.bin}</Text>
            </div>
            <Text variant="caption" tone="secondary" as="span">{qr.bank.accountName}</Text>
          </div>
          <div className="tubu-hp-qr-row">
            <div>
              <Text variant="caption" tone="secondary" as="div">{d.qrAccountLabel}</Text>
              <Text variant="body-sm" style={BOLD} as="div" numeric>{qr.bank.accountNo}</Text>
            </div>
            <button type="button" className="tubu-hp-qr-copy" onClick={() => void handleCopy('acc', qr.bank.accountNo)}>
              {copiedKey === 'acc' ? d.qrCopied : d.qrCopy}
            </button>
          </div>
          <div className="tubu-hp-qr-row">
            <div>
              <Text variant="caption" tone="secondary" as="div">{d.qrAmountLabel}</Text>
              <Text variant="body-sm" style={BOLD} as="div" numeric>{formatVnd(qr.amount)}</Text>
            </div>
            <button type="button" className="tubu-hp-qr-copy" onClick={() => void handleCopy('amt', String(qr.amount))}>
              {copiedKey === 'amt' ? d.qrCopied : d.qrCopy}
            </button>
          </div>
          <div className="tubu-hp-qr-row">
            <div>
              <Text variant="caption" tone="secondary" as="div">{d.qrMemoLabel}</Text>
              <Text variant="body-sm" style={BOLD} as="div">{qr.memo}</Text>
              <Text variant="caption" tone="warning" as="div">{d.qrMemoWarn}</Text>
            </div>
            <button type="button" className="tubu-hp-qr-copy" onClick={() => void handleCopy('memo', qr.memo)}>
              {copiedKey === 'memo' ? d.qrCopied : d.qrCopy}
            </button>
          </div>
          <Button variant="secondary" fullWidth loading={checking} onPress={() => void handleManualCheck()}>
            {checking ? d.qrRefreshing : d.qrRefresh}
          </Button>
        </>
      )}
    </div>
  );
}
