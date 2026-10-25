import { useEffect, useRef, useState } from 'react';
import { Input, Page, useLocation, useNavigate } from 'zmp-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Info, MessageCircle, ScanLine } from 'lucide-react';
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
import { followOA, getOaPromptState, hasOA, openOAChat, requestNotifyPermission, scanCode, setOaPromptState } from '../services/zmp-bridge';
import { trackEvent } from '../services/analytics';
import { useCardGiftNote } from '../services/card-gift-note';
import { getSessionAttribution, type LaunchAttribution } from '../utils/entry-source';
import { extractClaimCode } from '@tubutree/app-core/claim-code';
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

// App đã có SĐT mà máy chủ vẫn không coi tài khoản đủ điều kiện (máy chủ thiếu SĐT hoặc tài khoản bị khoá): chia sẻ lại SĐT không giúp vì máy chủ giữ SĐT cũ, chỉ CSKH gỡ được.
const ACCOUNT_NOT_ELIGIBLE = 'Tài khoản của bạn chưa đủ điều kiện tích điểm đơn sàn. Bạn liên hệ CSKH Tubu để được hỗ trợ nhé.';

const MARKETPLACE_SOURCES = ['shopee', 'lazada', 'tiktok', 'san'];
const CHANNEL_LABEL: Record<string, string> = { shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok Shop' };

/** Khách vào từ thẻ trong hộp hàng sàn: link thẻ mang nguồn là sàn hoặc đợt thẻ (`card=`). */
export function cardEntryOf(a: LaunchAttribution | null): { fromCard: boolean; channel: string | null } {
  if (!a) return { fromCard: false, channel: null };
  const fromCard = MARKETPLACE_SOURCES.includes(a.source) || a.source.startsWith('card-') || a.campaign?.startsWith('card-') === true;
  return { fromCard, channel: CHANNEL_LABEL[a.source] ?? null };
}

function maskForSupport(code: string): string {
  return code.length <= 6 ? code : `${code.slice(0, 3)}***${code.slice(-3)}`;
}

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

function ResultCard({ result, children }: { result: SubmitExternalClaimResponse; children?: React.ReactNode }) {
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
          {children}
        </div>
      </div>
    </Card>
  );
}

