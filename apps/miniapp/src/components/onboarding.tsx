import { useEffect, useState } from 'react';
import { Box, Text, Button, useLocation, useSnackbar } from 'zmp-ui';
import { getStorage, setStorage } from 'zmp-sdk/apis';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMe, completeOnboarding } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { haptic } from '../utils/haptic';
import { hasPartnerLinkParams, ONBOARDING_SNOOZE_KEY, ONBOARDING_SNOOZE_MS, shouldShowOnboarding } from './onboarding-rules';

interface Q {
  id: string;
  title: string;
  multi: boolean;
  options: { key: string; label: string; emoji: string }[];
}

const QUESTIONS: Q[] = [
  {
    id: 'interest',
    title: 'Bạn quan tâm điều gì nhất?',
    multi: true,
    options: [
      { key: 'skincare', label: 'Chăm sóc da', emoji: '🧴' },
      { key: 'mom_baby', label: 'Mẹ & bé', emoji: '🍼' },
      { key: 'home_clean', label: 'Tẩy rửa nhà cửa', emoji: '🧼' },
      { key: 'eco', label: 'Sống xanh, tái chế', emoji: '♻️' },
      { key: 'men', label: 'Cho nam giới', emoji: '🧔' },
    ],
  },
  {
    id: 'skin',
    title: 'Làn da của bạn thế nào?',
    multi: false,
    options: [
      { key: 'sensitive_skin', label: 'Nhạy cảm', emoji: '🌸' },
      { key: 'oily_skin', label: 'Dầu', emoji: '💧' },
      { key: 'dry_skin', label: 'Khô', emoji: '🍂' },
      { key: 'normal_skin', label: 'Thường', emoji: '😊' },
    ],
  },
  {
    id: 'buyfor',
    title: 'Bạn thường mua sắm cho ai?',
    multi: true,
    options: [
      { key: 'self', label: 'Bản thân', emoji: '🙋' },
      { key: 'family', label: 'Gia đình', emoji: '👨‍👩‍👧' },
      { key: 'baby', label: 'Em bé', emoji: '👶' },
      { key: 'pet', label: 'Thú cưng', emoji: '🐾' },
    ],
  },
  {
    id: 'priority',
    title: 'Điều gì quan trọng nhất khi chọn sản phẩm?',
    multi: false,
    options: [
      { key: 'natural', label: 'Thành phần thiên nhiên', emoji: '🌿' },
      { key: 'price', label: 'Giá tốt', emoji: '💰' },
      { key: 'vietnamese', label: 'Thương hiệu Việt', emoji: '🇻🇳' },
      { key: 'packaging', label: 'Bao bì thân thiện', emoji: '📦' },
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

export function OnboardingGate() {
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
    <Box
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: 'linear-gradient(160deg, var(--leaf-600), var(--leaf-700))',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 20px calc(20px + var(--safe-bottom))',
        color: 'var(--neutral-0)',
        overflowY: 'auto',
      }}
    >
      {step === 0 && (
        <Box flex flexDirection="column" alignItems="center" justifyContent="center" style={{ flex: 1, textAlign: 'center', gap: 12 }}>
          <Text style={{ fontSize: 72 }}>🌱</Text>
          <Text bold style={{ color: 'var(--neutral-0)', fontSize: 24 }}>
            Chào mừng đến Tubu Tree!
          </Text>
          <Text style={{ color: 'var(--neutral-0)', opacity: 0.9 }}>
            Cho Tubu Tree biết bạn quan tâm điều gì nhé, chỉ mất chưa tới một phút.
          </Text>
          <Button onClick={() => setStep(1)} style={{ marginTop: 16, background: 'var(--neutral-0)', color: 'var(--leaf-700)', minWidth: 200 }}>
            Bắt đầu
          </Button>
          <TextButton onClick={onSnooze}>Để sau</TextButton>
        </Box>
      )}

      {step >= 1 && step <= total && (() => {
        const q = QUESTIONS[step - 1]!;
        const sel = answers[q.id] ?? [];
        return (
          <Box style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {/* Progress */}
            <Box flex style={{ gap: 6, marginBottom: 24 }}>
              {QUESTIONS.map((_, i) => (
                <Box
                  key={i}
                  style={{
                    flex: 1,
                    height: 4,
                    borderRadius: 99,
                    background: i < step ? 'var(--neutral-0)' : 'rgba(255,255,255,0.3)',
                  }}
                />
              ))}
            </Box>

            <Text bold style={{ color: 'var(--neutral-0)', fontSize: 22, marginBottom: 4 }}>
              {q.title}
            </Text>
            <Text size="xSmall" style={{ color: 'var(--neutral-0)', opacity: 0.8, marginBottom: 20 }}>
              {q.multi ? 'Chọn nhiều đáp án' : 'Chọn 1 đáp án'}
            </Text>

            <Box flex flexDirection="column" style={{ gap: 10 }}>
              {q.options.map((o) => {
                const active = sel.includes(o.key);
                return (
                  <Box
                    key={o.key}
                    className="tubu-press"
                    flex
                    alignItems="center"
                    onClick={() => toggle(q, o.key)}
                    style={{
                      gap: 12,
                      padding: '14px 16px',
                      borderRadius: 'var(--radius-lg)',
                      background: active ? 'var(--neutral-0)' : 'rgba(255,255,255,0.15)',
                      border: `2px solid ${active ? 'var(--neutral-0)' : 'rgba(255,255,255,0.3)'}`,
                    }}
                  >
                    <Text style={{ fontSize: 24 }}>{o.emoji}</Text>
                    <Text bold style={{ flex: 1, color: active ? 'var(--leaf-700)' : 'var(--neutral-0)' }}>
                      {o.label}
                    </Text>
                    {active && <Text style={{ color: 'var(--leaf-700)' }}>✓</Text>}
                  </Box>
                );
              })}
            </Box>

            <Box style={{ marginTop: 'auto', paddingTop: 20 }}>
              <Button
                fullWidth
                disabled={sel.length === 0 || (step === total && submit.isPending)}
                loading={step === total && submit.isPending}
                onClick={() => {
                  if (step < total) setStep(step + 1);
                  else submit.mutate();
                }}
                style={{ background: 'var(--neutral-0)', color: 'var(--leaf-700)' }}
              >
                {step < total ? 'Tiếp tục' : 'Hoàn tất'}
              </Button>
              {step > 1 && <TextButton onClick={() => setStep(step - 1)} block>Quay lại</TextButton>}
            </Box>
          </Box>
        );
      })()}

      {step === finishStep && (
        <Box flex flexDirection="column" alignItems="center" justifyContent="center" style={{ flex: 1, textAlign: 'center', gap: 12 }}>
          <Text style={{ fontSize: 72 }}>🌿</Text>
          <Text bold style={{ color: 'var(--neutral-0)', fontSize: 24 }}>
            Tuyệt vời!
          </Text>
          <Text style={{ color: 'var(--neutral-0)', opacity: 0.9 }}>
            Cảm ơn bạn đã chia sẻ. Chúc bạn mua sắm sống xanh thật vui!
          </Text>
          <Button onClick={onDone} style={{ marginTop: 16, background: 'var(--neutral-0)', color: 'var(--leaf-700)', minWidth: 200 }}>
            Khám phá ngay
          </Button>
        </Box>
      )}
    </Box>
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
        color: 'var(--neutral-0)',
        opacity: 0.8,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
