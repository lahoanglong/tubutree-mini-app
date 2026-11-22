'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { WasteFeeCashMethod, WasteHomePickupDTO } from '@tubutree/shared-types';
import { WASTE_QUERY_KEYS, WASTE_WRITE_INVALIDATE_KEYS, getWasteFeeQr } from '@tubutree/app-core/api/waste';
import { HOME_PICKUP_WEIGHT_CHIPS_GRAMS, homePickupKgLabel } from '@tubutree/app-core/recycle-home-pickup-state';
import { homePickupDetailRows, type HomePickupQuoteState, type HomePickupQuoteView } from '@tubutree/app-core/recycle-home-pickup-view';
import { homePickupCopy } from '@tubutree/app-core/waste-copy';
import { hideBrokenImage } from '@tubutree/app-core/image-fallback';
import { AddressForm } from '@/components/address-form';
import { Chip } from '@/components/mini/chip';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';
import { addressToForm } from '@/lib/address-form';
import { copyText } from '@/lib/copy-text';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { skin } from '@/components/pro-shared/mini-skin';
import { createAddress, updateAddress, type AddressDTO } from '@/lib/shop-client';
import { useRemaining } from '@/lib/use-remaining';

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
  selectedPayment?: WasteFeeCashMethod | null;
  onSelectPayment?: (method: WasteFeeCashMethod) => void;
  onAttachNextOrder?: () => void;
  onOpenExistingPickup?: (requestId: string) => void;
  onSwitchDropOff?: () => void;
  /** Đang gửi đơn: khoá mọi ô chọn để nội dung không đổi giữa chừng. */
  disabled?: boolean;
}

type AddressMode = 'list' | 'add' | 'edit';

