'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Ticket, X } from 'lucide-react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  applyCoupon,
  formatVnd,
  getCouponPreviews,
  getMyCoupons,
  removeCoupon,
  type CouponPreviewParams,
} from '@/lib/shop-client';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { couponNotAppliedNotice } from '@tubutree/app-core/commerce/coupon-notice';
import { pickerRows } from '@tubutree/app-core/commerce/voucher-picker';
import { serverNow } from '@tubutree/app-core/server-clock';
import { BottomSheet } from '@/components/mini/bottom-sheet';
import { EmptyState } from '@/components/mini/empty-state';
import { Skeleton } from '@/components/mini/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { VoucherPicker } from '@/components/mini/voucher-picker';
import { ui } from '@/lib/guest-ui';
import { MD_DOWN, useMediaQuery } from '@/lib/use-media-query';
import { autoCouponMemory, couponAutoCopy, couponHint, couponHintShort, couponHintText, pickBestCoupon } from '@tubutree/app-core/coupon-use';
import { couponMinOrderCopy } from '@tubutree/app-core/coupon-min-order';
import { autoCouponName } from '@/lib/coupon-name';
import { actionErrorText, loadErrorText } from '@/lib/error-text';
import { useAutoDismiss } from '@/lib/use-auto-dismiss';
import { useCartWrite, type CartCommand } from '@/lib/use-cart-write';

/** Số voucher hiện sẵn trong panel tại chỗ (từ md); trong bảng trượt của điện thoại hiện đủ như Mini App. */
const VISIBLE_COUPONS = 3;

/** Chờ lựa chọn/số lượng đứng yên rồi mới hỏi lại mức giảm, để bấm liên tục không chạm giới hạn 30 lần/phút của API. */
export const PREVIEW_DEBOUNCE_MS = 300;

/** Giá trị chỉ đổi sau khi đứng yên `delayMs` (debounce); giỏ dùng chung để hỏi giá phần chọn cùng nhịp với xem trước mã. */
export function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return settled;
}

/**
 * Dấu vân tay các dòng đang tính cho xem trước mức giảm mã: đổi số lượng, giá (giờ vàng) hay dòng là số cũ hết đúng.
 */
export function couponPreviewKey(lines: { id: string; quantity: number; total: number }[]): string {
  return lines.map((l) => `${l.id}:${l.quantity}:${l.total}`).join(',');
}

/** Sản phẩm của các dòng đang tính cho CouponBox; undefined khi API cũ chưa trả `productId` (không khoá mã theo sản phẩm), như `cartProductIds` của Mini. */
export function couponProductIds(lines: { productId?: string }[]): string[] | undefined {
  return lines.every((l) => l.productId) ? lines.map((l) => l.productId!) : undefined;
}

/** Lời báo mã chưa được áp dụng tự tắt sau ngần này, như snackbar cảnh báo của Mini App. */
const APPLY_WARNING_MS = 5000;

/** Khoá mutation dùng chung để trang chứa (thanh toán) biết mã đang được đổi qua `useIsMutating`. */
export const COUPON_MUTATION_KEY = ['cart-coupon'] as const;

/**
 * Chọn/nhập Mã giảm giá cho giỏ hàng — dùng ở giỏ hàng và thanh toán.
 *
 * Web trước đây chỉ HIỂN THỊ `cart.discount` mà không có chỗ nào áp mã, còn Mini App thì có đủ:
 * cùng một giỏ, khách có mã WELCOME30 trong ví mà mua trên web vẫn trả nguyên giá — rồi khiếu
 * nại, CSKH phải huỷ đơn tạo lại. Mã nằm trên giỏ, nên đổi mã xong phải tải lại báo giá thanh toán
 * (`['quote', …]`), nếu không tổng tiền trên màn hình còn là con số cũ.
 */