function SupportButton({ maskedCode }: { maskedCode: string }) {
  if (!hasOA) return null;
  return (
    <Button variant="secondary" icon={MessageCircle} onPress={() => openOAChat(t.chatSupportMessage(maskedCode))} style={{ marginTop: 10 }}>
      {t.chatSupport}
    </Button>
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

function OaInvite({ onDone }: { onDone: (note: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const finish = async (result: 'followed' | 'declined' | 'dismissed') => {
    trackEvent('oa_follow_result', 'miniapp', { placement: 'points_scan', result });
    await setOaPromptState({ promptSeen: true, followed: result === 'followed' });
    onDone(result === 'followed' ? t.oaFollowed : result === 'declined' ? t.oaDeclined : null);
  };
  const follow = async () => {
    setBusy(true);
    const followed = await followOA();
    if (followed) await requestNotifyPermission().catch(() => false);
    haptic(followed ? 'medium' : 'light');
    await finish(followed ? 'followed' : 'declined');
    setBusy(false);
  };
  return (
    <Card variant="outline" padding={16} style={{ marginTop: 12 }}>
      <div data-testid="oa-invite">
        <Text variant="label" as="div">{t.oaInviteTitle}</Text>
        <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 2 }}>{t.oaInviteBody}</Text>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <Button loading={busy} onPress={follow}>{t.oaFollow}</Button>
          <Button variant="ghost" disabled={busy} onPress={() => finish('dismissed')}>{t.oaLater}</Button>
        </div>
      </div>
    </Card>
  );
}

function ClaimForm({ fromCard, channel, initialCode }: { fromCard: boolean; channel: string | null; initialCode: string }) {
  const qc = useQueryClient();
  const hasPhone = useAuthStore((s) => !!s.user?.phone);
  const ensurePhone = useAuthStore((s) => s.ensurePhone);
  const giftNote = useCardGiftNote();
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needPhone, setNeedPhone] = useState(false);
  const [phoneDeclined, setPhoneDeclined] = useState(false);
  const [result, setResult] = useState<SubmitExternalClaimResponse | null>(null);
  const [rejectedCode, setRejectedCode] = useState<{ reject: string; code: string } | null>(null);
  const [oaState, setOaState] = useState<'unknown' | 'ask' | 'done'>(hasOA ? 'unknown' : 'done');
  const [oaNote, setOaNote] = useState<string | null>(null);
  const scanning = useRef(false);
  // Mã tới từ QR (quét trong app hoặc link trên nhãn riêng từng đơn): nút Tích điểm thành nút chính, gửi với via=scan.
  const [scanned, setScanned] = useState<string | null>(initialCode || null);
  const submitWrap = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialCode) {
      setCode(initialCode);
      setScanned(initialCode);
    }
  }, [initialCode]);

  useEffect(() => {
    if (scanned === null) return;
    submitWrap.current?.querySelector('button')?.focus();
  }, [scanned]);

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [result]);

  useEffect(() => {
    if (!hasOA) return;
    let alive = true;
    void getOaPromptState().then((s) => {
      if (alive) setOaState(s.promptSeen ? 'done' : 'ask');
    });
    return () => {
      alive = false;
    };
  }, []);

  const submit = useMutation({
    mutationFn: (v: { code: string; via: 'scan' | 'typed' }) => submitExternalClaim(v.code, v.via),
    onSuccess: (r) => {
      haptic('medium');
      setResult(r);
      setError(null);
      setNotice(null);
      setRejectedCode(null);
      setNeedPhone(false);
      setPhoneDeclined(false);
      setCode('');
      setScanned(null);
      void qc.invalidateQueries({ queryKey: ['external-claims'] });
    },
    onError: (e, v) => {
      setResult(null);
      setNotice(null);
      const rejected = externalClaimRejectCode(e);
      const blockedAccount = rejected === 'NOT_ELIGIBLE_USER' && hasPhone;
      setError(blockedAccount ? ACCOUNT_NOT_ELIGIBLE : rejected ? t.reject[rejected] : getErrorMessage(e));
      setRejectedCode(rejected ? { reject: rejected, code: v.code } : null);
      setNeedPhone(rejected === 'NOT_ELIGIBLE_USER' && !hasPhone);
    },
  });

  // Đăng nhập ngầm không xin SĐT, nên khách vào từ thẻ trong hộp hay từ sàn thường chưa có SĐT; máy chủ chỉ cộng điểm theo SĐT.
  const requestPhone = async (): Promise<boolean> => {
    let granted = false;
    try {
      granted = !!(await ensurePhone());
    } catch {
      /* người dùng huỷ hoặc Zalo lỗi: coi như chưa có SĐT, nút chia sẻ vẫn ở đó để thử lại */
    }
    trackEvent('ext_claim_phone', 'miniapp', { result: granted ? 'granted' : 'denied' });
    if (granted) return true;
    setError(null);
    setPhoneDeclined(true);
    setNeedPhone(true);
    return false;
  };

  const send = async (raw: string, via: 'scan' | 'typed') => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setError(t.emptyCode);
      return;
    }
    setResult(null);
    setNotice(null);
    if (!hasPhone && !(await requestPhone())) return;
    submit.mutate({ code: trimmed, via });
  };

  const sharePhone = async () => {
    const trimmed = code.trim();
    if (!(await requestPhone())) return;
    setNeedPhone(false);
    setPhoneDeclined(false);
    setError(null);
    if (trimmed) submit.mutate({ code: trimmed, via: scanned === trimmed ? 'scan' : 'typed' });
  };

  const scan = async () => {
    if (scanning.current) return;
    scanning.current = true;
    try {
      const res = await scanCode();
      if (res.kind !== 'ok') {
        trackEvent('ext_claim_scan', 'miniapp', { result: res.kind, parsed: 'none' });
        if (res.kind === 'failed') {
          setError(t.scanFailed);
          setNotice(null);
        }
        return;
      }
      const parsed = extractClaimCode(res.content);
      trackEvent('ext_claim_scan', 'miniapp', { result: 'ok', parsed: parsed.kind });
      if (parsed.kind === 'code' && parsed.code) {
        setCode(parsed.code);
        setError(null);
        setNotice(null);
        setScanned(parsed.code);
      } else if (parsed.kind === 'card_link' && parsed.code) {
        setCode(parsed.code);
        setError(null);
        setNotice(null);
        setScanned(parsed.code);
      } else if (parsed.kind === 'card_link') {
        setNotice(null);
        setError(t.scanCardLink);
      } else {
        setScanned(null);
        setCode(res.content.slice(0, 100));
        setNotice(null);
        setError(t.scanNoCode);
      }
    } catch {
      setError(t.scanFailed);
    } finally {
      scanning.current = false;
    }
  };

  const oaDone = (note: string | null) => {
    setOaState('done');
    setOaNote(note);
  };
  const showOaInvite = oaState === 'ask' && result != null && (result.status === 'CLAIMED' || result.status === 'REVIEW');
  const showSupportOnReject = rejectedCode?.reject === 'ALREADY_CLAIMED';

  return (
    <div style={{ padding: 16 }}>
      <Card variant="raised" padding={16}>
        {fromCard && (
          <div data-testid="card-welcome" style={{ marginBottom: 14 }}>
            <Text variant="body-lg" as="h2" style={{ fontWeight: 600 }}>{t.greeting(channel)}</Text>
            <div style={{ margin: '8px 0 0', display: 'grid', gap: 4 }}>
              {t.steps.map((step, i) => (
                <Text key={step} variant="body-sm" tone="secondary" as="div">{`${i + 1}. ${step}`}</Text>
              ))}
            </div>
          </div>
        )}
        <Button fullWidth size="lg" icon={ScanLine} onPress={scan}>{t.scanMain}</Button>
        {!hasPhone && (
          <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 8 }}>
            {t.phoneWhy}
          </Text>
        )}
        {giftNote === 'new-customers-only' && (
          <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 8 }}>
            <span role="status">{t.giftNewOnly}</span>
          </Text>
        )}
        <div style={{ marginTop: 16 }}>
          <Field label={t.inputLabel}>
            <Input
              placeholder={t.inputPlaceholder}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setScanned(null);
              }}
              autoCapitalize="characters"
              autoComplete="off"
            />
          </Field>
          <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 6 }}>
            {t.inputHelp}
          </Text>
        </div>
        {error && (
          <Text variant="body-sm" tone="danger" as="div" style={{ marginTop: 8 }}>
            <span role="alert">{error}</span>
          </Text>
        )}
        {notice && (
          <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 8 }}>
            <span role="status">{notice}</span>
          </Text>
        )}
        {phoneDeclined && !hasPhone && (
          <Text variant="body-sm" tone="secondary" as="div" data-testid="phone-declined" style={{ marginTop: 8 }}>
            <span role="status">{t.phoneDeclined}</span>
          </Text>
        )}
        {showSupportOnReject && rejectedCode && <SupportButton maskedCode={maskForSupport(rejectedCode.code)} />}
        {needPhone && !hasPhone && (
          <Button fullWidth variant="secondary" onPress={sharePhone} style={{ marginTop: 8 }}>{t.sharePhone}</Button>
        )}
        <div ref={submitWrap} style={{ marginTop: 12 }}>
          <Button
            fullWidth
            size={scanned !== null ? 'lg' : undefined}
            variant={scanned !== null ? 'primary' : 'secondary'}
            loading={submit.isPending}
            onPress={() => send(code, scanned !== null && scanned === code.trim() ? 'scan' : 'typed')}
          >
            {t.submit}
          </Button>
        </div>
      </Card>
      <div ref={resultRef} />
      {result && (
        <ResultCard result={result}>
          {result.status === 'CLAIMED_BY_OTHER' && <SupportButton maskedCode={result.maskedCode} />}
        </ResultCard>
      )}
      {showOaInvite && <OaInvite onDone={oaDone} />}
      {oaNote && (
        <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 8 }}>
          <span role="status">{oaNote}</span>
        </Text>
      )}
    </div>
  );
}

