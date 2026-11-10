import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'zmp-ui';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { Checkbox } from '../ui/form';
import { QuantitySelector } from '../ui/quantity-selector';
import { Text } from '../ui/text';
import { MultiImageUpload } from '../image-upload';
import { useLockedMutation } from '../game/use-locked-mutation';
import { RefundDestinationPicker } from './refund-destination-picker';
import { estimateReturn, fetchRefundBank, requestReturn, type OrderView, type ReturnRequestDTO } from '../../services/shop-api';
import { getErrorMessage, isStaleStateError } from '../../services/api';
import { LOCK_REFRESH_WAIT_MS, settleWithin } from '../../utils/settle-within';
import { haptic } from '../../utils/haptic';
import { vi } from '../../i18n/vi';
import { formatNumber, formatVnd } from '../../utils/format';
import {
  EMPTY_BANK,
  RETURN_REASONS,
  canRefundToBank,
  destinationBody,
  remainingByLine,
  type RefundBankInput,
  type RefundMethodChoice,
  type ReturnLineState,
  type ReturnReasonCode,
} from '../../utils/refund-rules';
import { returnFormError } from '../../utils/refund-form-rules';

interface Props {
  open: boolean;
  onClose: () => void;
  order: OrderView;
  returns: ReturnRequestDTO[];
  returnDays: number;
}

/** Câu máy chủ trả khi hết hạn đổi/trả ("Quá hạn đổi/trả (7 ngày từ khi nhận hàng)."): hạn tính theo giờ máy chủ nên Mini chỉ biết qua lời này. */
const RETURN_WINDOW_CLOSED = /^Quá hạn đổi\/trả/;

function initialLines(order: OrderView, returns: ReturnRequestDTO[]): ReturnLineState[] {
  const remaining = remainingByLine(order.items, returns.filter((r) => r.orderId === order.id));
  const lines = order.items
    .map((it) => ({
      orderItemId: it.id,
      productName: it.productName,
      variationName: it.variationName,
      remaining: remaining.get(it.id) ?? 0,
      selected: false,
      quantity: 1,
    }))
    .filter((l) => l.remaining > 0);
  // Đơn một dòng: chọn sẵn, khách chỉ cần chỉnh số lượng.
  if (lines.length === 1) lines[0]!.selected = true;
  return lines;
}

