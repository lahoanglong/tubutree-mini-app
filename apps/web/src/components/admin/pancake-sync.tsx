'use client';

import { useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isPancakeForbiddenError } from '@tubutree/shared-types';
import { retryPancakePush, type AdminOrder } from '@/lib/admin-client';
import type { Tone } from '@/lib/recycling';
import { formatDateTime } from '@/lib/format-date';
import { BTN_XS_SECONDARY, ToneBadge } from './ui';
import { useConfirm } from './confirm-dialog';
import { PANCAKE_ATTENTION_COUNT_KEY } from './pancake-attention';
import { actionErrorText } from '@/lib/admin-error-text';

/** Trạng thái đơn Tubu còn trong kho — chỉ những đơn này được "Đẩy lại Pancake" (API chặn lần nữa). */
const IN_WAREHOUSE = new Set(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED']);

export interface PancakeSyncState {
  tone: Tone;
  label: string;
  /** Hiện ở danh sách đơn (đơn cần để mắt tới); trạng thái bình thường chỉ hiện trong chi tiết. */
  flag: boolean;
}

/**
 * Đơn REJECTED vì 401/403 riêng đơn vẫn nằm trong lô tự đẩy của cron (mỗi giờ, tới 72 giờ): người tạo tay đơn kho rồi cron tạo nữa là
 * hai đơn kho, giao và thu COD hai lần. Nên không bao giờ khuyên tạo tay ở đây.
 */
export const PANCAKE_FORBIDDEN_GUIDE =
  'Pancake từ chối quyền cho riêng đơn này (khoá API vẫn đẩy được đơn khác). Không tạo tay đơn này trên Pancake: hệ thống vẫn tự thử lại mỗi giờ (tới 72 giờ), làm vậy sẽ thành hai đơn kho. Kiểm tra trang/kho/sản phẩm của đơn trên Pancake hoặc báo kỹ thuật.';

/**
 * Đơn quá cửa sổ tự đẩy (STALE): không đường tự động nào đẩy nữa (API: pushOrder bỏ qua đơn STALE), kho có thể đã giao tay. Khớp câu
 * "Cần xử lý Pancake" của cron markOverdue.
 */
export const PANCAKE_STALE_GUIDE =
  'Đơn quá hạn tự đẩy: hệ thống đã ngừng tự đẩy đơn này (kể cả khi khách trả tiền sau). Kiểm tra kho đã giao tay chưa; chưa thì bấm "Đẩy lại Pancake". Không làm cả hai, kẻo kho giao hai lần.';

/** Đơn STALE mà admin không "Đẩy lại" được (đã rời kho, còn hàng đặt trước): không có nút nên không bảo bấm. */
export const PANCAKE_STALE_NO_RETRY_GUIDE =
  'Đơn quá hạn tự đẩy: hệ thống đã ngừng tự đẩy đơn này (kể cả khi khách trả tiền sau) và đơn không còn ở trạng thái cho phép đẩy lại (đã rời kho, hoặc còn hàng đặt trước), nên không có nút đẩy lại. Kiểm tra kho đã giao tay chưa.';

/** Loại lỗi đẩy (API: pancake-push-error.ts) → nhãn ngắn ở danh sách. */
const KIND_LABEL: Record<string, { tone: Tone; label: string }> = {
  DATA: { tone: 'danger', label: 'Pancake: thiếu dữ liệu đơn' },
  REJECTED: { tone: 'danger', label: 'Pancake: từ chối dữ liệu đơn' },
  CONFIG: { tone: 'danger', label: 'Pancake: sai khoá API' },
  CONFIG_RECHECK: { tone: 'warning', label: 'Pancake: chờ thử lại sau khi khoá đã đẩy được đơn khác' },
  TRANSIENT: { tone: 'warning', label: 'Pancake: tạm lỗi, tự thử lại' },
};

export interface PancakeErrorGuide {
  kind: string;
  text: string;
  /** Khoá API sai: mọi đơn cùng lỗi, hệ thống chỉ dò bằng một đơn mỗi giờ; bấm đẩy lại từng đơn không giúp gì tới khi sửa khoá. */
  configBlocked: boolean;
}

/** HH:MM giờ Việt Nam của mốc ISO. */
const clock = (iso: string) => formatDateTime(iso).slice(0, 5);

/** Câu hướng dẫn cho admin theo loại lỗi đẩy; null khi đơn đã lên Pancake hoặc chưa có loại lỗi. */
export function pancakeErrorGuide(order: AdminOrder): PancakeErrorGuide | null {
  if (order.pancakeOrderId) return null;
  if (order.pancakePushStatus === 'STALE') {
    return { kind: 'STALE', configBlocked: false, text: canRetryPancakePush(order) ? PANCAKE_STALE_GUIDE : PANCAKE_STALE_NO_RETRY_GUIDE };
  }
  if (!order.pancakeErrorKind || !KIND_LABEL[order.pancakeErrorKind]) return null;
  const kind = order.pancakeErrorKind;
  switch (kind) {
    case 'DATA':
      return { kind, configBlocked: false, text: 'Thiếu dữ liệu đơn để tạo đơn kho: sửa thông tin người nhận của đơn rồi bấm "Đẩy lại Pancake".' };
    case 'REJECTED':
      return {
        kind,
        configBlocked: false,
        text: isPancakeForbiddenError(order.pancakeSyncError)
          ? PANCAKE_FORBIDDEN_GUIDE
          : 'Pancake từ chối dữ liệu đơn: sửa dữ liệu theo lỗi bên dưới rồi bấm "Đẩy lại Pancake".',
      };
    case 'CONFIG_RECHECK':
      return {
        kind,
        configBlocked: false,
        text: order.pancakeNextRetryAt
          ? `Khoá API đã đẩy được đơn khác: hệ thống thử lại đơn này tới ${clock(order.pancakeNextRetryAt)}. Lại bị từ chối thì đó là lỗi riêng của đơn.`
          : 'Khoá API đã đẩy được đơn khác nhưng hệ thống không còn tự thử lại đơn này: bấm "Đẩy lại Pancake".',
      };
    case 'CONFIG':
      return {
        kind,
        configBlocked: true,
        text: 'Khoá API Pancake sai hoặc hết hạn: báo kỹ thuật kiểm tra cấu hình. Hệ thống tạm dừng thử lại các đơn này, chỉ dò bằng một đơn mỗi giờ; đừng bấm đẩy lại từng đơn.',
      };
    default:
      return {
        kind,
        configBlocked: false,
        text: order.pancakeNextRetryAt
          ? `Pancake tạm lỗi: hệ thống tự thử lại tới ${clock(order.pancakeNextRetryAt)}.`
          : 'Pancake tạm lỗi: hệ thống không còn tự thử lại đơn này, bấm "Đẩy lại Pancake" khi Pancake ổn.',
      };
  }
}

/**
 * Đơn đại lý còn hàng đặt trước: chỉ lên kho khi đủ hàng (API: dealer-awaiting-stock.ts). Có dòng hàng thì tin dòng
 * hàng — cờ WAITING_STOCK có thể còn sót sau khi đã lấp đủ mà lệnh đẩy chưa chạy.
 */
function awaitingStock(order: AdminOrder): boolean {
  if (!order.items) return order.pancakePushStatus === 'WAITING_STOCK';
  return order.type === 'DEALER' && order.items.some((i) => (i.backorderedQty ?? 0) > 0);
}

/** Đơn gian hàng đối tác tự giao: kho Tubu không giao nên không bao giờ lên Pancake (API chặn đẩy/huỷ). */
export function isMerchantFulfilled(order: AdminOrder): boolean {
  return order.fulfiller === 'MERCHANT';
}

/** Tình trạng đồng bộ đơn với kho Pancake, theo các cột PancakeOrderService ghi. */
export function pancakeSyncState(order: AdminOrder): PancakeSyncState | null {
  if (isMerchantFulfilled(order)) return null;
  switch (order.pancakeCancelStatus) {
    case 'PENDING':
      return { tone: 'warning', label: 'Pancake: đang chờ huỷ', flag: true };
    case 'FAILED':
      return { tone: 'danger', label: 'Pancake: chưa huỷ được', flag: true };
    case 'TOO_LATE':
      return { tone: 'danger', label: 'Pancake: đã giao vận chuyển', flag: true };
    case 'CANCELLED':
      return { tone: 'neutral', label: 'Pancake: đã huỷ', flag: false };
    case 'NOT_FOUND':
      return null;
  }
  if (order.pancakeOrderId) return { tone: 'success', label: 'Đã lên Pancake', flag: false };
  if (IN_WAREHOUSE.has(order.status) && awaitingStock(order)) {
    return { tone: 'neutral', label: 'Pancake: chờ đủ hàng', flag: false };
  }
  const kind = !order.pancakeOrderId && order.pancakeErrorKind ? KIND_LABEL[order.pancakeErrorKind] : undefined;
  switch (order.pancakePushStatus) {
    case 'FAILED':
      return { tone: kind?.tone ?? 'danger', label: kind?.label ?? 'Pancake: đẩy lỗi', flag: true };
    case 'STALE':
      return { tone: 'warning', label: 'Pancake: quá hạn tự đẩy', flag: true };
    case 'NOT_CONFIGURED':
      return { tone: 'warning', label: 'Pancake: chưa cấu hình', flag: true };
    case 'PENDING':
    case 'PUSHING':
      return kind && order.pancakeSyncError
        ? { tone: kind.tone, label: kind.label, flag: true }
        : { tone: 'info', label: 'Pancake: đang đẩy', flag: Boolean(order.pancakeSyncError) };
    case 'WAITING_PAYMENT':
      return { tone: 'neutral', label: 'Pancake: chờ thanh toán', flag: false };
    default:
      return null;
  }
}

export function canRetryPancakePush(order: AdminOrder): boolean {
  if (isMerchantFulfilled(order) || order.pancakeOrderId || !IN_WAREHOUSE.has(order.status)) return false;
  return order.pancakePushStatus !== 'WAITING_PAYMENT' && !awaitingStock(order);
}

export function PancakeSyncBadge({ order }: { order: AdminOrder }) {
  const s = pancakeSyncState(order);
  if (!s?.flag) return null;
  return (
    <ToneBadge tone={s.tone} title={order.pancakeSyncError ?? undefined}>
      {s.label}
    </ToneBadge>
  );
}

/** Dòng "Kho Pancake" trong chi tiết đơn: trạng thái, lỗi gần nhất, nút "Đẩy lại Pancake". */
export function PancakeSyncPanel({ order }: { order: AdminOrder }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inFlight = useRef(false);
  const { confirm, dialog } = useConfirm();

  const retry = useMutation({
    mutationFn: () => retryPancakePush(order.id),
    onSuccess: (r) => {
      setMsg({ ok: true, text: r.message });
      void qc.invalidateQueries({ queryKey: ['admin-orders'] });
      void qc.invalidateQueries({ queryKey: PANCAKE_ATTENTION_COUNT_KEY });
    },
    onError: (e: unknown) => setMsg({ ok: false, text: actionErrorText(e) }),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const s = pancakeSyncState(order);
  const showRetry = canRetryPancakePush(order);
  const guide = pancakeErrorGuide(order);
  if (isMerchantFulfilled(order)) {
    return (
      <section aria-label="Kho Pancake" className="rounded-card border border-stone-200 bg-stone-0 p-3 text-xs">
        <span className="font-semibold uppercase text-stone-500">Kho Pancake:</span>{' '}
        <span className="text-stone-600">
          Không áp dụng — {order.fulfillerStorefront?.title ?? 'gian hàng đối tác'} tự giao đơn này.
        </span>
      </section>
    );
  }
  if (!s && !showRetry && !msg) return null;

  const onRetry = async () => {
    if (inFlight.current || retry.isPending) return;
    const ok = await confirm({
      title: 'Đẩy lại Pancake',
      message: guide?.configBlocked
        ? `Khoá API Pancake đang bị từ chối. Chỉ bấm khi kỹ thuật đã sửa khoá; đơn ${order.code} sẽ được gửi lại đúng một lần.`
        : `Gửi lại đơn ${order.code} sang kho Pancake. Chỉ bấm khi kho chưa giao tay/tạo tay đơn này.`,
      confirmLabel: 'Đẩy lại',
    });
    if (!ok || inFlight.current) return;
    inFlight.current = true;
    setMsg(null);
    retry.mutate();
  };

  return (
    <section aria-label="Kho Pancake" className="rounded-card border border-stone-200 bg-stone-0 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold uppercase text-stone-500">Kho Pancake:</span>
        {s && <ToneBadge tone={s.tone}>{s.label}</ToneBadge>}
        {order.pancakeOrderId && <span className="text-stone-600">Mã đơn Pancake #{order.pancakeOrderId}</span>}
        {!order.pancakeOrderId && !!order.pancakePushAttempts && (
          <span className="text-stone-600">
            {order.pancakePushAttempts} lần thử
            {order.pancakeLastAttemptAt ? `, gần nhất ${formatDateTime(order.pancakeLastAttemptAt)}` : ''}
          </span>
        )}
        {showRetry && (
          <button type="button" onClick={onRetry} disabled={retry.isPending} className={`${BTN_XS_SECONDARY} inline-flex items-center gap-1 sm:ml-auto`}>
            <RefreshCw className={`h-3 w-3 ${retry.isPending ? 'animate-spin' : ''}`} aria-hidden />
            {retry.isPending ? 'Đang xếp lệnh…' : 'Đẩy lại Pancake'}
          </button>
        )}
      </div>
      {guide && (
        <p className="mt-1 break-words font-medium text-stone-800" data-testid="pancake-error-guide">
          {guide.text}
        </p>
      )}
      {guide && !guide.configBlocked && !order.pancakeOrderId && order.pancakePushStatus !== 'STALE' && (
        <p className="mt-1 text-stone-600">
          {order.pancakeNextRetryAt ? `Lần tự thử kế tiếp: ${formatDateTime(order.pancakeNextRetryAt)}.` : 'Không còn lần tự thử nào: bấm "Đẩy lại Pancake" sau khi xử lý.'}
        </p>
      )}
      {order.pancakeSyncError && (
        <p className="mt-1 break-words text-danger-fg">
          <span className="font-medium">Lỗi gần nhất:</span> {order.pancakeSyncError}
        </p>
      )}
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
          {msg.text}
        </p>
      )}
      {dialog}
    </section>
  );
}
