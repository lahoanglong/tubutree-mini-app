import { useState } from 'react';
import { Input, Page } from 'zmp-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Info, ScanLine } from 'lucide-react';
import {
  externalClaimRejectCode,
  getMyExternalClaims,
  submitExternalClaim,
  type MyExternalClaimItem,
  type SubmitExternalClaimResponse,
} from '../services/external-points-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { getPublicConfig } from '../services/shop-api';
import { scanCode } from '../services/zmp-bridge';
import { AuthPhaseView } from '../components/ui/auth-gate';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { PointsBoostStrip } from '../components/loyalty/points-boost-strip';
import { Badge, type BadgeTone } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Field } from '../components/ui/form';
import { Icon } from '../components/ui/icon';
import { PageHeader } from '../components/ui/page-header';
import { Skeleton } from '../components/ui/skeleton';
import { Text } from '../components/ui/text';
import { vi } from '../i18n/vi';
import { formatDate, formatNumber } from '../utils/format';
import { haptic } from '../utils/haptic';

const PAGE_SIZE = 10;
const DEAD_STATES: readonly MyExternalClaimItem['state'][] = ['VOIDED', 'REVERSED', 'LAPSED'];
const t = vi.externalPoints;

// Đã có SĐT mà vẫn NOT_ELIGIBLE_USER là tài khoản bị khoá: chia sẻ lại SĐT không giúp được gì, chỉ CSKH gỡ được.
const ACCOUNT_NOT_ELIGIBLE = 'Tài khoản của bạn chưa đủ điều kiện tích điểm đơn ngoài app. Bạn liên hệ CSKH Tubu để được hỗ trợ nhé.';

export function claimStateView(item: Pick<MyExternalClaimItem, 'state' | 'expectedCreditAt'>): { label: string; tone: BadgeTone } {
  switch (item.state) {
    case 'PENDING':
      return item.expectedCreditAt ? { label: t.state.waitCredit, tone: 'info' } : { label: t.state.waitDelivery, tone: 'warning' };
    case 'REVIEW':
    case 'HELD_NO_MEMBER':
      return { label: t.state.review, tone: 'warning' };
    case 'CREDITED':
      return { label: t.state.credited, tone: 'success' };
    case 'REVERSED':
      return { label: t.state.reversed, tone: 'danger' };
    case 'LAPSED':
      return { label: t.state.lapsed, tone: 'neutral' };
    default:
      return { label: t.state.voided, tone: 'danger' };
  }
}

function claimDetail(item: MyExternalClaimItem): string | null {
  if (item.state === 'CREDITED') return item.creditedAt ? t.creditedOn(formatDate(item.creditedAt)) : null;
  if (item.state === 'PENDING' && item.expectedCreditAt) return t.expectedOn(formatDate(item.expectedCreditAt));
  return null;
}

/** Mốc dự kiến đã qua mà API vẫn trả CLAIMED: khách gửi lại mã đã được cộng hoặc sắp cộng, dùng câu của API thay vì hứa "sẽ cộng". */
function isPastMilestone(r: SubmitExternalClaimResponse): boolean {
  return r.status === 'CLAIMED' && r.expectedCreditAt != null && Date.parse(r.expectedCreditAt) <= Date.now();
}

