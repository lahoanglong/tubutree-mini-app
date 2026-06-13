import { useState } from 'react';
import { Box, Text, Button, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMe, completeOnboarding } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { haptic } from '../utils/haptic';

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

export function OnboardingGate() {
  const { status } = useAuthStore();
  const [dismissed, setDismissed] = useState(false);
  const meQ = useQuery({ queryKey: ['me'], queryFn: getMe, enabled: status === 'authenticated' });

  if (status !== 'authenticated' || !meQ.data || meQ.data.onboarded || dismissed) return null;
  return <Onboarding onDone={() => setDismissed(true)} />;
}

function Onboarding({ onDone }: { onDone: () => void }) {
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
        color: '#fff',
        overflowY: 'auto',
      }}
    >
      {step === 0 && (
        <Box flex flexDirection="column" alignItems="center" justifyContent="center" style={{ flex: 1, textAlign: 'center', gap: 12 }}>
          <Text style={{ fontSize: 72 }}>🌱</Text>
          <Text bold style={{ color: '#fff', fontSize: 24 }}>
            Chào mừng đến Tubu Tree!
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.9)' }}>
            Trả lời vài câu hỏi nhanh để chúng mình gợi ý sản phẩm hợp với bạn — và nhận quà chào mừng.
          </Text>
          <Button onClick={() => setStep(1)} style={{ marginTop: 16, background: '#fff', color: 'var(--leaf-700)', minWidth: 200 }}>
            Bắt đầu
          </Button>
          <Text size="xSmall" onClick={onDone} style={{ color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
            Để sau
          </Text>
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
                    background: i < step ? '#fff' : 'rgba(255,255,255,0.3)',
                  }}
                />
              ))}
            </Box>

            <Text bold style={{ color: '#fff', fontSize: 22, marginBottom: 4 }}>
              {q.title}
            </Text>
            <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.8)', marginBottom: 20 }}>
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
                      background: active ? '#fff' : 'rgba(255,255,255,0.15)',
                      border: `2px solid ${active ? '#fff' : 'rgba(255,255,255,0.3)'}`,
                    }}
                  >
                    <Text style={{ fontSize: 24 }}>{o.emoji}</Text>
                    <Text bold style={{ flex: 1, color: active ? 'var(--leaf-700)' : '#fff' }}>
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
                disabled={sel.length === 0}
                loading={step === total && submit.isPending}
                onClick={() => {
                  if (step < total) setStep(step + 1);
                  else submit.mutate();
                }}
                style={{ background: '#fff', color: 'var(--leaf-700)' }}
              >
                {step < total ? 'Tiếp tục' : 'Hoàn tất'}
              </Button>
              {step > 1 && (
                <Text
                  size="xSmall"
                  onClick={() => setStep(step - 1)}
                  style={{ color: 'rgba(255,255,255,0.8)', textAlign: 'center', display: 'block', marginTop: 12 }}
                >
                  Quay lại
                </Text>
              )}
            </Box>
          </Box>
        );
      })()}

      {step === finishStep && (
        <Box flex flexDirection="column" alignItems="center" justifyContent="center" style={{ flex: 1, textAlign: 'center', gap: 12 }}>
          <Text style={{ fontSize: 72 }}>🎁</Text>
          <Text bold style={{ color: '#fff', fontSize: 24 }}>
            Tuyệt vời!
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.9)' }}>
            Chúng mình đã ghi nhận sở thích của bạn và sẽ gợi ý sản phẩm phù hợp hơn. Chúc bạn mua sắm
            sống xanh thật vui! 🌿
          </Text>
          <Button onClick={onDone} style={{ marginTop: 16, background: '#fff', color: 'var(--leaf-700)', minWidth: 200 }}>
            Khám phá ngay
          </Button>
        </Box>
      )}
    </Box>
  );
}