/** Yêu cầu đổi/trả theo dòng và số lượng (D3), kèm lý do chọn sẵn và nơi nhận tiền hoàn (D2). */
export function ReturnRequestSheet({ open, onClose, order, returns, returnDays }: Props) {
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  // Trạng thái form khởi tạo một lần mỗi lần mở: nơi gọi đổi `key` khi mở sheet.
  const [lines, setLines] = useState<ReturnLineState[]>(() => initialLines(order, returns));
  const [reasonCode, setReasonCode] = useState<ReturnReasonCode | null>(null);
  const [reason, setReason] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [imagesBusy, setImagesBusy] = useState(false);
  const [method, setMethod] = useState<RefundMethodChoice>('WALLET');
  const [bank, setBank] = useState<RefundBankInput>(EMPTY_BANK);
  const [touched, setTouched] = useState(false);
  const placedForCustomer = !!(order as { placedForCustomer?: boolean }).placedForCustomer;
  const bankAllowed = canRefundToBank(order.paymentMethod) && !placedForCustomer;
  const showsMoney = order.total > 0 && order.paymentMethod !== 'XU';

  useEffect(() => {
    if (method !== 'BANK' || bank.accountNumber) return;
    let alive = true;
    void fetchRefundBank()
      .then((b) => {
        if (alive && b) setBank(b);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [method, bank.accountNumber]);

  const picked = useMemo(
    () => lines.filter((l) => l.selected && l.quantity > 0).map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity })),
    [lines],
  );
  const estimate = useQuery({
    queryKey: ['return-estimate', order.code, picked, reasonCode],
    queryFn: () => estimateReturn(order.code, { items: picked, reasonCode: reasonCode ?? undefined }),
    enabled: open && showsMoney && picked.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const estimated = picked.length > 0 && estimate.data?.moneyRefundable ? estimate.data : null;

  const error = useMemo(
    () => returnFormError({ lines, reasonCode, reason, refundMethod: bankAllowed ? method : 'WALLET', bank }),
    [lines, reasonCode, reason, method, bank, bankAllowed],
  );

  // Mốc lần máy chủ từ chối gần nhất: chỉ trong lúc tải lại sau đó, tấm tự đóng mới coi là đã được lời máy chủ báo trước.
  const rejectedAtRef = useRef(0);
  // Máy chủ báo quá hạn đổi/trả: đơn vẫn Đã giao nên dữ liệu tải lại không tự làm form hết hiệu lực, phải đóng theo lời máy chủ.
  const [windowClosed, setWindowClosed] = useState(false);
  const submit = useLockedMutation({
    mutationFn: () =>
      requestReturn(order.code, {
        reasonCode: reasonCode!,
        reason: reason.trim() || undefined,
        images,
        items: picked,
        ...(showsMoney && bankAllowed ? destinationBody(method, bank) : {}),
      }),
    onSuccess: () => {
      haptic('medium');
      setReason('');
      setImages([]);
      setReasonCode(null);
      void queryClient.invalidateQueries({ queryKey: ['my-returns'] });
      openSnackbar({ text: 'Đã gửi yêu cầu đổi/trả. Tubu sẽ phản hồi trong 24h.', type: 'success' });
      onClose();
    },
    // Trả Promise: khoá giữ tới khi đơn và danh sách đổi/trả tải lại xong (tối đa `settleWithin`), kẻo nút Gửi sáng lại trên dữ liệu cũ.
    // Lỗi tạm (mất mạng, 5xx) thì giữ nguyên: không nói gì về trạng thái thật của đơn.
    onError: (e: unknown) => {
      openSnackbar({ text: getErrorMessage(e), type: 'error' });
      if (!isStaleStateError(e)) return undefined;
      rejectedAtRef.current = Date.now();
      if (RETURN_WINDOW_CLOSED.test(getErrorMessage(e))) setWindowClosed(true);
      return settleWithin(
        Promise.all([
          queryClient.invalidateQueries({ queryKey: ['order', order.code] }),
          queryClient.invalidateQueries({ queryKey: ['orders'] }),
          queryClient.invalidateQueries({ queryKey: ['my-returns'] }),
          queryClient.invalidateQueries({ queryKey: ['my-refunds'] }),
        ]),
      );
    },
  });

  // Đơn đã rời trạng thái Đã giao hoặc đã có yêu cầu chờ xử lý (máy khác vừa gửi, hoặc dữ liệu vừa tải lại sau khi bị từ chối): form này
  // không gửi được nữa nên đóng. Lỗi nhập liệu thì trạng thái đơn không đổi và form giữ nguyên để khách sửa.
  // Số còn trả được của từng dòng theo dữ liệu mới nhất (yêu cầu khác của đơn vừa được duyệt): giữ lựa chọn của khách, chỉ kẹp số lượng xuống
  // mức còn lại, gỡ dòng đã hết; không thì "vượt số còn lại" bị máy chủ từ chối lặp lại với đúng số lượng đó.
  const remainingNow = useMemo(() => remainingByLine(order.items, returns.filter((r) => r.orderId === order.id)), [order.items, order.id, returns]);
  useEffect(() => {
    setLines((ls) => {
      let changed = false;
      const next = ls.flatMap((l) => {
        const left = remainingNow.get(l.orderItemId) ?? 0;
        if (left <= 0) {
          changed = true;
          return [];
        }
        if (left === l.remaining) return [l];
        changed = true;
        return [{ ...l, remaining: left, quantity: Math.min(l.quantity, left) }];
      });
      return changed ? next : ls;
    });
  }, [remainingNow]);
  const exhausted = order.items.length > 0 && lines.length === 0;
  const unavailable =
    order.status !== 'DELIVERED' || windowClosed || exhausted || returns.some((r) => r.orderId === order.id && r.status === 'REQUESTED');
  useEffect(() => {
    if (!open || !unavailable || submit.isPending) return;
    // Khách vừa đọc lời máy chủ từ chối thì không báo thêm; còn dữ liệu nền mới về thì tấm biến mất mà không có lời nào, nên phải nói.
    const justRejected = Date.now() - rejectedAtRef.current < LOCK_REFRESH_WAIT_MS + 1_000;
    if (!justRejected) openSnackbar({ text: 'Đơn này không còn đổi/trả được nữa hoặc đã có yêu cầu đang chờ xử lý.', type: 'info' });
    rejectedAtRef.current = 0;
    onClose();
  }, [open, unavailable, submit.isPending, onClose, openSnackbar]);

  const setLine = (id: string, patch: Partial<ReturnLineState>) =>
    setLines((ls) => ls.map((l) => (l.orderItemId === id ? { ...l, ...patch } : l)));
  const toggleLine = (l: ReturnLineState) => {
    haptic('light');
    setLine(l.orderItemId, { selected: !l.selected });
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="full"
      dismissible={!submit.isPending}
      title="Yêu cầu đổi/trả"
      description={`Trong ${returnDays} ngày từ khi nhận hàng. Chọn đúng sản phẩm và số lượng muốn trả, Tubu phản hồi trong 24h.`}
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {estimated && (
            <div role="status" aria-live="polite" className="tubu-nums" style={{ padding: '8px 12px', borderRadius: 'var(--radius-control)', background: 'var(--color-bg-subtle)' }}>
              <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
                {`Dự kiến hoàn ${formatVnd(estimated.refund)}`}
              </Text>
              <Text variant="caption" tone="tertiary" as="div">
                {[
                  estimated.shipping > 0 ? `gồm ${formatVnd(estimated.shipping)} phí vận chuyển` : null,
                  estimated.pointsUsedBack > 0 ? `hoàn lại ${formatNumber(estimated.pointsUsedBack)} Điểm Xanh đã dùng` : null,
                  'Tubu xác nhận số cuối cùng khi duyệt',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </div>
          )}
          {touched && error && (
            <div role="alert">
              <Text variant="caption" tone="danger" as="div">
                {error}
              </Text>
            </div>
          )}
          <Button
            fullWidth
            loading={submit.isPending}
            disabled={imagesBusy}
            onPress={() => {
              setTouched(true);
              if (!error) submit.mutate();
            }}
          >
            {imagesBusy ? vi.common.imagesUploading : 'Gửi yêu cầu'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <section aria-label="Sản phẩm muốn trả">
          <Text variant="body-sm" as="div" style={{ fontWeight: 600, marginBottom: 4 }}>
            Sản phẩm muốn trả
          </Text>
          {lines.length === 0 && (
            <Text variant="caption" tone="secondary" as="div">
              Mọi sản phẩm của đơn đã được trả.
            </Text>
          )}
          {lines.map((l) => (
            <div key={l.orderItemId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
              <Checkbox
                checked={l.selected}
                aria-label={`Trả ${l.productName} ${l.variationName}`}
                onChange={() => toggleLine(l)}
              />
              {/* Chạm vào tên cũng chọn dòng; bàn phím và trình đọc màn hình dùng ô tick ngay cạnh. */}
              <div onClick={() => toggleLine(l)} style={{ flex: 1, minWidth: 0, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 44, cursor: 'pointer' }}>
                <Text variant="body-sm" as="div">
                  {l.productName}
                </Text>
                <Text variant="caption" tone="tertiary" as="div">
                  {l.variationName} · còn trả được {l.remaining}
                </Text>
              </div>
              {l.selected && l.remaining > 1 && (
                <QuantitySelector size="sm" value={l.quantity} max={l.remaining} onChange={(n) => setLine(l.orderItemId, { quantity: n })} />
              )}
            </div>
          ))}
        </section>

        <section aria-label="Lý do">
          <Text variant="body-sm" as="div" style={{ fontWeight: 600, marginBottom: 6 }}>
            Lý do
          </Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '4px 0' }}>
            {RETURN_REASONS.map((r) => (
              <Chip key={r.code} size="sm" variant="choice" selected={reasonCode === r.code} onPress={() => setReasonCode(r.code)}>
                {r.label}
              </Chip>
            ))}
          </div>
          <textarea
            aria-label="Mô tả thêm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder={reasonCode === 'OTHER' ? 'Mô tả lý do (ít nhất 5 ký tự)…' : 'Mô tả thêm (không bắt buộc)…'}
            rows={3}
            style={{
              width: '100%',
              marginTop: 8,
              padding: 10,
              borderRadius: 'var(--radius-control)',
              border: '1px solid var(--color-border-subtle)',
              fontSize: 14,
              fontFamily: 'inherit',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
        </section>

        <MultiImageUpload value={images} onChange={setImages} onBusyChange={setImagesBusy} disabled={submit.isPending} max={3} label="Ảnh minh chứng (khuyến khích, tối đa 3)" />

        {showsMoney &&
          (bankAllowed ? (
            <RefundDestinationPicker
              method={method}
              onMethod={setMethod}
              bank={bank}
              onBank={setBank}
              showBankErrors={touched}
              amountLabel={estimated ? formatVnd(estimated.refund) : undefined}
            />
          ) : (
            <Text variant="caption" tone="secondary" as="div">
              {placedForCustomer
                ? 'Tiền hoàn của đơn này trả cho khách của bạn (vào Ví Tubu của khách, hoặc Tubu chuyển khoản nếu khách chưa có tài khoản), không vào ví của bạn.'
                : 'Tiền hoàn của đơn này về Ví Tubu ngay khi Tubu duyệt.'}
            </Text>
          ))}
        <Text variant="caption" tone="tertiary" as="div">
          Số tiền hoàn = giá trị sản phẩm trả sau khi trừ phần giảm giá và điểm đã dùng tương ứng. Phí ship chỉ hoàn khi trả cả đơn
          hoặc lỗi do Tubu.
        </Text>
      </div>
    </BottomSheet>
  );
}
