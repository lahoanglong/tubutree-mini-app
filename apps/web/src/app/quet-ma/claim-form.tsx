'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Info } from 'lucide-react';
import type { SubmitExternalClaimResponse } from '@tubutree/shared-types';
import { normalizeClaimCode } from '@tubutree/app-core/claim-code';
import { saveContactPhone } from '@tubutree/app-core/api/account';
import { externalClaimRejectCode, submitExternalClaim } from '@tubutree/app-core/api/external-points';
import { MARKETPLACE_CLAIM_COPY as COPY, MARKETPLACE_CLAIM_WEB_COPY as WEB, claimResultDetail, isPastMilestone } from '@tubutree/app-core/marketplace-claim-copy';
import { scanSuccessCtaLabel } from '@tubutree/app-core/marketplace-scan-guide';
import { formatVnNumber } from '@tubutree/app-core/number-format';
import { parseVnContactPhone } from '@tubutree/app-core/phone-input';
import { usableShopPoints } from '@tubutree/app-core/points-lots';
import { loyaltyQuery } from '@tubutree/app-core/queries/loyalty';
import { Button } from '@/components/mini/button';
import { Card } from '@/components/mini/card';
import { Icon } from '@/components/mini/icon';
import { Text } from '@/components/mini/text';
import { ClaimScanButton } from '@/components/points/claim-scan-button';
import { Field } from '@/components/ui/field';
import { coreHttp } from '@/lib/core-http';
import { actionErrorText } from '@/lib/error-text';
import { formatDate } from '@/lib/format-date';
import { ui } from '@/lib/guest-ui';
import { settleWithin } from '@/lib/settle-within';

/** Cùng giới hạn ô nhập mã của Mini App (`INPUT_LIMITS.externalPointsCode`) và DTO máy chủ (`@MaxLength(100)`). */
const CODE_MAX_LENGTH = 100;

type Via = 'scan' | 'typed';
interface ClaimError {
  text: string;
  /** Lỗi do SĐT chưa xác minh qua Zalo: kèm lối mở Tubu Tree trên Zalo để xác minh. */
  verify: boolean;
}

function errorCode(e: unknown): string | null {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

const errorStatus = (e: unknown): number | null => {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
};

/**
 * Câu lỗi khi gửi mã trên web. Mã từ chối của API dùng chung câu với Mini App; riêng NOT_ELIGIBLE_USER: web không xin được SĐT Zalo như Mini App,
 * khách có SĐT mà vẫn bị từ chối thường là SĐT liên hệ chưa xác minh (gõ ở Hồ sơ web), nên chỉ đường xác minh trên Zalo. Gửi nhanh quá (429) có câu
 * riêng; còn lại dùng câu lỗi thao tác chung của web.
 */
export function claimErrorOf(e: unknown): ClaimError {
  const rejected = externalClaimRejectCode(errorCode(e));
  if (rejected === 'NOT_ELIGIBLE_USER') return { text: WEB.notVerified, verify: true };
  if (rejected) return { text: COPY.reject[rejected], verify: false };
  if (errorStatus(e) === 429) return { text: WEB.rateLimited, verify: false };
  return { text: actionErrorText(e), verify: false };
}

/** Máy chủ từ chối vì trạng thái đã đổi (mã đã dùng, đơn không còn...): làm mới lịch sử để khách thấy đúng. */
const isStale = (e: unknown) => [400, 404, 409].includes(errorStatus(e) ?? 0);

function ResultCard({ result }: { result: SubmitExternalClaimResponse }) {
  const past = isPastMilestone(result);
  const byOther = result.status === 'CLAIMED_BY_OTHER';
  const waiting = result.status === 'SEARCHING' || result.status === 'REVIEW';
  return (
    <Card variant="outline" padding={16} style={{ marginTop: 'var(--space-inline-md)' }}>
      <div role="status" data-testid="claim-result" className="flex gap-2.5">
        <Icon icon={byOther ? Info : waiting ? Clock : CheckCircle2} tone={waiting || byOther ? 'muted' : 'brand'} />
        <div className="min-w-0">
          {result.status !== 'SEARCHING' && !byOther && (
            <Text variant="label" as="div">
              {COPY.resultClaimed(result.channel, result.maskedCode)}
            </Text>
          )}
          {result.points != null && (
            <Text variant="body-md" tone="brand" as="div" numeric style={{ fontWeight: 600 }}>
              {past ? `${formatVnNumber(result.points)} Điểm Xanh` : COPY.resultPoints(result.points)}
            </Text>
          )}
          <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 'var(--space-inline-xs)' }}>
            {claimResultDetail(result, formatDate)}
          </Text>
        </div>
      </div>
    </Card>
  );
}

