import { useEffect, useState } from 'react';
import { ONBOARDING_SURVEY_ENABLED } from './onboarding-flag';
import { useLocation, useSnackbar } from 'zmp-ui';
import { getStorage, setStorage } from 'zmp-sdk/apis';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Baby, Check, Droplets, Flag, Flower2, Leaf, Package, PawPrint, Recycle, Smile, Sparkles, Sprout, SprayCan, Sun, User, UserRound,
  Users, Wallet, type LucideIcon,
} from 'lucide-react';
import { getMe, completeOnboarding } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { haptic } from '../utils/haptic';
import { hasPartnerLinkParams, ONBOARDING_SNOOZE_KEY, ONBOARDING_SNOOZE_MS, shouldShowOnboarding } from './onboarding-rules';
import { Button } from './ui/button';
import { Heading, Text } from './ui/text';

interface Q {
  id: string;
  title: string;
  multi: boolean;
  options: { key: string; label: string; icon: LucideIcon }[];
}

const QUESTIONS: Q[] = [
  {
    id: 'interest',
    title: 'Bạn quan tâm điều gì nhất?',
    multi: true,
    options: [
      { key: 'skincare', label: 'Chăm sóc da', icon: Sparkles },
      { key: 'mom_baby', label: 'Mẹ & bé', icon: Baby },
      { key: 'home_clean', label: 'Tẩy rửa nhà cửa', icon: SprayCan },
      { key: 'eco', label: 'Sống xanh, tái chế', icon: Recycle },
      { key: 'men', label: 'Cho nam giới', icon: User },
    ],
  },
  {
    id: 'skin',
    title: 'Làn da của bạn thế nào?',
    multi: false,
    options: [
      { key: 'sensitive_skin', label: 'Nhạy cảm', icon: Flower2 },
      { key: 'oily_skin', label: 'Dầu', icon: Droplets },
      { key: 'dry_skin', label: 'Khô', icon: Sun },
      { key: 'normal_skin', label: 'Thường', icon: Smile },
    ],
  },
  {
    id: 'buyfor',
    title: 'Bạn thường mua sắm cho ai?',
    multi: true,
    options: [
      { key: 'self', label: 'Bản thân', icon: UserRound },
      { key: 'family', label: 'Gia đình', icon: Users },
      { key: 'baby', label: 'Em bé', icon: Baby },
      { key: 'pet', label: 'Thú cưng', icon: PawPrint },
    ],
  },
  {
    id: 'priority',
    title: 'Điều gì quan trọng nhất khi chọn sản phẩm?',
    multi: false,
    options: [
      { key: 'natural', label: 'Thành phần thiên nhiên', icon: Leaf },
      { key: 'price', label: 'Giá tốt', icon: Wallet },
      { key: 'vietnamese', label: 'Thương hiệu Việt', icon: Flag },
      { key: 'packaging', label: 'Bao bì thân thiện', icon: Package },
    ],
  },
];

// Đọc một lần lúc mở app: khách vào bằng link CTV/gian hàng thì cả phiên không bị quiz chặn.
const OPENED_FROM_PARTNER_LINK =
  typeof window !== 'undefined' && hasPartnerLinkParams(window.location.search, window.location.hash);

async function readSnoozedUntil(): Promise<number | null> {
  try {
    const res = await getStorage({ keys: [ONBOARDING_SNOOZE_KEY] });
    const raw = Number((res as Record<string, unknown>)[ONBOARDING_SNOOZE_KEY]);
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  } catch {
    return null;
  }
}

export { ONBOARDING_SURVEY_ENABLED };

export function OnboardingGate({ enabled = ONBOARDING_SURVEY_ENABLED }: { enabled?: boolean } = {}) {
  return enabled ? <OnboardingGateInner /> : null;
}

