'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GUEST_LOOKUP_LIMIT, GUEST_ORDER_CLAIMED } from '@tubutree/shared-types';
import { parseVnContactPhone, parseVnPhoneInput } from '@tubutree/app-core/phone-input';
import { GuestField } from '@/components/checkout/guest-field';
import { PageHeader } from '@/components/ui/page-header';
import { mini } from '@/components/order-mobile/mobile-ui';
import { ApiError } from '@/lib/client-api';
import { actionErrorText } from '@/lib/error-text';
import { ui } from '@/lib/guest-ui';
import { guestLookupOrder } from '@/lib/guest-checkout/api';
import { guestCopy } from '@/lib/guest-checkout/copy';
import { GUEST_ORDER_CODE_RE } from '@/lib/guest-checkout/support';
import { orderDetailHref } from '@/lib/order-view';
import { loginHref } from '@/lib/return-to';
import { GuestSupportLink } from './guest-support-link';

const CODE_MAX = 40;

/** Mã đơn khách gõ hay dán từ tin nhắn: bỏ mọi khoảng trắng, dấu # ở đầu và viết hoa (API chuẩn hoá y hệt). */
export function normalizeOrderCode(raw: string): string {
  return raw.replace(/\s+/g, '').replace(/^#+/, '').toUpperCase();
}

function lookupErrorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) return guestCopy('lookupNotFound');
  if (error instanceof ApiError && error.status === 429) {
    // Câu của máy chủ ghi đúng số phút còn phải chờ (trần mã/IP 1 phút, trần SĐT 15 phút); không có mã thì câu cố định.
    return error.code === GUEST_LOOKUP_LIMIT && error.message ? error.message : guestCopy('lookupTooMany');
  }
  return actionErrorText(error);
}

/** Mã + SĐT khớp nhưng đơn đã về một tài khoản Zalo: máy chủ không trả bản xem, khách đăng nhập để xem trong Đơn của tôi. */
const isClaimed = (error: unknown): boolean => error instanceof ApiError && error.status === 403 && error.code === GUEST_ORDER_CLAIMED;

/** Không tìm thấy hay chạm trần tra cứu: khách kẹt lại ở đây, nên có lối nhắn Zalo cho Tubu kèm mã vừa gõ (không kèm SĐT). */
const needsSupport = (error: unknown): boolean => error instanceof ApiError && (error.status === 404 || error.status === 429);

/**
 * Biểu mẫu tra đơn đặt không đăng nhập: mã đơn + SĐT đặt hàng, một nút. Khớp thì sang trang theo dõi bằng khoá tạm máy chủ cấp (đơn chuyển
 * khoản đang chờ tiền thì sang thẳng trang QR); bản xem trả về được đặt sẵn vào bộ đệm nên trang theo dõi hiện ngay, không gọi lại lần hai.
 * Không lưu khoá tạm vào trình duyệt: khoá sống 24 giờ, lưu lại thì về sau trang theo dõi mở bằng khoá đã chết.
 */