/**
 * Nút chính sau khi gửi mã thành công: về Trang chủ mua sắm. Điểm của đơn vừa quét còn chờ nên nhãn chỉ nhắc số điểm khách đang có và dùng được
 * ngay (`usableShopPoints`, cùng luật màn thanh toán), chưa có thì "Mua sắm ngay".
 */
function ShopNowButton() {
  const router = useRouter();
  const loyaltyQ = useQuery(loyaltyQuery(coreHttp));
  return (
    <div data-testid="scan-shop-now" style={{ marginTop: 'var(--space-inline-md)' }}>
      <Button fullWidth size="lg" onPress={() => router.push('/')}>
        {scanSuccessCtaLabel(usableShopPoints(loyaltyQ.data), 'web')}
      </Button>
    </div>
  );
}

/**
 * Thẻ gửi mã của web `/quet-ma` (W44, PO 27/11: quét và tích điểm ngay trên web): nút quét bằng camera trình duyệt (mọi máy từ W45, iPhone đọc
 * bằng bộ đọc JS) kèm lối chụp/chọn ảnh, ô nhập mã và nút "Tích điểm", rồi thẻ kết quả và nút mua sắm. Cùng thứ tự, cùng chữ, cùng một nút chính
 * tại mỗi lúc như Mini App `/points/scan`: chưa có mã thì nút quét là nút chính; mã đã sẵn (quét xong hay gõ đúng dạng) thì "Tích điểm"; gửi
 * xong thì nút mua sắm. `unverified`: SĐT là số liên hệ tự gõ trên web, nói trước rằng đơn sẽ được CSKH đối chiếu (máy chủ đưa vào REVIEW).
 */
export function ClaimForm({
  initialCode,
  codeParamRejected,
  verifyHref,
  unverified = false,
}: {
  initialCode: string;
  codeParamRejected: boolean;
  verifyHref: string;
  unverified?: boolean;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState(initialCode);
  const [scanned, setScanned] = useState<string | null>(initialCode || null);
  const [error, setError] = useState<ClaimError | null>(codeParamRejected ? { text: COPY.codeLinkInvalid, verify: false } : null);
  const [result, setResult] = useState<SubmitExternalClaimResponse | null>(null);
  const sending = useRef(false);
  const submitWrap = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialCode) {
      setCode(initialCode);
      setScanned(initialCode);
    }
  }, [initialCode]);

  useEffect(() => {
    if (scanned !== null) submitWrap.current?.querySelector('button')?.focus();
  }, [scanned]);

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [result]);

  const submit = useMutation({
    mutationFn: (v: { code: string; via: Via }) => submitExternalClaim(coreHttp, v.code, v.via),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
      setCode('');
      setScanned(null);
      void qc.invalidateQueries({ queryKey: ['external-claims'] });
    },
    onError: (e) => {
      setResult(null);
      setError(claimErrorOf(e));
      // Giữ khoá tới khi lịch sử mới về (tối đa `settleWithin`), kẻo gửi lại đúng mã đó nhận đúng lời từ chối. Mất mạng, 429, 5xx nhả ngay.
      if (isStale(e)) return settleWithin(qc.invalidateQueries({ queryKey: ['external-claims'] }));
      return undefined;
    },
  });

  const send = async () => {
    if (sending.current) return;
    const trimmed = code.trim();
    if (!trimmed) {
      setError({ text: COPY.emptyCode, verify: false });
      return;
    }
    sending.current = true;
    setResult(null);
    try {
      await submit.mutateAsync({ code: trimmed, via: scanned !== null && scanned === trimmed ? 'scan' : 'typed' });
    } catch {
      /* câu lỗi đã đặt ở onError */
    } finally {
      sending.current = false;
    }
  };

  const onScanned = (value: string) => {
    setCode(value);
    setScanned(value);
    setError(null);
  };

  const shopNow = result != null && (result.status === 'CLAIMED' || result.status === 'REVIEW');
  const ready = scanned !== null || normalizeClaimCode(code) !== null;

  return (
    <div className="mt-4">
      <Card variant="raised" padding={16}>
        <form
          noValidate
          aria-label={WEB.scanSheetTitle}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <ClaimScanButton primary={!ready && !shopNow} onCode={onScanned} onFail={(text) => setError({ text, verify: false })} />
          <div className="mt-3">
            <Field label={COPY.inputLabel}>
              <input
                type="text"
                maxLength={CODE_MAX_LENGTH}
                placeholder={COPY.inputPlaceholder}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setScanned(null);
                }}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="send"
                className={ui.field}
              />
            </Field>
            <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 'var(--space-stack-xs)' }}>
              {COPY.inputHelp}
            </Text>
            {unverified && (
              <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 'var(--space-stack-xs)' }}>
                <span data-testid="claim-unverified-note">{WEB.unverifiedNote}</span>
              </Text>
            )}
          </div>
          {error && (
            <div className="mt-2" data-testid="claim-error">
              <Text variant="body-sm" tone="danger" as="div">
                <span role="alert">{error.text}</span>
              </Text>
              {error.verify && (
                <a href={verifyHref} className={`${ui.btnSecondary} mt-2 w-full`} data-testid="claim-verify-zalo">
                  {WEB.phoneCta}
                </a>
              )}
            </div>
          )}
          <div ref={submitWrap} className="mt-3">
            <Button type="submit" fullWidth size={ready ? 'lg' : undefined} variant={ready && !shopNow ? 'primary' : 'secondary'} loading={submit.isPending}>
              {COPY.submit}
            </Button>
          </div>
        </form>
      </Card>
      <div ref={resultRef} />
      {result && <ResultCard result={result} />}
      {shopNow && <ShopNowButton />}
    </div>
  );
}