export function CouponBox({
  currentCode,
  subtotal,
  shippingFee = null,
  notice = null,
  disabled = false,
  preview,
  previewKey,
  actionLabel = 'Chọn mã',
  band = false,
  appliedDiscount = 0,
  autoApply = false,
  memoryUserId,
  sheet = false,
  productIds,
  removedNotice = null,
  onDismissRemoved,
}: {
  /** Lời báo máy chủ vừa gỡ mã khỏi giỏ (đơn tối thiểu, hết hạn, bị tắt). Chỉ hiện khi giỏ chưa có mã; trang giữ trí nhớ và quyết định lúc nào bỏ. */
  removedNotice?: { code: string; text: string } | null;
  /** Khách bấm Đóng ở lời báo gỡ mã; không truyền thì lời báo là chữ thuần, không có nút. */
  onDismissRemoved?: () => void;
  currentCode: string | null;
  subtotal: number;
  /** Phí vận chuyển đã tính của đơn (thanh toán); chưa biết thì null và thẻ freeship không nói được số tiền. */
  shippingFee?: number | null;
  /** Mã đang giữ nhưng chưa áp cho đơn (server giải thích lý do, vd hàng giờ vàng không tính vào điều kiện). */
  notice?: string | null;
  /** Trang chứa đang đặt hàng: đổi mã lúc này làm đơn lấy mã khác với con số khách đã thấy. */
  disabled?: boolean;
  /**
   * Tham số báo giá của lần đặt đang xem (thanh toán: có addressId; giỏ: không). Có thì hỏi máy chủ mức giảm thật từng mã;
   * không có, đang tải hoặc lỗi (API cũ) thì thẻ chỉ ghi điều kiện của mã như trước.
   */
  preview?: CouponPreviewParams;
  /**
   * Dấu vân tay các dòng đang tính (`couponPreviewKey`): `itemIds` không đổi khi đổi số lượng hay khi chọn cả giỏ, nên đổi
   * dấu này là số xem trước cũ hết đúng và phải hỏi lại.
   */
  previewKey?: string;
  /** Chữ bên phải thẻ mã khi chưa áp mã nào: giỏ "Chọn mã", thanh toán cũng "Chọn mã" như Mini App. */
  actionLabel?: string;
  /** Thanh toán: dải phẳng tràn ngang như các khối khác của Mini App thay vì thẻ nổi của giỏ. */
  band?: boolean;
  /** Số đã giảm bởi mã đang áp; thẻ điện thoại ghi cạnh chip mã như Mini App. */
  appliedDiscount?: number;
  /**
   * Thanh toán: tự áp mã giảm nhiều nhất khách đang có, một lần cho mỗi lượt mở màn (khách gỡ rồi thì không áp lại). Chỉ bật
   * khi địa chỉ đã chốt để số xem trước có cả phí giao được miễn. Lỗi thì im lặng.
   */
  autoApply?: boolean;
  /** Khách đang đăng nhập: khoá trí nhớ theo phiên của mã tự áp (tải lại trang không áp lại mã đã gỡ). */
  memoryUserId?: string;
  /**
   * Điện thoại, đặt trong thanh dính đáy của giỏ như StickySummary của Mini App: chỉ còn MỘT hàng gọn (vùng chạm 44), ô nhập và danh sách mã
   * mở trong bảng trượt lên thay vì bung ngay tại chỗ (bung trong thanh dính thì thanh cao quá nửa màn). Chỉ dùng dưới md.
   */
  sheet?: boolean;
  /** Sản phẩm của các dòng đang tính (`couponProductIds`): mã gắn riêng cho sản phẩm khác thì ghi "Chỉ áp cho …" và khoá nút khi chưa có xem trước. Thiếu thì không kiểm. */
  productIds?: string[];
}) {
  const qc = useQueryClient();
  // Điện thoại: danh sách mã nằm trong bảng trượt (đúng VoucherSheet của Mini), không bung tại chỗ làm thanh/khối chứa cao thêm.
  const phone = useMediaQuery(MD_DOWN);
  const inSheet = sheet || phone;
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // Đếm mỗi lần báo lỗi. Lệnh mới xoá lời báo cũ lúc bắt đầu (onMutate), nhưng khi lỗi về ngay trong cùng một lần vẽ với lần xoá đó thì `err` không đổi chữ
  // và lời báo giữ nguyên nút DOM: trình đọc màn hình không đọc lại, bảng không cuộn lại tới lời báo. Số đổi thì lời báo dựng lại (key) và hiệu ứng cuộn chạy lại.
  const [errSeq, setErrSeq] = useState(0);
  const showErr = (text: string) => {
    setErr(text);
    setErrSeq((n) => n + 1);
  };
  const [showAll, setShowAll] = useState(false);
  const [applyWarning, setApplyWarning] = useState<string | null>(null);
  // Lời báo tự tắt nhưng dừng đồng hồ khi trỏ/focus đang ở trên nó (WCAG 2.2.1); `warnSeq` đếm lại khi cùng một chữ được báo lần nữa.
  const [warnSeq, setWarnSeq] = useState(0);
  const warnHold = useAutoDismiss(!!applyWarning, APPLY_WARNING_MS, () => setApplyWarning(null), warnSeq);
  const showApplyWarning = (text: string | null) => {
    setApplyWarning(text);
    setWarnSeq((n) => n + 1);
  };
  // Thu gọn mặc định: ô nhập + danh sách voucher dài hàng trăm px, đẩy nút thanh toán xuống khỏi màn điện thoại.
  const [open, setOpen] = useState(false);
  // Mở hoặc gập bảng xoá lời báo cũ: lời báo chỉ có một chỗ ở mỗi lúc (trong khung ô nhập khi đang mở, cuối khối khi bảng đóng) và không bao giờ nhảy từ nút DOM này sang nút kia,
  // nên trình đọc màn hình không đọc lại lỗi cũ chỉ vì khách mở hay gập.
  const togglePanel = () => {
    setErr(null);
    setOpen((v) => !v);
  };
  const closePanel = () => {
    setErr(null);
    setOpen(false);
  };
  // Lỗi từ bấm "Dùng"/"Bỏ chọn" ở hàng mã phía dưới: lời báo nằm ở đầu bảng nên kéo về tầm nhìn, không thì khách thấy như bấm không có gì xảy ra.
  const errRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (open && err) errRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open, err, errSeq]);
  const couponsQ = useQuery({ queryKey: ['my-coupons'], queryFn: getMyCoupons });
  const previewSig = preview ? JSON.stringify([preview, previewKey ?? '']) : null;
  const settledSig = useSettled(previewSig, PREVIEW_DEBOUNCE_MS);
  const previewsQ = useQuery({
    queryKey: ['coupon-previews', settledSig],
    queryFn: () => getCouponPreviews((JSON.parse(settledSig!) as [CouponPreviewParams, string])[0]),
    // Ví không có mã nào thì không có gì để tính: khỏi gọi máy chủ mỗi lần đổi giỏ.
    enabled: !!settledSig && (!currentCode || open) && (couponsQ.data?.length ?? 0) > 0,
    retry: false,
  });
  // Số chỉ đúng cho đúng giỏ đã hỏi: giỏ vừa đổi (chưa hỏi lại) hoặc đang tải lại thì quay về phép đoán phía máy, không hiện số cũ.
  const previewTrusted =
    !!previewSig && settledSig === previewSig && previewsQ.isSuccess && !previewsQ.isFetching;
  const previews = new Map(
    (previewTrusted ? (previewsQ.data ?? []) : []).map((p) => [p.code.toUpperCase(), p]),
  );
  // Dòng thu gọn nhắc khách đang có mã dùng được (chỉ gợi ý, không tự áp); dùng chính số xem trước đã hỏi ở trên.
  const hint = !currentCode && previewTrusted ? couponHint(previewsQ.data) : null;

  const memory = useMemo(() => autoCouponMemory(browserSession(), memoryUserId), [memoryUserId]);
  const [autoCode, setAutoCode] = useState<string | null>(() => memory.applied());
  const autoSettled = useRef(memory.off());
  // Khách về sau lần dựng đầu hoặc đổi tài khoản: đọc lại trí nhớ của khách đó.
  useEffect(() => {
    autoSettled.current = memory.off();
    setAutoCode(memory.applied());
  }, [memory]);
  // Mã trên giỏ khác mã đã tự áp (khách đổi hoặc gỡ ở đâu đó): quên mã tự áp và không tự áp nữa.
  useEffect(() => {
    const stored = memory.applied();
    if (currentCode) {
      autoSettled.current = true;
      if (stored && stored !== currentCode.toUpperCase()) {
        memory.markOff();
        setAutoCode(null);
      }
    } else if (stored) {
      memory.markOff();
      autoSettled.current = true;
      setAutoCode(null);
    }
  }, [currentCode, memory]);
  const cartWrite = useCartWrite();
  // Lệnh đổi mã trả NGUYÊN giỏ như lệnh dòng: ghi chung một đường để phản hồi về lệch thứ tự không đè số lượng vừa đổi. Trả lời hứa tải lại (khi có lệnh chồng) cho `onSuccess`.
  const afterChange = (cart: Awaited<ReturnType<typeof applyCoupon>>, cmd: CartCommand) => {
    const held = cartWrite.write(cmd, cart);
    void qc.invalidateQueries({ queryKey: ['quote'] });
    return held;
  };
  // Khoá đồng bộ dùng chung cho áp và gỡ: `busy` (state) chỉ đúng sau lần vẽ kế nên hai cú bấm sát nhau vẫn đều gọi API, hoặc gỡ chồng lên lần áp đang chạy.
  const changingRef = useRef(false);
  const releaseChange = () => {
    changingRef.current = false;
  };
  const apply = useMutation({
    mutationKey: COUPON_MUTATION_KEY,
    mutationFn: (c: string) => applyCoupon(c.trim().toUpperCase()),
    // Lời báo cũ biến mất ngay khi thử lại, như VoucherSheet của Mini: khách thấy lần thử mới đang chạy chứ không nhìn lỗi cũ.
    onMutate: () => {
      setErr(null);
      return cartWrite.begin();
    },
    onSuccess: (cart, appliedCode, cmd) => {
      setErr(null);
      setCode('');
      setOpen(false);
      // Mã freeship giỏ coi là hợp lệ nhưng xem trước của máy chủ nói không miễn được gì (đơn đã miễn phí giao): nói đúng câu
      // thanh toán sẽ nói thay vì để chip mã hiện như đã áp. Mã giữ nhưng chưa giảm đã có `notice` của giỏ.
      const pv = previews.get(appliedCode.trim().toUpperCase());
      const heldOnly = !!cart.couponNotice && cart.discount === 0 && !cart.freeship && pv?.eligible !== true;
      showApplyWarning(
        !heldOnly && pv && !pv.eligible && pv.reason && cart.discount === 0
          ? couponNotAppliedNotice(pv.reason)
          : null,
      );
      return afterChange(cart, cmd);
    },
    onError: (e, _code, cmd) => {
      cartWrite.fail(cmd);
      showErr(actionErrorText(e));
      // Khách có thể đã thu gọn trong lúc chờ: đưa ô nhập ra lại để sửa mã.
      setOpen(true);
    },
    onSettled: releaseChange,
  });
  const drop = useMutation({
    mutationKey: COUPON_MUTATION_KEY,
    mutationFn: removeCoupon,
    onMutate: () => {
      setErr(null);
      return cartWrite.begin();
    },
    onSuccess: (cart, _vars, cmd) => {
      showApplyWarning(null);
      memory.markOff();
      setAutoCode(null);
      return afterChange(cart, cmd);
    },
    onError: (e, _vars, cmd) => {
      cartWrite.fail(cmd);
      showErr(actionErrorText(e));
    },
    onSettled: releaseChange,
  });
  const autoApplyMut = useMutation({
    mutationKey: COUPON_MUTATION_KEY,
    mutationFn: (c: string) => applyCoupon(c),
    onMutate: () => cartWrite.begin(),
    onSuccess: (cart, appliedCode, cmd) => {
      memory.markApplied(appliedCode);
      setAutoCode(appliedCode.toUpperCase());
      return afterChange(cart, cmd);
    },
    onError: (_e, _code, cmd) => {
      cartWrite.fail(cmd);
    },
  });
  // `working`: lệnh đổi mã của chính hộp này đang chạy (nút giữ focus: aria-busy + aria-disabled, không `disabled` thật vì Chromium thả focus về body).
  // `disabled`: trang chứa đang đặt hàng, khoá thật như trước.
  const working = apply.isPending || drop.isPending || autoApplyMut.isPending;
  const busy = working || disabled;
  // Lệnh đổi mã từ nơi khác còn bay (nút áp mã ở giỏ rồi chuyển sang thanh toán) cũng dùng COUPON_MUTATION_KEY: không gửi lệnh thứ hai chồng lên nó.
  const couponMutating = useIsMutating({ mutationKey: COUPON_MUTATION_KEY });
  const changeCoupon = (run: () => void) => {
    if (changingRef.current || autoApplyMut.isPending || couponMutating > 0) return;
    changingRef.current = true;
    run();
  };
  const applyCode = (c: string) => changeCoupon(() => apply.mutate(c));
  const dropCode = () => changeCoupon(() => drop.mutate());
  // Spinner của "Áp dụng" chỉ quay khi chính mã gõ tay đang được áp; mã bấm từ danh sách thì chỉ khoá nút này.
  const applyingCustom = apply.isPending && apply.variables?.trim().toUpperCase() === code.trim().toUpperCase();
  const autoMutate = autoApplyMut.mutate;
  useEffect(() => {
    if (!autoApply || !memoryUserId || autoSettled.current || currentCode || !previewTrusted || couponMutating > 0) return;
    autoSettled.current = true;
    const best = pickBestCoupon(previewsQ.data, couponsQ.data);
    if (best) autoMutate(best);
  }, [autoApply, memoryUserId, memory, currentCode, previewTrusted, previewsQ.data, couponsQ.data, autoMutate, couponMutating]);
  const isAuto = !!autoCode && currentCode?.toUpperCase() === autoCode;
  const panelAria = inSheet ? ({ 'aria-haspopup': 'dialog' } as const) : ({ 'aria-expanded': open, 'aria-controls': 'coupon-panel' } as const);

  const rows = pickerRows(couponsQ.data ?? [], { currentCode, subtotal, shippingFee, productIds, previews, now: serverNow(), displayCode: autoCouponName });
  const appliedRow = rows.find((r) => r.applied);
  const shownRows = inSheet || showAll ? rows : rows.slice(0, VISIBLE_COUPONS);
  // Nút đang quay: mã đang áp, hoặc hàng đang dùng khi đang gỡ; mã nhập tay không có hàng nào khớp.
  const pendingCode = apply.isPending ? (apply.variables ?? null) : drop.isPending ? (appliedRow?.coupon.code ?? null) : null;

  const panelBody = (
    <>
      {currentCode && !appliedRow && (
        <button
          type="button"
          onClick={dropCode}
          disabled={disabled}
          aria-disabled={working || undefined}
          aria-busy={drop.isPending || undefined}
          className={`${ui.btnText} mb-2 text-danger-fg`}
        >
          Bỏ mã đang áp dụng
        </button>
      )}
      <div className="rounded-card border border-[color:var(--color-border-subtle)] bg-[color:var(--color-bg-canvas)] p-3">
        <label htmlFor="coupon-code" className="mb-2 block text-field-label text-[color:var(--color-text-secondary)]">
          {fillCopy('coupon.pickManual')}
        </label>
        <div className="flex gap-2">
          <input
            id="coupon-code"
            name="coupon-code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (err) setErr(null);
            }}
            onKeyDown={(e) => {
              // Enter áp mã như nút "Áp dụng". Bỏ qua khi bộ gõ tiếng Việt đang chốt chữ (Telex/VNI dùng Enter để chốt) để không áp mã dở,
              // và khi khách giữ phím (`repeat`): mã sai thì mỗi lần lặp phím lại gửi một yêu cầu.
              if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
              e.preventDefault();
              if (e.repeat) return;
              if (code.trim() && !busy) applyCode(code);
            }}
            placeholder={fillCopy('coupon.pickPlaceholder')}
            autoCapitalize="characters"
            autoComplete="off"
            className={`${ui.field} min-w-0 flex-1`}
          />
          <button
            type="button"
            onClick={() => applyCode(code)}
            disabled={!code.trim() || disabled}
            aria-disabled={working || undefined}
            aria-busy={applyingCustom || undefined}
            className={`${ui.btnPrimary} min-w-[7.5rem] px-4`}
          >
            {fillCopy('coupon.pickApply')}
          </button>
        </div>
        {/* Lời báo mã sai/hết hạn nằm ngay dưới ô nhập khi bảng/panel đang mở. Đặt sau cả danh sách mã thì ở bảng 320x568 và ở thẻ tóm tắt dính 1440x900 nó nằm ngoài tầm nhìn, khách thấy như bấm không có gì xảy ra. */}
        {open && err && (
          <p key={errSeq} ref={errRef} role="alert" className="mt-2 text-caption text-danger-fg">
            {err}
          </p>
        )}
      </div>
      <p className="mb-2.5 mt-4 text-label font-semibold text-[color:var(--color-text-secondary)]">{fillCopy('coupon.pickMine')}</p>
      {/* Bảng trượt và panel tại chỗ (từ md) cùng một thân như VoucherSheet của Mini: ví đang tải có khung chờ, ví lỗi có "Thử lại", ví trống có lời mời. Panel đóng thì thân ẩn nên không tốn chiều cao. */}
      {couponsQ.isLoading && (
        <div role="status" aria-label={fillCopy('coupon.pickLoading')} className="flex flex-col gap-2.5">
          <Skeleton height={72} radius="var(--radius-card)" />
          <Skeleton height={72} radius="var(--radius-card)" />
        </div>
      )}
      {couponsQ.isError && (
        <ErrorState variant="inline" message={fillCopy('coupon.pickLoadError', { reason: loadErrorText(couponsQ.error) })} onRetry={() => couponsQ.refetch()} />
      )}
      {!couponsQ.isError && rows.length > 0 && (
        <>
          <VoucherPicker rows={shownRows} onUse={applyCode} onRemove={dropCode} busy={busy} pendingCode={pendingCode} />
          {!inSheet && rows.length > VISIBLE_COUPONS && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className={`${ui.btnText} mt-1 text-[color:var(--color-text-brand)]`}>
              {showAll ? 'Thu gọn' : `Xem thêm ${rows.length - VISIBLE_COUPONS} mã`}
            </button>
          )}
        </>
      )}
      {couponsQ.isSuccess && rows.length === 0 && (
        <div className="mt-2">
          <EmptyState variant="inline" art="leaf" heading={fillCopy('coupon.pickEmptyTitle')} body={fillCopy('coupon.pickEmptyBody')} />
        </div>
      )}
      {!inSheet && <p className="mt-2 text-caption text-[color:var(--color-text-tertiary)]">{fillCopy('coupon.oneCodeHint')}</p>}
    </>
  );

  // Điện thoại trong thanh dính: đúng CouponRow của Mini (pages/cart.tsx), hàng 44px. Nhãn 14px đậm 500, gợi ý và chữ phải 13px (Text small
  // và xSmall của zmp-ui). Gạch chân là bóng trong như Mini nên dòng không cao thêm 1px vì viền. Hết chỗ thì nội dung xuống dưới nhãn (hai dòng vẫn 44px).
  const sheetRow = (
    <button
      type="button"
      onClick={togglePanel}
      aria-haspopup="dialog"
      data-testid="coupon-row"
      className="tubu-press flex min-h-11 w-full items-center justify-between gap-2 text-left shadow-[inset_0_-1px_0_var(--color-border-subtle)]"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <Ticket className="h-5 w-5 flex-none text-promo-fg" aria-hidden="true" />
        {/* Nhãn và nội dung cùng một dòng khi đủ chỗ; máy hẹp (320px) thì nội dung xuống dòng dưới nhãn, thay vì bị cắt "…" hay vỡ ba dòng. Hai dòng vẫn gọn trong 44px. */}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
          <span data-testid="coupon-label" className="flex-none text-sm font-medium text-[color:var(--color-text-primary)]">Mã giảm giá</span>
          {currentCode ? (
            <span className="flex min-w-0 items-center gap-2">
              <span
                data-testid="coupon-code"
                className="min-w-0 max-w-full rounded-control border border-dashed border-promo-solid bg-promo-bg px-1.5 py-0.5 text-label font-bold text-promo-fg [overflow-wrap:anywhere]"
              >
                {currentCode}
              </span>
              {appliedDiscount > 0 && (
                <span data-testid="coupon-discount" className="shrink-0 whitespace-nowrap text-caption font-normal text-success-fg">
                  -{formatVnd(appliedDiscount)}
                </span>
              )}
            </span>
          ) : (
            <span
              data-testid={hint ? 'coupon-hint' : 'coupon-placeholder'}
              className={`min-w-0 text-caption font-normal ${
                hint ? 'text-[color:var(--color-text-brand)] leading-4' : 'leading-4 text-[color:var(--color-text-tertiary)]'
              }`}
            >
              {hint ? couponHintShort(hint) : fillCopy('coupon.rowInvite')}
            </span>
          )}
        </span>
      </span>
      <span data-testid="coupon-cta" className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-caption font-medium text-[color:var(--color-text-brand)]">
        {currentCode ? 'Thay đổi' : actionLabel}
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </span>
    </button>
  );

  return (
    <div
      className={
        sheet
          ? undefined
          : `mt-3 border-t border-[color:var(--color-border-subtle)] pt-3 max-md:mt-0 max-md:border-t-0 max-md:bg-[var(--color-bg-surface)] ${
              band ? 'max-md:p-4' : 'max-md:rounded-card max-md:p-3 max-md:shadow-[var(--elevation-1)]'
            }`
      }
    >
      {sheet ? (
        sheetRow
      ) : currentCode ? (
        <>
          <div className="flex items-center justify-between rounded-control border border-dashed border-promo-solid bg-promo-bg pl-3 max-md:hidden">
            <span className="flex items-center gap-2 text-sm font-semibold text-promo-fg">
              <Ticket className="h-4 w-4" aria-hidden="true" /> {currentCode}
            </span>
            <span className="flex items-center">
              <button
                type="button"
                onClick={togglePanel}
                {...panelAria}
                className="inline-flex min-h-11 items-center gap-0.5 px-2 text-caption font-medium text-[color:var(--color-text-brand)]"
              >
                {fillCopy('checkout.changeCode')}
                <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={dropCode}
                disabled={disabled}
                aria-disabled={working || undefined}
                aria-busy={drop.isPending || undefined}
                aria-label={`Bỏ mã giảm giá ${currentCode}`}
                className="flex h-11 w-11 items-center justify-center text-promo-fg disabled:opacity-50 aria-disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </span>
          </div>
          <button
            type="button"
            onClick={togglePanel}
            {...panelAria}
            data-testid="coupon-change"
            className="tubu-press flex min-h-11 w-full items-center justify-between gap-2 text-left md:hidden"
          >
            <span className="inline-flex min-w-0 flex-1 items-center gap-2">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-control bg-promo-bg">
                <Ticket className="h-5 w-5 text-promo-fg" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-col text-sm font-semibold text-[color:var(--color-text-primary)]">
                <span data-testid="coupon-label">Mã giảm giá</span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span data-testid="coupon-code" className="min-w-0 max-w-full rounded-control border border-dashed border-promo-solid bg-promo-bg px-1.5 py-0.5 text-label font-bold text-promo-fg [overflow-wrap:anywhere]">
                    {currentCode}
                  </span>
                  {appliedDiscount > 0 && (
                    <span data-testid="coupon-discount" className="shrink-0 whitespace-nowrap text-caption font-normal text-success-fg">
                      -{formatVnd(appliedDiscount)}
                    </span>
                  )}
                </span>
              </span>
            </span>
            <span data-testid="coupon-cta" className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-caption font-medium text-[color:var(--color-text-brand)]">
              Thay đổi
              <ChevronRight
                className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`}
                aria-hidden="true"
              />
            </span>
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={togglePanel}
          {...panelAria}
          data-testid="coupon-row"
          className="tubu-press flex min-h-11 w-full items-center justify-between gap-2 text-left text-sm font-semibold text-[color:var(--color-text-primary)]"
        >
          <span className="inline-flex items-center gap-2 max-md:gap-2.5">
            <span className="max-md:grid max-md:h-9 max-md:w-9 max-md:flex-none max-md:place-items-center max-md:rounded-control max-md:bg-promo-bg">
              <Ticket
                className="h-4 w-4 text-promo-fg max-md:h-5 max-md:w-5 max-md:text-promo-fg"
                aria-hidden="true"
              />
            </span>
            <span className="flex flex-col">
              <span data-testid="coupon-label">Mã giảm giá</span>
              {hint ? (
                <span data-testid="coupon-hint" className="text-caption font-normal text-[color:var(--color-text-brand)]">
                  {couponHintText(hint, formatVnd)}
                </span>
              ) : (
                <span data-testid="coupon-placeholder" className="text-caption font-normal text-[color:var(--color-text-tertiary)]">
                  {fillCopy('coupon.rowInvite')}
                </span>
              )}
            </span>
          </span>
          <span data-testid="coupon-cta" className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-caption font-medium text-[color:var(--color-text-brand)]">
            {actionLabel}
            <ChevronRight
              className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
          </span>
        </button>
      )}
      {inSheet ? (
        <BottomSheet open={open} onClose={closePanel} title={fillCopy('coupon.pickTitle')} description={fillCopy('coupon.oneCodeHint')}>
          <div id="coupon-panel">
            {panelBody}
          </div>
        </BottomSheet>
      ) : (
        (!currentCode || open) && (
          <div id="coupon-panel" hidden={!open}>
            {panelBody}
          </div>
        )
      )}
      {isAuto && (
        <div className="mt-1 flex items-center justify-between max-md:pl-[46px]">
          <span data-testid="coupon-auto-label" className="text-caption text-success-fg">
            {couponAutoCopy.applied}
          </span>
          <button
            type="button"
            data-testid="coupon-auto-remove"
            onClick={dropCode}
            disabled={disabled}
            aria-disabled={working || undefined}
            aria-busy={drop.isPending || undefined}
            aria-label={couponAutoCopy.removeAria(currentCode!)}
            className="min-h-11 min-w-11 px-2 text-caption font-semibold text-[color:var(--color-text-brand)] disabled:opacity-50 aria-disabled:opacity-50"
          >
            {couponAutoCopy.remove}
          </button>
        </div>
      )}
      {/* Vùng báo luôn có mặt trong cây, chỉ đổi phần con: vùng live vừa gắn cùng chữ thường không được đọc ra. */}
      <div role="status">
        {currentCode && notice && (
          <p data-testid="coupon-notice" className="mt-2 text-caption text-warning-fg">
            {notice}
          </p>
        )}
        {applyWarning && !(currentCode && notice) && (
          <p data-testid="coupon-apply-warning" {...warnHold} className="mt-2 text-caption text-warning-fg">
            {applyWarning}
          </p>
        )}
        {!currentCode && removedNotice && (
          <div data-testid="coupon-removed-notice" className="mt-2 flex items-start gap-2 text-caption text-warning-fg">
            <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">{removedNotice.text}</p>
            {onDismissRemoved && (
              <button
                type="button"
                onClick={onDismissRemoved}
                aria-label={couponMinOrderCopy.dismissAria(removedNotice.code)}
                className="min-h-11 min-w-11 flex-none px-2 text-caption font-semibold text-[color:var(--color-text-brand)]"
              >
                {couponMinOrderCopy.dismiss}
              </button>
            )}
          </div>
        )}
      </div>
      {err && !open && (
        <p key={errSeq} role="alert" className="mt-2 text-caption text-danger-fg">
          {err}
        </p>
      )}
    </div>
  );
}

/** Đặt đơn xong: lượt thanh toán sau bắt đầu lại, mã tự áp của lượt này không còn được nhớ. */
export function forgetAutoCoupon(userId: string | undefined): void {
  autoCouponMemory(browserSession(), userId).clear();
}

function browserSession(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
