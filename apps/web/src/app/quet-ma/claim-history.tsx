'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MyExternalClaimsResponse } from '@tubutree/shared-types';
import { externalClaimsQuery } from '@tubutree/app-core/queries/external-points';
import { DEAD_CLAIM_STATES, MARKETPLACE_CLAIM_COPY as COPY, MARKETPLACE_CLAIM_WEB_COPY as WEB, claimDetail, claimStateView } from '@tubutree/app-core/marketplace-claim-copy';
import { formatVnNumber } from '@tubutree/app-core/number-format';
import { Badge } from '@/components/mini/badge';
import { Button } from '@/components/mini/button';
import { Card } from '@/components/mini/card';
import { Skeleton } from '@/components/mini/skeleton';
import { Heading, Text } from '@/components/mini/text';
import { ErrorState } from '@/components/ui/error-state';
import { coreHttp } from '@/lib/core-http';
import { formatDate } from '@/lib/format-date';

const PAGE_SIZE = 10;

/**
 * "Lịch sử tích điểm đơn sàn" của web `/quet-ma` (W44): cùng dữ liệu (`GET /me/external-points/claims`), cùng nhãn trạng thái và cùng khoá cache
 * `['external-claims', page]` với danh sách "Đơn sàn của bạn" của Mini App, nên gửi mã xong chỉ cần làm mới khoá đó.
 */
export function ClaimHistory() {
  const [page, setPage] = useState(1);
  const q = useQuery(externalClaimsQuery(coreHttp, page, PAGE_SIZE));
  return (
    <section aria-labelledby="claim-history-title" className="mt-6" data-testid="claim-history">
      <Heading id="claim-history-title" variant="title-sm" as="h2" font="ui" style={{ marginBottom: 'var(--space-stack-sm)' }}>
        {WEB.historyTitle}
      </Heading>
      {q.isPending ? (
        <Skeleton height={96} radius="var(--radius-card)" />
      ) : q.isError ? (
        <ErrorState variant="inline" message={COPY.listLoadFailed} onRetry={() => void q.refetch()} />
      ) : (
        <HistoryList res={q.data} page={page} setPage={setPage} />
      )}
    </section>
  );
}

function HistoryList({ res, page, setPage }: { res: MyExternalClaimsResponse; page: number; setPage: (fn: (p: number) => number) => void }) {
  const { data, meta, searching } = res;
  const pages = Math.max(1, Math.ceil(meta.total / meta.limit));
  return (
    <div>
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
      {data.length === 0 && searching.length === 0 ? (
        <Text variant="body-sm" tone="secondary" as="p">
          {COPY.listEmpty}
        </Text>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {data.map((item) => {
            const view = claimStateView(item);
            const detail = claimDetail(item, formatDate);
            const dead = DEAD_CLAIM_STATES.includes(item.state);
            return (
              <li key={item.id}>
                <Card variant="raised" padding={12}>
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