function OnboardingGateInner() {
  const { status } = useAuthStore();
  const location = useLocation();
  const [dismissed, setDismissed] = useState(false);
  // undefined = chưa đọc xong bộ nhớ máy; chưa đọc xong thì không hiện để tránh nháy quiz.
  const [snoozedUntil, setSnoozedUntil] = useState<number | null | undefined>(undefined);
  const meQ = useQuery({ queryKey: ['me'], queryFn: getMe, enabled: status === 'authenticated' });

  useEffect(() => {
    let alive = true;
    void readSnoozedUntil().then((v) => {
      if (alive) setSnoozedUntil(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (status !== 'authenticated' || !meQ.data || dismissed || snoozedUntil === undefined) return null;
  const show = shouldShowOnboarding({
    onboarded: meQ.data.onboarded,
    pathname: location.pathname,
    search: location.search,
    openedFromPartnerLink: OPENED_FROM_PARTNER_LINK,
    snoozedUntil,
    now: Date.now(),
  });
  if (!show) return null;

  const snooze = () => {
    setDismissed(true);
    void setStorage({ data: { [ONBOARDING_SNOOZE_KEY]: String(Date.now() + ONBOARDING_SNOOZE_MS) } }).catch(() => undefined);
  };
  return <Onboarding onSnooze={snooze} onDone={() => setDismissed(true)} />;
}

function Onboarding({ onSnooze, onDone }: { onSnooze: () => void; onDone: () => void }) {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const [step, setStep] = useState(0); // 0 = welcome, 1..N = questions, N+1 = done
  const [answers, setAnswers] = useState<Record<string, string[]>>({});

  const total = QUESTIONS.length;
  const finishStep = total + 1;

  const submit = useMutation({
    mutationFn: () => completeOnboarding(Object.values(answers).flat()),
    onSuccess: () => {
      haptic('medium');
      void qc.invalidateQueries({ queryKey: ['me'] });
      setStep(finishStep);
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const toggle = (q: Q, key: string) => {
    haptic('light');
    setAnswers((a) => {
      const cur = a[q.id] ?? [];
      if (q.multi) {
        return { ...a, [q.id]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] };
      }
      return { ...a, [q.id]: [key] };
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Chào mừng đến Tubu Tree"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-onboarding)',
        background: 'linear-gradient(160deg, var(--color-action-primary-bg), var(--color-action-primary-bg-pressed))',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 20px calc(20px + var(--safe-bottom))',
        color: 'var(--color-text-inverse)',
        overflowY: 'auto',
      }}
    >
      {step === 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 12 }}>
          <Sprout size={72} strokeWidth={1.5} aria-hidden />
          <Heading variant="title-lg" as="h2" tone="inverse">
            Chào mừng đến Tubu Tree!
          </Heading>
          <Text variant="body-md" tone="inverse" as="p" style={{ opacity: 0.9 }}>
            Cho Tubu Tree biết bạn quan tâm điều gì nhé, chỉ mất chưa tới một phút.
          </Text>
          <Button variant="secondary" onPress={() => setStep(1)} style={{ marginTop: 16, minWidth: 200 }}>
            Bắt đầu
          </Button>
          <TextButton onClick={onSnooze}>Để sau</TextButton>
        </div>
      )}

      {step >= 1 && step <= total && (() => {
        const q = QUESTIONS[step - 1]!;
        const sel = answers[q.id] ?? [];
        return (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {/* Progress */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
              {QUESTIONS.map((_, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: 4,
                    borderRadius: 'var(--radius-pill)',
                    background: i < step ? 'var(--color-text-inverse)' : 'var(--forest-400)',
                  }}
                />
              ))}
            </div>

            <Heading variant="title-lg" as="h2" tone="inverse" style={{ marginBottom: 4 }}>
              {q.title}
            </Heading>
            <Text variant="caption" tone="inverse" as="p" style={{ opacity: 0.8, marginBottom: 20 }}>
              {q.multi ? 'Chọn nhiều đáp án' : 'Chọn 1 đáp án'}
            </Text>

            <div role={q.multi ? 'group' : 'radiogroup'} aria-label={q.title} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {q.options.map((o) => {
                const active = sel.includes(o.key);
                return (
                  <button
                    key={o.key}
                    type="button"
                    role={q.multi ? 'checkbox' : 'radio'}
                    aria-checked={active}
                    className="tubu-press"
                    onClick={() => toggle(q, o.key)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      width: '100%',
                      minHeight: 44,
                      padding: '14px 16px',
                      font: 'inherit',
                      textAlign: 'left',
                      borderRadius: 'var(--radius-card)',
                      background: active ? 'var(--color-bg-surface)' : 'var(--color-action-primary-bg-pressed)',
                      border: `2px solid ${active ? 'var(--color-bg-surface)' : 'var(--forest-500)'}`,
                      color: active ? 'var(--color-action-secondary-fg)' : 'var(--color-text-inverse)',
                    }}
                  >
                    <o.icon size={24} strokeWidth={1.75} aria-hidden />
                    <Text variant="body-md" style={{ flex: 1, fontWeight: 600, color: 'inherit' }}>
                      {o.label}
                    </Text>
                    {active && <Check size={20} strokeWidth={2.25} aria-hidden />}
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: 'auto', paddingTop: 20 }}>
              <Button
                variant="secondary"
                fullWidth
                disabled={sel.length === 0}
                loading={step === total && submit.isPending}
                onPress={() => {
                  if (step < total) setStep(step + 1);
                  else submit.mutate();
                }}
              >
                {step < total ? 'Tiếp tục' : 'Hoàn tất'}
              </Button>
              {step > 1 && <TextButton onClick={() => setStep(step - 1)} block>Quay lại</TextButton>}
            </div>
          </div>
        );
      })()}

      {step === finishStep && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 12 }}>
          <Leaf size={72} strokeWidth={1.5} aria-hidden />
          <Heading variant="title-lg" as="h2" tone="inverse">
            Tuyệt vời!
          </Heading>
          <Text variant="body-md" tone="inverse" as="p" style={{ opacity: 0.9 }}>
            Cảm ơn bạn đã chia sẻ. Chúc bạn mua sắm sống xanh thật vui!
          </Text>
          <Button variant="secondary" onPress={onDone} style={{ marginTop: 16, minWidth: 200 }}>
            Khám phá ngay
          </Button>
        </div>
      )}
    </div>
  );
}

function TextButton({ children, onClick, block }: { children: string; onClick: () => void; block?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: 44,
        padding: '0 16px',
        marginTop: block ? 8 : 4,
        width: block ? '100%' : undefined,
        background: 'none',
        border: 'none',
        font: 'inherit',
        fontSize: 'var(--type-caption-size)',
        color: 'var(--color-text-inverse)',
        opacity: 0.8,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
