'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Info } from 'lucide-react';
import type { SubmitExternalClaimResponse } from '@tubutree/shared-types';
import { normalizeClaimCode } from '@tubutree/app-core/claim-code';
import { saveContactPhone } from '@tubutree/app-core/api/account';
import { externalClaimRejectCode, phoneConfirmPrompt, submitExternalClaim } from '@tubutree/app-core/api/external-points';
import {
  MARKETPLACE_CLAIM_COPY as COPY,
  MARKETPLACE_CLAIM_WEB_COPY as WEB,
  PHONE_CONFIRM_COPY,
  claimResultDetail,
  isPastMilestone,
  phoneConfirmErrorText,
} from '@tubutree/app-core/marketplace-claim-copy';
import { scanSuccessCtaLabel } from '@tubutree/app-core/marketplace-scan-guide';
import { formatVnNumber } from '@tubutree/app-core/number-format';
import { parseVnContactPhone } from '@tubutree/app-core/phone-input';
import { usableShopPoints } from '@tubutree/app-core/points-lots';
import { loyaltyQuery } from '@tubutree/app-core/queries/loyalty';
import { Button } from '@/components/mini/button';
import { Card } from '@/components/mini/card';
import { Icon } from '@/components/mini/icon';
import { Text } from '@/components/mini/text';
import { ClaimScanner } from '@/components/points/claim-scan-button';
import { PhoneConfirmSheet } from '@/components/points/phone-confirm-sheet';
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

/** Đang hỏi 4 số cuối SĐT người nhận (W46): mã và cách nhập để gửi lại, sàn của đơn, câu lỗi máy chủ trả và đơn đã bị khoá chưa. */
interface PhoneConfirm {
  code: string;
  via: Via;
  channel: string | null;
  error: string | null;
  locked: boolean;
  attempt: number;
}

const errorBody = (e: unknown): unknown => (e as { body?: unknown } | null)?.body;

/**
 * Thẻ gửi mã của web `/quet-ma` (W44; W46 camera trước): khung quét camera ngay đầu thẻ, đọc được mã là tự gửi (không bấm thêm). Hai lối phụ
 * dưới khung: chụp/chọn ảnh và "Nhập mã thủ công" (mở ô nhập mã + nút "Tích điểm"; màn mở với `?code=` thì ô này mở sẵn). Gửi xong là thẻ kết
 * quả và nút mua sắm. Một nút chính tại mỗi lúc: chưa có mã thì "Bật camera quét ngay"; mã đã sẵn thì "Tích điểm"; gửi xong thì nút mua sắm.
 * Đơn có SĐT người nhận khác SĐT tài khoản (PHONE_CONFIRM_REQUIRED): hộp hỏi 4 số cuối SĐT trên đơn rồi gửi lại đúng mã đó. Đóng hộp khi chưa
 * khớp (W59): không có claim nào được tạo, mã nằm ở lịch sử ("Chờ bạn nhập 4 số cuối") để khách quay lại nhập.
 */