function ClosedView({ fromCard }: { fromCard: boolean }) {
  const navigate = useNavigate();
  return (
    <div data-testid={fromCard ? 'claim-soon' : 'claim-closed'}>
      <EmptyState
        art="sprout"
        heading={fromCard ? t.soonTitle : t.closedTitle}
        body={fromCard ? t.soonBody : t.closedBody}
        ctaLabel={t.soonShop}
        onCta={() => navigate('/browse')}
      />
      <div style={{ padding: '0 16px 24px' }}>
        <Button fullWidth variant="ghost" onPress={() => navigate('/')}>{t.soonHome}</Button>
      </div>
    </div>
  );
}

export default function ExternalPointsPage() {
  const phase = useAuthPhase();
  const { search } = useLocation();
  const cfgQ = useQuery({ queryKey: ['public-config'], queryFn: getPublicConfig, staleTime: 5 * 60_000 });
  const enabled = cfgQ.data?.loyalty?.marketplaceClaimEnabled === true;
  const { fromCard, channel } = cardEntryOf(getSessionAttribution());
  const initialCode = extractClaimCode(new URLSearchParams(search).get('code')).code ?? '';

  let body;
  if (cfgQ.isError) {
    body = <ErrorState message={getErrorMessage(cfgQ.error)} onRetry={() => void cfgQ.refetch()} />;
  } else if (cfgQ.isPending) {
    body = <div style={{ padding: 16 }}><Skeleton height={160} radius="var(--radius-card)" /></div>;
  } else if (!enabled) {
    body = <ClosedView fromCard={fromCard} />;
  } else if (phase !== 'authenticated') {
    body = <AuthPhaseView phase={phase} loading={<div style={{ padding: 16 }}><Skeleton height={160} radius="var(--radius-card)" /></div>} />;
  } else {
    body = (
      <>
        <ClaimForm fromCard={fromCard} channel={channel} initialCode={initialCode} />
        <PointsBoostStrip placement="scan" />
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