/** Phần mở ra khi khách chọn "Shipper lấy tận nhà": địa chỉ lấy rác, số kg, và một thẻ phí ship duy nhất (cùng bố cục với Mini App). */
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

  const fs = copy.feeShort;
  const opts = view?.needFeePayment ? view.feeOptions : null;

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
        <div data-testid="home-pickup-fee" aria-live="polite" className="flex flex-col gap-1.5 rounded-control bg-stone-50 p-3">
          {quoteState === 'loading' && <p className="text-xs text-stone-600">{copy.quoteLoading}</p>}
          {quoteState === 'error' && (
            <>
              <p className="text-xs text-danger-fg">{props.quoteErrorText ?? copy.quoteFailed}</p>
              <button type="button" className={`${skin.btnSecondary} self-start`} onClick={props.onRetryQuote}>
                {copy.retry}
              </button>
            </>
          )}
          {quoteState === 'ready' && view && !opts && (
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
          {quoteState === 'ready' && view && opts && (
            <div data-testid="home-pickup-fee-short" className="flex flex-col gap-2 tabular-nums">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-stone-600">{fs.feeRowLabel}</span>
                  <span data-testid="home-pickup-fee-value" className="font-semibold text-stone-900">{view.feeText}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-stone-600">{fs.pointsRowLabel}</span>
                  <span data-testid="home-pickup-pay" className="text-stone-600">{view.pointsDeductText}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-stone-900">{fs.shortRowLabel}</span>
                  <span data-testid="home-pickup-cash-due" className="text-base font-semibold text-stone-900">{view.cashDueText}</span>
                </div>
                <p data-testid="home-pickup-points" className="text-xs text-stone-600">{view.pointsLine}</p>
              </div>
              <hr className="border-stone-200" />
              <div className="flex flex-col gap-2">
                {opts.attachNextOrder.available && props.onAttachNextOrder ? (
                  <button
                    type="button"
                    data-testid="fee-path-attach"
                    disabled={disabled}
                    onClick={() => {
                      if (!disabled) props.onAttachNextOrder?.();
                    }}
                    className="tubu-press flex min-h-11 w-full flex-col gap-0.5 rounded-control border-2 border-forest-600 bg-stone-0 p-3 text-left disabled:opacity-60"
                  >
                    <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-stone-900">{`› ${fs.attachTitle}`}</span>
                      {opts.attachNextOrder.badge && <Badge tone="brand" size="sm">{opts.attachNextOrder.badge}</Badge>}
                    </span>
                    <span className="text-xs text-stone-600">{opts.attachNextOrder.subtitle}</span>
                  </button>
                ) : opts.attachNextOrder.existingRequestId && props.onOpenExistingPickup ? (
                  <button
                    type="button"
                    data-testid="fee-path-attach-existing"
                    disabled={disabled}
                    onClick={() => {
                      if (!disabled && opts.attachNextOrder.existingRequestId) props.onOpenExistingPickup?.(opts.attachNextOrder.existingRequestId);
                    }}
                    className="tubu-press flex min-h-11 w-full flex-col gap-0.5 rounded-control border border-stone-200 bg-stone-0 p-3 text-left disabled:opacity-60"
                  >
                    <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-stone-900">{`› ${fs.attachTitle}`}</span>
                      <span className="text-xs font-semibold text-forest-700">{fs.attachOpenExisting}</span>
                    </span>
                    <span className="text-xs text-stone-600">{opts.attachNextOrder.subtitle}</span>
                  </button>
                ) : (
                  <div data-testid="fee-path-attach-disabled" aria-disabled="true" className="flex min-h-11 w-full flex-col gap-0.5 rounded-control border border-stone-200 bg-stone-0 p-3 opacity-60">
                    <span className="text-sm font-semibold text-stone-900">{fs.attachTitle}</span>
                    <span className="text-xs text-stone-600">{opts.attachNextOrder.subtitle}</span>
                  </div>
                )}

                {(opts.wallet || opts.bankTransfer) && (
                  <div role="radiogroup" aria-label={fs.paymentGroupAria} className="flex flex-col gap-2">
                    {opts.wallet && (
                      <button
                        type="button"
                        role="radio"
                        data-testid="fee-path-wallet"
                        data-payment="WALLET"
                        aria-checked={selectedPayment === 'WALLET'}
                        aria-disabled={!opts.wallet.enough || disabled || undefined}
                        onClick={() => {
                          if (opts.wallet?.enough && !disabled) props.onSelectPayment?.('WALLET');
                        }}
                        className={`tubu-press flex min-h-11 w-full flex-col gap-0.5 rounded-control border-2 p-3 text-left ${
                          selectedPayment === 'WALLET' ? 'border-forest-600 bg-stone-0' : 'border-stone-200 bg-stone-0'
                        } ${!opts.wallet.enough || disabled ? 'cursor-default opacity-60' : 'cursor-pointer'}`}
                      >
                        <span className="text-sm font-semibold text-stone-900">{opts.wallet.title}</span>
                        <span className={`text-xs ${opts.wallet.enough ? 'text-stone-600' : 'text-warning-fg'}`}>{opts.wallet.subtitle}</span>
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
                        onClick={() => {
                          if (!disabled) props.onSelectPayment?.('BANK_TRANSFER');
                        }}
                        className={`tubu-press flex min-h-11 w-full flex-col gap-0.5 rounded-control border-2 p-3 text-left ${
                          selectedPayment === 'BANK_TRANSFER' ? 'border-forest-600 bg-stone-0' : 'border-stone-200 bg-stone-0'
                        } ${disabled ? 'cursor-default opacity-60' : 'cursor-pointer'}`}
                      >
                        <span className="text-sm font-semibold text-stone-900">{opts.bankTransfer.title}</span>
                        <span className="text-xs text-stone-600">{opts.bankTransfer.subtitle}</span>
                      </button>
                    )}
                  </div>
                )}

                {props.onSwitchDropOff && (
                  <button
                    type="button"
                    data-testid="fee-path-dropoff"
                    disabled={disabled}
                    onClick={() => {
                      if (!disabled) props.onSwitchDropOff?.();
                    }}
                    className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-forest-700 hover:underline disabled:opacity-60"
                  >
                    {fs.dropOffLink}
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

/** Gói 178-E: thẻ VietQR ngay trong chi tiết yêu cầu web khi khách chọn chuyển khoản phí lấy rác (poll 4s, không thêm route). */
export function HomePickupFeeQrCard({ requestId }: { requestId: string }) {
  const qc = useQueryClient();
  const d = copy.detail;
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const qrQ = useQuery({
    queryKey: WASTE_QUERY_KEYS.feeQr(requestId),
    queryFn: () => getWasteFeeQr(coreHttp, requestId),
    refetchInterval: (q) => (q.state.data && q.state.data.paymentStatus !== 'UNPAID' ? false : 4000),
  });
  const qr = qrQ.data;
  const remaining = useRemaining(qr?.paymentDeadline);

  useEffect(() => {
    if (qr && qr.paymentStatus !== 'UNPAID') {
      void Promise.all(WASTE_WRITE_INVALIDATE_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
    }
  }, [qr, qc]);

  const handleCopy = async (key: string, value: string) => {
    if (await copyText(value)) {
      setCopiedKey(key);
    }
  };

  const handleManualCheck = async () => {
    setChecking(true);
    try {
      const res = await qrQ.refetch();
      if (res.data && res.data.paymentStatus !== 'UNPAID') {
        await Promise.all(WASTE_WRITE_INVALIDATE_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div data-testid="home-pickup-fee-qr" className="flex flex-col gap-3 tabular-nums">
      <h3 className="text-base font-semibold text-stone-900">{d.qrTitle}</h3>
      <p className="text-xs text-stone-600">{d.qrHint}</p>
      {qrQ.isPending && <p className="text-xs text-stone-600">{d.qrLoading}</p>}
      {qrQ.isError && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-danger-fg">{d.qrError}</p>
          <button type="button" className={`${skin.btnSecondary} self-start`} onClick={() => void qrQ.refetch()}>
            {copy.retry}
          </button>
        </div>
      )}
      {qr && qr.paymentStatus === 'UNPAID' && (
        <>
          {qr.qrImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- ảnh VietQR do API sinh theo từng phiếu, next/image không tối ưu được và không cần
            <img
              src={qr.qrImageUrl}
              alt={d.qrTitle}
              width={192}
              height={192}
              className="h-48 w-48 self-center rounded-control bg-stone-0 object-contain p-1.5"
              onError={hideBrokenImage}
            />
          )}
          {remaining && (
            <p className={`text-xs ${remaining.expired ? 'text-danger-fg' : 'text-stone-600'}`}>
              {remaining.expired ? d.qrExpired : d.qrDeadline(remaining.text)}
            </p>
          )}
          <div className="flex min-h-11 items-center justify-between gap-2 border-t border-stone-200 pt-2">
            <div>
              <p className="text-xs text-stone-600">{d.qrBankLabel}</p>
              <p className="text-sm font-semibold text-stone-900">{qr.bank.name || qr.bank.bin}</p>
            </div>
            <span className="text-xs text-stone-600">{qr.bank.accountName}</span>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-2 border-t border-stone-200 pt-2">
            <div>
              <p className="text-xs text-stone-600">{d.qrAccountLabel}</p>
              <p className="text-sm font-semibold text-stone-900">{qr.bank.accountNo}</p>
            </div>
            <button type="button" className={skin.btnSecondary} onClick={() => void handleCopy('acc', qr.bank.accountNo)}>
              {copiedKey === 'acc' ? d.qrCopied : d.qrCopy}
            </button>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-2 border-t border-stone-200 pt-2">
            <div>
              <p className="text-xs text-stone-600">{d.qrAmountLabel}</p>
              <p className="text-sm font-semibold text-stone-900">{formatVnd(qr.amount)}</p>
            </div>
            <button type="button" className={skin.btnSecondary} onClick={() => void handleCopy('amt', String(qr.amount))}>
              {copiedKey === 'amt' ? d.qrCopied : d.qrCopy}
            </button>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-2 border-t border-stone-200 pt-2">
            <div>
              <p className="text-xs text-stone-600">{d.qrMemoLabel}</p>
              <p className="text-sm font-semibold text-stone-900">{qr.memo}</p>
              <p className="text-xs text-warning-fg">{d.qrMemoWarn}</p>
            </div>
            <button type="button" className={skin.btnSecondary} onClick={() => void handleCopy('memo', qr.memo)}>
              {copiedKey === 'memo' ? d.qrCopied : d.qrCopy}
            </button>
          </div>
          <button type="button" className={`${skin.btnSecondary} w-full`} disabled={checking} onClick={() => void handleManualCheck()}>
            {checking ? d.qrRefreshing : d.qrRefresh}
          </button>
        </>
      )}
    </div>
  );
}