function ResultCard({ result }: { result: SubmitExternalClaimResponse }) {
  const past = isPastMilestone(result);
  const byOther = result.status === 'CLAIMED_BY_OTHER';
  const detail =
    result.status === 'SEARCHING'
      ? t.resultSearching
      : byOther
        ? t.resultClaimedByOther
        : result.status === 'REVIEW'
        ? t.resultReview
        : past
          ? result.message
          : result.expectedCreditAt
            ? t.resultCreditAt(formatDate(result.expectedCreditAt))
            : t.resultAfterDelivery;
  const waiting = result.status === 'SEARCHING' || result.status === 'REVIEW';
  return (
    <Card variant="outline" padding={16} style={{ marginTop: 12 }}>
      <div role="status" data-testid="claim-result" style={{ display: 'flex', gap: 10 }}>
        <Icon icon={byOther ? Info : waiting ? Clock : CheckCircle2} tone={waiting || byOther ? 'muted' : 'brand'} />
        <div style={{ minWidth: 0 }}>
          {result.status !== 'SEARCHING' && !byOther && (
            <Text variant="label" as="div">
              {t.resultClaimed(result.channel, result.maskedCode)}
            </Text>
          )}
          {result.points != null && (
            <Text variant="body-md" tone="brand" as="div" style={{ fontWeight: 600 }}>
              {past ? `${formatNumber(result.points)} Điểm Xanh` : t.resultPoints(result.points)}
            </Text>
          )}
          <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 2 }}>
            {detail}
          </Text>
        </div>
      </div>
    </Card>
  );
}

