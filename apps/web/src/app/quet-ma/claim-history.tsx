'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import type { MyExternalClaimsResponse, SubmitExternalClaimResponse } from '@tubutree/shared-types';
import { externalClaimRejectCode, phoneConfirmPrompt, retryExternalClaimPhone, type PhoneRetryTarget } from '@tubutree/app-core/api/external-points';
import { externalClaimsQuery } from '@tubutree/app-core/queries/external-points';
import {
  DEAD_CLAIM_STATES,
  MARKETPLACE_CLAIM_COPY as COPY,
  MARKETPLACE_CLAIM_WEB_COPY as WEB,
  PHONE_CONFIRM_COPY,
  claimDetail,
  claimStateView,
  marketplaceChannelName,
  phoneConfirmErrorText,
} from '@tubutree/app-core/marketplace-claim-copy';
import { formatVnNumber } from '@tubutree/app-core/number-format';
import { Badge } from '@/components/mini/badge';
import { Button } from '@/components/mini/button';
import { Card } from '@/components/mini/card';
import { Skeleton } from '@/components/mini/skeleton';
import { Heading, Text } from '@/components/mini/text';
import { PhoneConfirmSheet } from '@/components/points/phone-confirm-sheet';
import { ErrorState } from '@/components/ui/error-state';
import { coreHttp } from '@/lib/core-http';
import { actionErrorText } from '@/lib/error-text';
import { formatDate } from '@/lib/format-date';

export const CLAIM_HISTORY_PAGE_SIZE = 10;
const PAGE_SIZE = CLAIM_HISTORY_PAGE_SIZE;

/** Dòng lịch sử đang mở hộp nhập 4 số cuối (W59): dòng nào, sàn, câu lỗi máy chủ trả, đơn đã khoá chưa, lần trả lời thứ mấy (xoá ô, lấy lại focus). */
interface Retry {
  target: PhoneRetryTarget;
  channel: string | null;
  maskedCode: string;
  error: string | null;
  locked: boolean;
  attempt: number;
}

const errorBody = (e: unknown): unknown => (e as { body?: unknown } | null)?.body;
const errorCode = (e: unknown): string | null => {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
};
const errorStatus = (e: unknown): number | null => {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
};

/**
 * "Lịch sử tích điểm đơn sàn" của web `/quet-ma` (W44): cùng dữ liệu (`GET /me/external-points/claims`), cùng nhãn trạng thái và cùng khoá cache
 * `['external-claims', page]` với danh sách "Đơn sàn của bạn" của Mini App, nên gửi mã xong chỉ cần làm mới khoá đó.
 * W59 (PO 28/11): mã dừng ở bước 4 số cuối (`needsPhone`) và claim chờ chỉ vì SĐT (`phoneRetry`) là dòng chạm được: khách nhập 4 số cuối SĐT
 * người nhận ngay tại đây (`POST .../claims/phone-retry`), không quét lại. Sai thì báo trong hộp; mã vẫn để trống cho lần sau.
 */
export function ClaimHistory() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState<Retry | null>(null);
  const [done, setDone] = useState<{ result: SubmitExternalClaimResponse; channel: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sending = useRef(false);
  const q = useQuery(externalClaimsQuery(coreHttp, page, PAGE_SIZE));

  const send = useMutation({
    mutationFn: (v: { target: PhoneRetryTarget; last4: string; channel: string | null }) => retryExternalClaimPhone(coreHttp, v.target, v.last4),
    onSuccess: (result, v) => {
      setDone({ result, channel: result.channel ?? v.channel });
      setRetry(null);
      setNotice(null);
      void qc.invalidateQueries({ queryKey: ['external-claims'] });
    },
    onError: (e) => {
      const prompt = phoneConfirmPrompt(errorBody(e));
      if (prompt) {
        setRetry((c) =>
          c
            ? {
                ...c,
                channel: prompt.channel ?? c.channel,
                error: phoneConfirmErrorText(prompt.code, prompt.remainingAttempts),
                locked: prompt.code === 'PHONE_CONFIRM_LOCKED',
                attempt: c.attempt + 1,
              }
            : c,
        );
        return;
      }
      const rejected = externalClaimRejectCode(errorCode(e));
      const text = rejected ? COPY.reject[rejected] : actionErrorText(e);
      // Dòng không còn để nhập lại (người khác vừa duyệt, đã có claim, hết lượt trong ngày...): đóng hộp, báo câu máy chủ và làm mới lịch sử.
      if (rejected || [400, 404, 409].includes(errorStatus(e) ?? 0)) {
        setRetry(null);
        setNotice(text);
        void qc.invalidateQueries({ queryKey: ['external-claims'] });
        return;
      }
      // Mất mạng, 429, 5xx: báo trong hộp, khách gửi lại được mà không chạm lại dòng.
      setRetry((c) => (c ? { ...c, error: text, attempt: c.attempt + 1 } : c));
    },
  });

  const submit = async (last4: string) => {
    if (!retry || sending.current) return;
    sending.current = true;
    try {
      await send.mutateAsync({ target: retry.target, last4, channel: retry.channel });
    } catch {
      /* câu lỗi đã đặt ở onError */
    } finally {
      sending.current = false;
    }
  };

  const open = (target: PhoneRetryTarget, channel: string | null, maskedCode: string) => {
    setDone(null);
    setNotice(null);
    setRetry({ target, channel, maskedCode, error: null, locked: false, attempt: 0 });
  };

  return (
    <section aria-labelledby="claim-history-title" className="mt-6" data-testid="claim-history">
      <Heading id="claim-history-title" variant="title-sm" as="h2" font="ui" style={{ marginBottom: 'var(--space-stack-sm)' }}>
        {WEB.historyTitle}
      </Heading>
      {done && (
        <div role="status" data-testid="claim-retry-done" className="mb-3">
          <Text variant="label" tone="brand" as="div">
            {PHONE_CONFIRM_COPY.retryDone(marketplaceChannelName(done.channel), done.result.maskedCode)}
          </Text>
          {done.result.points != null && (
            <Text variant="body-sm" tone="secondary" as="div" numeric>
              {COPY.resultPoints(done.result.points)}
            </Text>
          )}
        </div>
      )}
      {notice && (
        <Text variant="body-sm" tone="secondary" as="p" style={{ marginBottom: 'var(--space-stack-sm)' }}>
          <span role="status" data-testid="claim-retry-notice">
            {notice}
          </span>
        </Text>
      )}
      {q.isPending ? (
        <Skeleton height={96} radius="var(--radius-card)" />
      ) : q.isError ? (
        <ErrorState variant="inline" message={COPY.listLoadFailed} onRetry={() => void q.refetch()} />
      ) : (
        <HistoryList res={q.data} page={page} setPage={setPage} onRetry={open} />
      )}
      <PhoneConfirmSheet
        open={retry !== null}
        channel={retry?.channel ?? null}
        error={retry?.error ?? null}
        locked={retry?.locked ?? false}
        pending={send.isPending}
        attempt={retry?.attempt ?? 0}
        onSubmit={(last4) => void submit(last4)}
        onClose={() => setRetry(null)}
      />
    </section>
  );
}

