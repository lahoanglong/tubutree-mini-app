'use client';

import { useEffect, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Baby, Check, Droplets, Flag, Flower2, Leaf, Package, PawPrint, Recycle, Smile, Sparkles, Sprout, SprayCan, Sun, User, UserRound,
  Users, Wallet, type LucideIcon,
} from 'lucide-react';
import { completeOnboarding } from '@tubutree/app-core/api/account';
import { meQuery } from '@tubutree/app-core/queries/account';
import { hasPartnerLinkParams, ONBOARDING_SNOOZE_KEY, ONBOARDING_SNOOZE_MS, shouldShowOnboarding } from '@/components/account/onboarding-rules';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { platformBridge } from '@/lib/platform-bridge';
import { useModalA11y } from '@/lib/use-modal-a11y';
import { useShellPathname } from '@/lib/shell-pathname';

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

const SUBMIT_FAILED = 'Chưa gửi được câu trả lời. Kiểm tra mạng rồi thử lại.';

async function readSnoozedUntil(): Promise<number | null> {
  try {
    const raw = Number(await platformBridge.storage.get(ONBOARDING_SNOOZE_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Quiz chào khách mới ở Trang chủ (cùng luật hiện với `OnboardingGate` của Mini App, xem `onboarding-rules.ts`): chỉ khi đã đăng
 * nhập và chưa làm quiz, không phủ khi khách vào từ link CTV/gian hàng/thẻ QR, "Để sau" nhớ 7 ngày trên máy.
 */
export function OnboardingGate() {
  const phase = useAuthPhase();
  const pathname = useShellPathname();
  const [dismissed, setDismissed] = useState(false);
  // Đọc một lần lúc mở trang: khách vào bằng link CTV/gian hàng thì cả phiên không bị quiz chặn, kể cả khi CouponClaimGate đã xoá ?claim= khỏi URL.
  const [openedFromPartnerLink] = useState(() => typeof window !== 'undefined' && hasPartnerLinkParams(window.location.search, window.location.hash));
  // undefined = chưa đọc xong bộ nhớ máy; chưa đọc xong thì không hiện để tránh nháy quiz.
  const [snoozedUntil, setSnoozedUntil] = useState<number | null | undefined>(undefined);
  const meQ = useQuery({ ...meQuery(coreHttp), enabled: phase === 'authenticated' });

  useEffect(() => {
    let alive = true;
    void readSnoozedUntil().then((v) => {
      if (alive) setSnoozedUntil(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (phase !== 'authenticated' || !meQ.data || dismissed || snoozedUntil === undefined) return null;
  const show = shouldShowOnboarding({
    onboarded: meQ.data.onboarded,
    pathname,
    search: typeof window === 'undefined' ? '' : window.location.search,
    openedFromPartnerLink,
    snoozedUntil,
    now: Date.now(),
  });
  if (!show) return null;

  const snooze = () => {
    setDismissed(true);
    void platformBridge.storage.set(ONBOARDING_SNOOZE_KEY, String(Date.now() + ONBOARDING_SNOOZE_MS)).catch(() => undefined);
  };
  return <Onboarding onSnooze={snooze} onDone={() => setDismissed(true)} />;
}

function Onboarding({ onSnooze, onDone }: { onSnooze: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const panelRef = useModalA11y(onSnooze);
  const [step, setStep] = useState(0); // 0 = chào, 1..N = câu hỏi, N+1 = xong
  const [answers, setAnswers] = useState<Record<string, string[]>>({});

  const total = QUESTIONS.length;
  const finishStep = total + 1;

  const submit = useMutation({
    mutationFn: () => completeOnboarding(coreHttp, Object.values(answers).flat()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
      setStep(finishStep);
    },
  });

  const toggle = (q: Q, key: string) => {
    setAnswers((a) => {
      const cur = a[q.id] ?? [];
      if (q.multi) return { ...a, [q.id]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] };
      return { ...a, [q.id]: [key] };
    });
  };

  const light = 'inline-flex min-h-11 items-center justify-center rounded-control bg-stone-0 px-5 text-sm font-semibold text-forest-800 shadow-card transition active:scale-95 disabled:bg-forest-600 disabled:text-stone-100 disabled:shadow-none disabled:active:scale-100';

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Chào mừng đến Tubu Tree"
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-gradient-to-br from-forest-700 to-forest-800 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] pt-6 text-stone-0"
    >
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col">
        {step === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Sprout className="h-[72px] w-[72px] stroke-[1.5]" aria-hidden="true" />
            <h2 className="font-display text-2xl font-semibold">Chào mừng đến Tubu Tree!</h2>
            <p className="text-sm text-stone-100">Cho Tubu Tree biết bạn quan tâm điều gì nhé, chỉ mất chưa tới một phút.</p>
            <button type="button" onClick={() => setStep(1)} className={`${light} mt-4 min-w-[200px]`}>
              Bắt đầu
            </button>
            <TextButton onClick={onSnooze}>Để sau</TextButton>
          </div>
        )}

        {step >= 1 && step <= total && (() => {
          const q = QUESTIONS[step - 1]!;
          const sel = answers[q.id] ?? [];
          return (
            <div className="flex flex-1 flex-col">
              <div className="mb-6 flex gap-1.5" aria-hidden="true">
                {QUESTIONS.map((_, i) => (
                  <div key={i} className={`h-1 flex-1 rounded-full ${i < step ? 'bg-stone-0' : 'bg-forest-400'}`} />
                ))}
              </div>

              <h2 className="mb-1 font-display text-2xl font-semibold">{q.title}</h2>
              <p className="mb-5 text-xs text-stone-100">{q.multi ? 'Chọn nhiều đáp án' : 'Chọn 1 đáp án'}</p>

              <div role={q.multi ? 'group' : 'radiogroup'} aria-label={q.title} className="flex flex-col gap-2.5">
                {q.options.map((o) => {
                  const active = sel.includes(o.key);
                  return (
                    <button
                      key={o.key}
                      type="button"
                      role={q.multi ? 'checkbox' : 'radio'}
                      aria-checked={active}
                      onClick={() => toggle(q, o.key)}
                      className={`flex min-h-11 w-full items-center gap-3 rounded-card border-2 px-4 py-3.5 text-left transition active:scale-[0.99] ${
                        active ? 'border-stone-0 bg-stone-0 text-forest-800' : 'border-forest-500 bg-forest-800 text-stone-0'
                      }`}
                    >
                      <o.icon className="h-6 w-6 stroke-[1.75]" aria-hidden="true" />
                      <span className="flex-1 text-sm font-semibold">{o.label}</span>
                      {active && <Check className="h-5 w-5 stroke-[2.25]" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>

              {submit.isError && (
                <p role="alert" className="mt-3 rounded-control bg-stone-0 px-3 py-2 text-sm text-danger-fg">
                  {submit.error instanceof Error && submit.error.message ? submit.error.message : SUBMIT_FAILED}
                </p>
              )}

              <div className="mt-auto pt-5">
                <button
                  type="button"
                  className={`${light} w-full`}
                  disabled={sel.length === 0 || (step === total && submit.isPending)}
                  onClick={() => {
                    if (step < total) setStep(step + 1);
                    else submit.mutate();
                  }}
                >
                  {step < total ? 'Tiếp tục' : 'Hoàn tất'}
                </button>
                {step > 1 && (
                  <TextButton block onClick={() => setStep(step - 1)}>
                    Quay lại
                  </TextButton>
                )}
              </div>
            </div>
          );
        })()}

        {step === finishStep && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Leaf className="h-[72px] w-[72px] stroke-[1.5]" aria-hidden="true" />
            <h2 className="font-display text-2xl font-semibold">Tuyệt vời!</h2>
            <p className="text-sm text-stone-100">Cảm ơn bạn đã chia sẻ. Chúc bạn mua sắm sống xanh thật vui!</p>
            <button type="button" onClick={onDone} className={`${light} mt-4 min-w-[200px]`}>
              Khám phá ngay
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TextButton({ children, onClick, block }: { children: string; onClick: () => void; block?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex min-h-11 items-center justify-center px-4 text-sm font-medium text-stone-100 hover:underline ${block ? 'mt-2 w-full' : 'mt-1'}`}>
      {children}
    </button>
  );
}