function ClaimList() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['external-claims', page], queryFn: () => getMyExternalClaims(page, PAGE_SIZE) });
  if (q.isPending) return <Skeleton height={96} radius="var(--radius-card)" />;
  if (q.isError) return <ErrorState message={t.listLoadFailed} onRetry={() => void q.refetch()} />;
  const { data, meta, searching } = q.data;
  const pages = Math.max(1, Math.ceil(meta.total / meta.limit));
  return (
    <div>
      {searching.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text variant="label" tone="secondary" as="div" style={{ marginBottom: 6 }}>
            {t.searchingTitle}
          </Text>
          {searching.map((s) => (
            <div key={`${s.maskedCode}-${s.createdAt}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
              <Text variant="body-sm">{s.maskedCode}</Text>
              <Text variant="caption" tone="tertiary">{formatDate(s.createdAt)}</Text>
            </div>
          ))}
        </div>
      )}
      {data.length === 0 && searching.length === 0 ? (
        <Text variant="body-sm" tone="secondary" as="p">
          {t.listEmpty}
        </Text>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.map((item) => {
            const view = claimStateView(item);
            const detail = claimDetail(item);
            return (
              <li key={item.id}>
                <Card variant="raised" padding={12}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <Text variant="label" as="div">{item.channel ?? t.channelFallback}</Text>
                      <Text variant="caption" tone="tertiary" as="div">{item.maskedCode}</Text>
                    </div>
                    <Badge tone={view.tone}>{view.label}</Badge>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, gap: 8 }}>
                    <Text
                      variant="body-sm"
                      tone={item.points != null && !DEAD_STATES.includes(item.state) ? 'brand' : 'tertiary'}
                      style={{ fontWeight: 600, textDecoration: DEAD_STATES.includes(item.state) ? 'line-through' : undefined }}
                    >
                      {item.points != null ? `${formatNumber(item.points)} Điểm Xanh` : t.pointsPending}
                    </Text>
                    {detail && <Text variant="caption" tone="secondary">{detail}</Text>}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <Button variant="ghost" disabled={page <= 1} onPress={() => setPage((p) => Math.max(1, p - 1))}>{t.prev}</Button>
          <Text variant="caption" tone="secondary">{t.pageOf(page, pages)}</Text>
          <Button variant="ghost" disabled={page >= pages} onPress={() => setPage((p) => Math.min(pages, p + 1))}>{t.next}</Button>
        </div>
      )}
    </div>
  );
}

function ClaimForm() {
  const qc = useQueryClient();
  const hasPhone = useAuthStore((s) => !!s.user?.phone);
  const ensurePhone = useAuthStore((s) => s.ensurePhone);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needPhone, setNeedPhone] = useState(false);
  const [result, setResult] = useState<SubmitExternalClaimResponse | null>(null);

  const submit = useMutation({
    mutationFn: (c: string) => submitExternalClaim(c),
    onSuccess: (r) => {
      haptic('medium');
      setResult(r);
      setError(null);
      setNeedPhone(false);
      setCode('');
      void qc.invalidateQueries({ queryKey: ['external-claims'] });
    },
    onError: (e) => {
      setResult(null);
      const rejected = externalClaimRejectCode(e);
      const blockedAccount = rejected === 'NOT_ELIGIBLE_USER' && hasPhone;
      setError(blockedAccount ? ACCOUNT_NOT_ELIGIBLE : rejected ? t.reject[rejected] : getErrorMessage(e));
      setNeedPhone(rejected === 'NOT_ELIGIBLE_USER' && !hasPhone);
    },
  });

  // Đăng nhập ngầm không xin SĐT, nên khách vào từ thẻ trong hộp hay từ sàn thường chưa có SĐT; máy chủ chỉ cộng điểm theo SĐT.
  const requestPhone = async (): Promise<boolean> => {
    try {
      if (await ensurePhone()) return true;
    } catch {
      /* người dùng huỷ hoặc Zalo lỗi: coi như chưa có SĐT, nút chia sẻ vẫn ở đó để thử lại */
    }
    setError(t.reject.NOT_ELIGIBLE_USER);
    setNeedPhone(true);
    return false;
  };

  const send = async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      setError(t.emptyCode);
      return;
    }
    setResult(null);
    if (!hasPhone && !(await requestPhone())) return;
    submit.mutate(trimmed);
  };

  const sharePhone = async () => {
    const trimmed = code.trim();
    if (!(await requestPhone())) return;
    setNeedPhone(false);
    setError(null);
    if (trimmed) submit.mutate(trimmed);
  };

  const scan = async () => {
    const res = await scanCode();
    if (res.kind === 'ok') {
      setCode(res.content);
      setError(null);
    } else if (res.kind === 'failed') {
      setError(t.scanFailed);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <Card variant="raised" padding={16}>
        <Field label={t.inputLabel}>
          <Input
            placeholder={t.inputPlaceholder}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
          />
        </Field>
        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 6 }}>
          {t.inputHelp}
        </Text>
        {error && (
          <Text variant="body-sm" tone="danger" as="div" style={{ marginTop: 8 }}>
            <span role="alert">{error}</span>
          </Text>
        )}
        {needPhone && !hasPhone && (
          <Button fullWidth variant="secondary" onPress={sharePhone} style={{ marginTop: 8 }}>{t.sharePhone}</Button>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button fullWidth loading={submit.isPending} onPress={send} style={{ flex: 1, minWidth: 0 }}>{t.submit}</Button>
          <Button variant="secondary" icon={ScanLine} onPress={scan} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t.scan}</Button>
        </div>
      </Card>
      {result && <ResultCard result={result} />}
    </div>
  );
}

export default function ExternalPointsPage() {
  const phase = useAuthPhase();
  const cfgQ = useQuery({ queryKey: ['public-config'], queryFn: getPublicConfig, staleTime: 5 * 60_000 });
  const enabled = cfgQ.data?.loyalty?.marketplaceClaimEnabled === true;

  let body;
  if (cfgQ.isError) {
    body = <ErrorState message={getErrorMessage(cfgQ.error)} onRetry={() => void cfgQ.refetch()} />;
  } else if (cfgQ.isPending) {
    body = <div style={{ padding: 16 }}><Skeleton height={160} radius="var(--radius-card)" /></div>;
  } else if (!enabled) {
    body = <EmptyState art="sprout" heading={t.closedTitle} body={t.closedBody} />;
  } else if (phase !== 'authenticated') {
    body = <AuthPhaseView phase={phase} loading={<div style={{ padding: 16 }}><Skeleton height={160} radius="var(--radius-card)" /></div>} />;
  } else {
    body = (
      <>
        <PointsBoostStrip placement="scan" />
        <ClaimForm />
        <div style={{ padding: '0 16px 32px' }}>
          <Text variant="body-lg" as="h2" style={{ fontWeight: 600, marginBottom: 10 }}>{t.listTitle}</Text>
          <ClaimList />
        </div>
      </>
    );
  }

  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title={t.title} />
      {body}
    </Page>
  );
}