export function GuestOrderLookup({ initialCode }: { initialCode: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const ids = { code: useId(), phone: useId() };
  const codeRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState(initialCode);
  const [phone, setPhone] = useState('');
  const [attempted, setAttempted] = useState(false);

  const orderCode = normalizeOrderCode(code);
  const normalizedPhone = parseVnContactPhone(phone);
  const codeError = attempted && !GUEST_ORDER_CODE_RE.test(orderCode) ? guestCopy('lookupCodeInvalid') : undefined;
  const phoneError = attempted && !normalizedPhone ? guestCopy('phoneInvalid') : undefined;

  const lookup = useMutation({
    mutationFn: (body: { orderCode: string; phone: string }) => guestLookupOrder(body),
    onSuccess: (res) => {
      queryClient.setQueryData(['guest-order', res.order.code, res.trackingKey], res.order);
      router.push(res.bankPath ?? res.trackPath);
    },
  });
  const busy = lookup.isPending || lookup.isSuccess;

  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    if (lookup.isError) lookup.reset();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setAttempted(true);
    if (!GUEST_ORDER_CODE_RE.test(orderCode)) codeRef.current?.focus();
    else if (!normalizedPhone) phoneRef.current?.focus();
    else lookup.mutate({ orderCode, phone: normalizedPhone });
  };

  return (
    <main className="mx-auto w-full max-w-3xl md:px-6 md:py-6">
      <PageHeader title={guestCopy('lookupTitle')} />
      <div className="mt-2 pb-6 md:pb-0">
        <form noValidate onSubmit={submit} aria-labelledby={`${ids.code}-intro`} className={`space-y-3 p-4 ${ui.card} ${mini.band}`}>
          <p id={`${ids.code}-intro`} className="text-sm text-[color:var(--color-text-secondary)]">
            {guestCopy('lookupIntro')}
          </p>
          <GuestField id={ids.code} label={guestCopy('lookupCode')} hint={guestCopy('lookupCodeHint')} error={codeError}>
            <input
              ref={codeRef}
              id={ids.code}
              name="orderCode"
              value={code}
              maxLength={CODE_MAX + 8}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              aria-required="true"
              aria-invalid={codeError ? true : undefined}
              aria-describedby={`${ids.code}-hint${codeError ? ` ${ids.code}-err` : ''}`}
              onChange={(e) => edit(setCode)(e.target.value)}
              onBlur={() => setCode((c) => normalizeOrderCode(c))}
              readOnly={busy}
              data-testid="guest-lookup-code"
              className={`${codeError ? ui.fieldError : ui.field} mt-1 uppercase tabular-nums`}
            />
          </GuestField>
          <GuestField id={ids.phone} label={guestCopy('phone')} hint={guestCopy('lookupPhoneHint')} error={phoneError}>
            <input
              ref={phoneRef}
              id={ids.phone}
              name="phone"
              value={phone}
              maxLength={20}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              enterKeyHint="search"
              aria-required="true"
              aria-invalid={phoneError ? true : undefined}
              aria-describedby={`${ids.phone}-hint${phoneError ? ` ${ids.phone}-err` : ''}`}
              onChange={(e) => edit(setPhone)(e.target.value)}
              onBlur={() => setPhone((p) => parseVnPhoneInput(p) ?? p)}
              readOnly={busy}
              data-testid="guest-lookup-phone"
              className={`${phoneError ? ui.fieldError : ui.field} mt-1 tabular-nums`}
            />
          </GuestField>
          {lookup.isError &&
            (isClaimed(lookup.error) ? (
              <div role="alert" data-testid="guest-lookup-claimed" className="text-sm text-[color:var(--color-text-primary)]">
                <p>{guestCopy('lookupClaimed')}</p>
                <Link
                  href={loginHref(orderDetailHref(lookup.variables?.orderCode ?? orderCode))}
                  data-testid="guest-lookup-claimed-login"
                  className="inline-flex min-h-11 items-center font-semibold text-[color:var(--color-text-brand)] underline"
                >
                  {guestCopy('lookupClaimedLogin')}
                </Link>
              </div>
            ) : (
              <p role="alert" data-testid="guest-lookup-error" className={ui.error}>
                {lookupErrorText(lookup.error)}
              </p>
            ))}
          {/* Bận thì aria-disabled + ô chỉ đọc, không `disabled`: Chromium thả focus về body, tra lỗi xong khách phải chạm lại vào ô. */}
          <button type="submit" aria-busy={lookup.isPending || undefined} aria-disabled={busy || undefined} data-testid="guest-lookup-submit" className={`${ui.btnPrimary} w-full`}>
            {busy ? guestCopy('lookupBusy') : guestCopy('lookupSubmit')}
          </button>
          {lookup.isError && needsSupport(lookup.error) && lookup.variables && <GuestSupportLink code={lookup.variables.orderCode} />}
          <p className="text-caption text-[color:var(--color-text-secondary)]">
            {guestCopy('lookupAccount')}{' '}
            <Link href="/tai-khoan/don-hang" className="inline-flex min-h-11 items-center font-semibold text-[color:var(--color-text-brand)] underline">
              {guestCopy('lookupAccountLink')}
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