/**
 * Khách đã đăng nhập mà tài khoản chưa có SĐT (W45): nhập số ngay trên màn quét (`PATCH /me/contact-phone`, số liên hệ chưa xác minh) rồi quét
 * tiếp; đơn tích bằng số này vào hàng CSKH đối chiếu. Lối phụ: xác minh số trên Zalo để cộng tự động. Lưu xong thì hồ sơ `['me']` có SĐT và màn
 * tự chuyển sang thẻ gửi mã.
 */
export function PhoneEntry({ verifyHref }: { verifyHref: string }) {
  const qc = useQueryClient();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const save = useMutation({
    mutationFn: (normalized: string) => saveContactPhone(coreHttp, normalized),
    onSuccess: (me) => {
      if (me) qc.setQueryData(['me'], me);
      return settleWithin(qc.invalidateQueries({ queryKey: ['me'] }));
    },
    onError: (e) => setError(actionErrorText(e)),
  });

  const submit = async () => {
    if (saving.current) return;
    const normalized = parseVnContactPhone(phone);
    if (!normalized) {
      setError(phone.trim() === '' ? WEB.phoneEmpty : WEB.phoneInvalid);
      return;
    }
    saving.current = true;
    setError(null);
    try {
      await save.mutateAsync(normalized);
    } catch {
      /* câu lỗi đã đặt ở onError */
    } finally {
      saving.current = false;
    }
  };

  return (
    <div className="mt-4">
      <Card variant="raised" padding={16}>
        <form
          noValidate
          data-testid="scan-phone-prompt"
          aria-label={WEB.phoneTitle}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Text variant="label" as="h2">
            {WEB.phoneTitle}
          </Text>
          <Text variant="body-sm" tone="secondary" as="p" style={{ marginTop: 'var(--space-stack-xs)' }}>
            {WEB.phoneBody}
          </Text>
          <div className="mt-3">
            <Field label={WEB.phoneLabel}>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                enterKeyHint="done"
                placeholder={WEB.phonePlaceholder}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (error) setError(null);
                }}
                className={`${error ? ui.fieldError : ui.field} tabular-nums`}
              />
            </Field>
          </div>
          {error && (
            <p role="alert" className={`${ui.error} mt-2`}>
              {error}
            </p>
          )}
          <div className="mt-3">
            <Button type="submit" fullWidth size="lg" loading={save.isPending}>
              {WEB.phoneSave}
            </Button>
          </div>
          <a href={verifyHref} className="mt-2 flex min-h-11 items-center justify-center text-center text-sm font-medium text-forest-700 underline underline-offset-2">
            {WEB.phoneAlt}
          </a>
        </form>
      </Card>
    </div>
  );
}