export function ClaimForm({ initialCode, codeParamRejected, verifyHref }: { initialCode: string; codeParamRejected: boolean; verifyHref: string }) {
  const qc = useQueryClient();
  const [code, setCode] = useState(initialCode);
  const [scanned, setScanned] = useState<string | null>(initialCode || null);
  const [manual, setManual] = useState(!!initialCode || codeParamRejected);
  const [error, setError] = useState<ClaimError | null>(codeParamRejected ? { text: COPY.codeLinkInvalid, verify: false } : null);
  const [result, setResult] = useState<SubmitExternalClaimResponse | null>(null);
  const [confirm, setConfirm] = useState<PhoneConfirm | null>(null);
  const [later, setLater] = useState<string | null>(null);
  const [restartKey, setRestartKey] = useState(0);
  const sending = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialCode) {
      setCode(initialCode);
      setScanned(initialCode);
      setManual(true);
    }
  }, [initialCode]);

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [result]);

  const submit = useMutation({
    mutationFn: (v: { code: string; via: Via; last4?: string }) => submitExternalClaim(coreHttp, v.code, v.via, v.last4),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
      setLater(null);
      setConfirm(null);
      setCode('');
      setScanned(null);
      void qc.invalidateQueries({ queryKey: ['external-claims'] });
    },
    onError: (e, v) => {
      setResult(null);
      const prompt = phoneConfirmPrompt(errorBody(e));
      if (prompt) {
        setError(null);
        setConfirm((c) => ({
          code: v.code,
          via: v.via,
          channel: prompt.channel ?? c?.channel ?? null,
          error: phoneConfirmErrorText(prompt.code, prompt.remainingAttempts),
          locked: prompt.code === 'PHONE_CONFIRM_LOCKED',
          attempt: (c?.attempt ?? 0) + 1,
        }));
        // Lần sai, lần khoá là một lượt thử đã ghi: lịch sử không đổi nên không cần làm mới.
        return undefined;
      }
      // Mất mạng hay máy chủ lỗi khi đang ở hộp 4 số: báo ngay trong hộp, khách gửi lại được mà không mất mã.
      if (v.last4 && !externalClaimRejectCode(errorCode(e)) && errorStatus(e) !== 429) {
        setConfirm((c) => (c ? { ...c, error: actionErrorText(e), attempt: c.attempt + 1 } : c));
        return undefined;
      }
      setConfirm(null);
      setError(claimErrorOf(e));
      // Giữ khoá tới khi lịch sử mới về (tối đa `settleWithin`), kẻo gửi lại đúng mã đó nhận đúng lời từ chối. Mất mạng, 429, 5xx nhả ngay.
      if (isStale(e)) return settleWithin(qc.invalidateQueries({ queryKey: ['external-claims'] }));
      return undefined;
    },
  });

  const send = async (raw: string, via: Via, last4?: string) => {
    if (sending.current) return;
    const trimmed = raw.trim();
    if (!trimmed) {
      setError({ text: COPY.emptyCode, verify: false });
      return;
    }
    sending.current = true;
    setResult(null);
    setLater(null);
    try {
      await submit.mutateAsync({ code: trimmed, via, ...(last4 ? { last4 } : {}) });
    } catch {
      /* câu lỗi đã đặt ở onError */
    } finally {
      sending.current = false;
    }
  };

  const sendTyped = () => {
    const trimmed = code.trim();
    void send(trimmed, scanned !== null && scanned === trimmed ? 'scan' : 'typed');
  };

  const onScanned = (value: string) => {
    setCode(value);
    setScanned(value);
    setError(null);
    void send(value, 'scan');
  };

  const scanAnother = () => {
    setConfirm(null);
    setLater(null);
    setCode('');
    setScanned(null);
    setError(null);
    setResult(null);
    setRestartKey((k) => k + 1);
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
            sendTyped();
          }}
        >
          <ClaimScanner
            primary={!ready && !shopNow}
            paused={confirm !== null || submit.isPending}
            busy={submit.isPending && confirm === null}
            autoStart={!initialCode && !codeParamRejected}
            restartKey={restartKey}
            manualOpen={manual}
            onManual={() => setManual((m) => !m)}
            onCode={onScanned}
            onFail={(text) => setError({ text, verify: false })}
          />
          {manual && (
            <div className="mt-3" data-testid="claim-manual">
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
            </div>
          )}
          {later && (
            <Text variant="body-sm" tone="secondary" as="p" style={{ marginTop: 'var(--space-stack-xs)' }}>
              <span role="status" data-testid="claim-later">
                {later}
              </span>
            </Text>
          )}
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
          {manual && (
            <div className="mt-3">
              <Button type="submit" fullWidth size={ready ? 'lg' : undefined} variant={ready && !shopNow ? 'primary' : 'secondary'} loading={submit.isPending}>
                {COPY.submit}
              </Button>
            </div>
          )}
        </form>
      </Card>
      <div ref={resultRef} />
      {result && <ResultCard result={result} />}
      {shopNow && <ShopNowButton />}
      <PhoneConfirmSheet
        open={confirm !== null}
        channel={confirm?.channel ?? null}
        error={confirm?.error ?? null}
        locked={confirm?.locked ?? false}
        pending={submit.isPending}
        attempt={confirm?.attempt ?? 0}
        onSubmit={(last4) => {
          if (confirm) void send(confirm.code, confirm.via, last4);
        }}
        onOther={scanAnother}
        onClose={() => {
          // Đóng hộp mà chưa khớp: lượt hỏi 4 số đã ghi ở máy chủ nên làm mới lịch sử để dòng "Chờ bạn nhập 4 số cuối" hiện ra.
          setLater(confirm?.locked ? PHONE_CONFIRM_COPY.locked : PHONE_CONFIRM_COPY.later);
          setConfirm(null);
          void qc.invalidateQueries({ queryKey: ['external-claims'] });
        }}
      />
    </div>
  );
}

/**
 * Khách đã đăng nhập mà tài khoản chưa có SĐT (W45): nhập số ngay trên màn quét (`PATCH /me/contact-phone`, số liên hệ chưa xác minh) rồi quét
 * tiếp; đơn khớp số này (hoặc 4 số cuối đúng) thì chờ cộng như số Zalo (W59). Lối phụ: xác minh số trên Zalo. Lưu xong thì hồ sơ `['me']` có SĐT và màn
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