function HistoryList({
  res,
  page,
  setPage,
  onRetry,
}: {
  res: MyExternalClaimsResponse;
  page: number;
  setPage: (fn: (p: number) => number) => void;
  onRetry: (target: PhoneRetryTarget, channel: string | null, maskedCode: string) => void;
}) {
  const { data, meta, searching } = res;
  const needsPhone = res.needsPhone ?? [];
  const pages = Math.max(1, Math.ceil(meta.total / meta.limit));
  return (
    <div>
      {needsPhone.length > 0 && (
        <div className="mb-3" data-testid="claim-needs-phone">
          <Text variant="label" tone="secondary" as="div" style={{ marginBottom: 'var(--space-stack-xs)' }}>
            {PHONE_CONFIRM_COPY.retryTitle}
          </Text>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {needsPhone.map((n) => (
              <li key={n.attemptId} data-testid="claim-needs-phone-row">
                <Card variant="outline" padding={12} onPress={() => onRetry({ attemptId: n.attemptId }, n.channel, n.maskedCode)}>
                  <div className="flex min-h-6 items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Text variant="label" as="div">
                        {marketplaceChannelName(n.channel)}
                      </Text>
                      <Text variant="caption" tone="tertiary" as="div">
                        {n.maskedCode}
                      </Text>
                    </div>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <Badge tone="warning">{COPY.state.needPhone}</Badge>
                      <ChevronRight size={16} aria-hidden="true" />
                    </span>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}
      {searching.length > 0 && (
        <div className="mb-3" data-testid="claim-searching">
          <Text variant="label" tone="secondary" as="div" style={{ marginBottom: 'var(--space-stack-xs)' }}>
            {COPY.searchingTitle}
          </Text>
          {searching.map((s) => (
            <div key={`${s.maskedCode}-${s.createdAt}`} className="flex justify-between py-1.5">
              <Text variant="body-sm">{s.maskedCode}</Text>
              <Text variant="caption" tone="tertiary">
                {formatDate(s.createdAt)}
              </Text>
            </div>
          ))}
        </div>
      )}
      {data.length === 0 && searching.length === 0 && needsPhone.length === 0 ? (
        <Text variant="body-sm" tone="secondary" as="p">
          {COPY.listEmpty}
        </Text>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {data.map((item) => {
            const view = claimStateView(item);
            const detail = claimDetail(item, formatDate);
            const dead = DEAD_CLAIM_STATES.includes(item.state);
            const retryable = item.state === 'REVIEW' && item.phoneRetry === true;
            return (
              <li key={item.id} data-testid={retryable ? 'claim-row-retry' : undefined}>
                <Card variant="raised" padding={12} onPress={retryable ? () => onRetry({ claimId: item.id }, item.channel, item.maskedCode) : undefined}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Text variant="label" as="div">
                        {item.channel ?? COPY.channelFallback}
                      </Text>
                      <Text variant="caption" tone="tertiary" as="div">
                        {item.maskedCode}
                      </Text>
                    </div>
                    <Badge tone={view.tone}>{view.label}</Badge>
                  </div>
                  <div className="mt-1.5 flex justify-between gap-2">
                    <Text
                      variant="body-sm"
                      tone={item.points != null && !dead ? 'brand' : 'tertiary'}
                      numeric
                      style={{ fontWeight: 600, textDecoration: dead ? 'line-through' : undefined }}
                    >
                      {item.points != null ? `${formatVnNumber(item.points)} Điểm Xanh` : COPY.pointsPending}
                    </Text>
                    {detail && (
                      <Text variant="caption" tone="secondary">
                        {detail}
                      </Text>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between">
          <Button variant="ghost" disabled={page <= 1} onPress={() => setPage((p) => Math.max(1, p - 1))}>
            {COPY.prev}
          </Button>
          <Text variant="caption" tone="secondary">
            {COPY.pageOf(page, pages)}
          </Text>
          <Button variant="ghost" disabled={page >= pages} onPress={() => setPage((p) => Math.min(pages, p + 1))}>
            {COPY.next}
          </Button>
        </div>
      )}
    </div>
  );
}
