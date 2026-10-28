'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Circle, Info, Plus, Trash2 } from 'lucide-react';
import {
  SIGNUP_COPY,
  SIGNUP_STEPS,
  STOREFRONT_NOTE_MAX,
  STOREFRONT_REVIEW_PROMISE,
  signupConditionRows,
  signupGate,
  storefrontNeedsReview,
  storefrontPublishCopy,
  storefrontPublishedMessage,
  validateStorefrontInfo,
} from '@tubutree/app-core/storefront-signup';
import {
  applyStorefrontTemplate,
  createCollection,
  createStorefront,
  publishStorefront,
  removeItem,
  updateStorefront,
  type StorefrontCategory,
  type StorefrontEdit,
} from '@tubutree/app-core/api/storefront';
import { affiliateMeQuery } from '@tubutree/app-core/queries/affiliate';
import { storefrontCategoriesQuery, storefrontQuestsQuery } from '@tubutree/app-core/queries/storefront';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { phoneSecondary } from '@/lib/phone-ui';
import { ErrorState } from '@/components/ui/error-state';
import { Field } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StorefrontImageUpload } from './storefront-image-upload';
import { StorefrontPreview } from './storefront-preview';
import { PickerSheet, actErrText, errText } from './storefront-sheets';

interface Props {
  /** null = chưa có gian hàng (API trả 404). */
  sf: StorefrontEdit | null;
  onOpenEditor: () => void;
}

/**
 * Luồng 4 bước mở gian hàng cho CTV, cùng bước và cùng chữ với Mini App: điều kiện, thông tin, sản phẩm, xem trước và gửi duyệt.
 * Bước cuối gọi lệnh đăng; máy chủ quyết gian hàng chờ duyệt hay hiện ngay theo storefront.require_approval.
 */
export function StorefrontSignupFlow({ sf, onOpenEditor }: Props) {
  const [step, setStep] = useState(sf ? 1 : 0);
  const last = SIGNUP_STEPS.length - 1;

  return (
    <div className="pb-24">
      <div className="py-1">
        <div className="text-xs font-semibold text-forest-700">{SIGNUP_COPY.stepOf(step + 1, SIGNUP_STEPS.length)}</div>
        <h2 className="mt-0.5 font-display text-lg font-semibold text-stone-900">{SIGNUP_STEPS[step]!.title}</h2>
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={SIGNUP_STEPS.length}
          aria-valuenow={step + 1}
          aria-label="Tiến độ đăng ký"
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200"
        >
          <div className="h-full rounded-full bg-forest-600" style={{ width: `${((step + 1) / SIGNUP_STEPS.length) * 100}%` }} />
        </div>
        <ol className="mt-1.5 flex justify-between">
          {SIGNUP_STEPS.map((s, i) => (
            <li key={s.key} aria-current={i === step ? 'step' : undefined} className={`text-xs ${i === step ? 'font-bold text-forest-700' : 'text-stone-600'}`}>
              {i < step ? '✓ ' : ''}
              {s.label}
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-3 space-y-3">
        {step === 0 && <ConditionsStep sf={sf} onStarted={() => setStep(1)} />}
        {step === 1 && sf && <InfoStep sf={sf} onBack={() => setStep(0)} onDone={() => setStep(2)} />}
        {step === 2 && sf && <ProductsStep sf={sf} onBack={() => setStep(1)} onDone={() => setStep(last)} />}
        {step === last && sf && <ReviewStep sf={sf} onBack={() => setStep(2)} />}
        {step >= 1 && !sf && <Skeleton height={120} />}
        {sf && step > 0 && (
          <div className="text-center">
            <button type="button" className={ui.btnText} onClick={onOpenEditor}>
              {SIGNUP_COPY.openFullEditor}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className={`${ui.card} p-4`}>{children}</section>;
}

/** Thanh hành động dính đáy: Quay lại + nút chính, cùng kiểu thanh dưới của trình dựng. */
function StepBar({
  onBack,
  next,
  hint,
}: {
  onBack?: () => void;
  next: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean };
  hint?: string;
}) {
  return (
    <div
      className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-stone-200 bg-stone-0 px-4 py-3"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
    >
      {hint && <p className="mb-2 text-xs text-stone-700">{hint}</p>}
      <div className="mx-auto flex max-w-5xl gap-2">
        {onBack && (
          <button type="button" className={`${ui.btnSecondary} ${phoneSecondary}`} onClick={onBack}>
            {SIGNUP_COPY.back}
          </button>
        )}
        <button type="button" className={`${ui.btnPrimary} min-w-0 flex-1`} disabled={next.disabled || next.loading} onClick={next.onPress}>
          {next.label}
        </button>
      </div>
    </div>
  );
}

function ConditionsStep({ sf, onStarted }: { sf: StorefrontEdit | null; onStarted: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const meQ = useQuery({ ...affiliateMeQuery(coreHttp), retry: false });
  const gate = signupGate(meQ.data);
  const startMut = useMutation({
    mutationFn: async () => {
      if (!sf) await createStorefront(coreHttp);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['my-storefront'] });
      onStarted();
    },
    onError: (e) => setError(actErrText(e)),
  });

  if (meQ.isLoading) return <Skeleton height={160} />;
  if (meQ.isError) return <ErrorState message={errText(meQ.error)} onRetry={() => void meQ.refetch()} />;

  return (
    <>
      <Card>
        <p className="mb-2.5 text-sm text-stone-600">{SIGNUP_COPY.conditionsIntro}</p>
        <ul className="flex flex-col gap-2">
          {signupConditionRows(gate, sf, !sf || storefrontNeedsReview(sf)).map((c) => {
            const MarkIcon = c.state === 'done' ? Check : c.state === 'info' ? Info : Circle;
            return (
              <li key={c.text} className="flex items-start gap-2 text-sm text-stone-900">
                <MarkIcon className={`mt-0.5 h-4 w-4 shrink-0 ${c.state === 'done' ? 'text-forest-700' : 'text-stone-500'}`} aria-hidden="true" />
                <span>
                  {c.text}
                  {c.hint && <span className="block text-xs text-stone-600">{c.hint}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      {gate === 'READY' && <p className="text-sm font-semibold text-forest-700">✓ {SIGNUP_COPY.isCtv}</p>}
      {gate === 'NEEDS_CTV' && (
        <Card>
          <p className="text-sm font-semibold text-stone-900">{SIGNUP_COPY.needsCtv}</p>
          <p className="mt-1 text-xs text-stone-600">{SIGNUP_COPY.registerHint}</p>
        </Card>
      )}
      {gate === 'CANNOT_BE_CTV' && (
        <Card>
          <p className="text-sm font-semibold text-stone-900">{SIGNUP_COPY.cannotCtv}</p>
          <p className="mt-1 text-xs text-stone-600">{SIGNUP_COPY.cannotCtvHint}</p>
        </Card>
      )}
      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}

      {gate === 'READY' && <StepBar next={{ label: SIGNUP_COPY.start, loading: startMut.isPending, onPress: () => startMut.mutate() }} />}
      {gate === 'NEEDS_CTV' && (
        <div
          className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-stone-200 bg-stone-0 px-4 py-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <Link href="/ctv" className={`${ui.btnPrimary} w-full`}>
            {SIGNUP_COPY.registerCta}
          </Link>
        </div>
      )}
    </>
  );
}

function InfoStep({ sf, onBack, onDone }: { sf: StorefrontEdit; onBack: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(sf.title);
  const [note, setNote] = useState(sf.headerNote ?? '');
  const [avatarUrl, setAvatarUrl] = useState(sf.avatarUrl ?? '');
  const [coverUrl, setCoverUrl] = useState(sf.coverUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: () => updateStorefront(coreHttp, { title: title.trim(), headerNote: note.trim(), avatarUrl: avatarUrl.trim(), coverUrl: coverUrl.trim() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['my-storefront'] });
      onDone();
    },
    onError: (e) => setSaveError(actErrText(e)),
  });

  const next = () => {
    const problem = validateStorefrontInfo({ title, headerNote: note });
    setError(problem);
    setSaveError(null);
    if (!problem) saveMut.mutate();
  };

  return (
    <>
      <Card>
        <p className="mb-3 text-sm text-stone-600">{SIGNUP_COPY.infoIntro}</p>
        <div className="flex flex-col gap-3">
          <Field label={SIGNUP_COPY.titleLabel} error={error ?? undefined}>
            <input className={ui.field} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div>
            <div className="text-sm font-medium text-stone-900">{SIGNUP_COPY.slugLabel}</div>
            <div className="text-sm text-stone-900">/s/{sf.slug}</div>
            <div className="text-xs text-stone-600">{SIGNUP_COPY.slugHint}</div>
          </div>
          <Field label={SIGNUP_COPY.noteLabel}>
            <textarea
              className={`${ui.field} py-2`}
              rows={3}
              maxLength={STOREFRONT_NOTE_MAX}
              placeholder={SIGNUP_COPY.notePlaceholder}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="-mt-2 text-xs text-stone-600">
            {note.length}/{STOREFRONT_NOTE_MAX}
          </div>
        </div>
      </Card>
      <Card>
        <h3 className={`${ui.sectionTitle} mb-2`}>{SIGNUP_COPY.imagesTitle}</h3>
        <StorefrontImageUpload label="Ảnh đại diện" value={avatarUrl} onChange={setAvatarUrl} maxDim={400} quality={0.8} />
        <StorefrontImageUpload label="Ảnh bìa" value={coverUrl} onChange={setCoverUrl} maxDim={1000} quality={0.75} />
      </Card>
      {saveError && (
        <p role="alert" className={ui.error}>
          {saveError}
        </p>
      )}
      <StepBar onBack={onBack} next={{ label: SIGNUP_COPY.next, loading: saveMut.isPending, onPress: next }} />
    </>
  );
}

function ProductsStep({ sf, onBack, onDone }: { sf: StorefrontEdit; onBack: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [pickerCol, setPickerCol] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = sf.collections.flatMap((c) => c.items);
  const refresh = () => qc.invalidateQueries({ queryKey: ['my-storefront'] });
  const fail = (e: unknown) => setError(actErrText(e));

  const templateMut = useMutation({
    mutationFn: (categoryId: string) => applyStorefrontTemplate(coreHttp, categoryId),
    onSuccess: async () => {
      setTemplateOpen(false);
      await refresh();
    },
    onError: fail,
  });
  const openPicker = useMutation({
    mutationFn: async () => sf.collections[0]?.id ?? (await createCollection(coreHttp, { title: SIGNUP_COPY.defaultCollection })).id,
    onSuccess: (id) => setPickerCol(id),
    onError: fail,
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => removeItem(coreHttp, id),
    onSuccess: () => void refresh(),
    onError: fail,
  });
  const catQ = useQuery({ ...storefrontCategoriesQuery(coreHttp), enabled: templateOpen });

  return (
    <>
      <p className="text-sm text-stone-600">{SIGNUP_COPY.productsIntro}</p>

      {sf.collections.length === 0 && (
        <Card>
          <h3 className={ui.sectionTitle}>{SIGNUP_COPY.templateTitle}</h3>
          <p className="mb-2.5 mt-0.5 text-xs text-stone-600">{SIGNUP_COPY.templateHint}</p>
          <button type="button" className={`${ui.btnSecondary} w-full`} onClick={() => setTemplateOpen(true)}>
            Chọn danh mục
          </button>
        </Card>
      )}

      <Card>
        <h3 className={ui.sectionTitle}>{SIGNUP_COPY.selectedTitle(items.length)}</h3>
        {items.length === 0 ? (
          <p className="mt-1 text-xs text-stone-600">{SIGNUP_COPY.noProducts}</p>
        ) : (
          items.map((it) => (
            <div key={it.id} className="flex items-center border-b border-stone-200 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-stone-900">{it.product?.name ?? 'Sản phẩm'}</div>
                <div className="text-sm font-semibold tabular-nums text-stone-900">{formatVnd(it.product?.salePrice ?? it.product?.basePrice ?? 0)}</div>
              </div>
              <button
                type="button"
                aria-label={`Bỏ ${it.product?.name ?? 'sản phẩm'}`}
                onClick={() => removeMut.mutate(it.id)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-danger-fg hover:bg-stone-100"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))
        )}
        <button type="button" className={`${ui.btnSecondary} mt-2.5`} disabled={openPicker.isPending} onClick={() => openPicker.mutate()}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {SIGNUP_COPY.pickCta}
        </button>
      </Card>
      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}

      <StepBar
        onBack={onBack}
        hint={items.length === 0 ? SIGNUP_COPY.needProduct : undefined}
        next={{ label: SIGNUP_COPY.next, disabled: items.length === 0, onPress: onDone }}
      />

      <Sheet open={templateOpen} onClose={() => setTemplateOpen(false)} title="Bắt đầu nhanh với 1 mẫu có sẵn" description={SIGNUP_COPY.templateHint}>
        {catQ.isLoading && <Skeleton height={120} />}
        {catQ.isError && <ErrorState message={errText(catQ.error)} onRetry={() => void catQ.refetch()} />}
        {catQ.data && (
          <div className="grid grid-cols-2 gap-2">
            {catQ.data.map((c: StorefrontCategory) => (
              <button
                key={c.id}
                type="button"
                aria-label={`Dùng mẫu ${c.name}`}
                aria-disabled={templateMut.isPending || undefined}
                onClick={() => !templateMut.isPending && templateMut.mutate(c.id)}
                className="min-h-11 rounded-card border border-stone-200 bg-stone-0 p-3 text-center text-sm"
              >
                {templateMut.isPending && templateMut.variables === c.id ? 'Đang dựng...' : c.name}
              </button>
            ))}
          </div>
        )}
        <button type="button" className={`${ui.btnSecondary} mt-4 w-full`} onClick={() => setTemplateOpen(false)}>
          Để sau, tự chọn sản phẩm
        </button>
      </Sheet>
      <PickerSheet open={!!pickerCol} collectionId={pickerCol} onClose={() => setPickerCol(null)} onAdded={() => void refresh()} />
    </>
  );
}

function ReviewStep({ sf, onBack }: { sf: StorefrontEdit; onBack: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const copy = storefrontPublishCopy(sf);
  const needsReview = storefrontNeedsReview(sf);
  const submitMut = useMutation({
    mutationFn: () => publishStorefront(coreHttp, true),
    onSuccess: async (res) => {
      setDone(storefrontPublishedMessage(res, sf));
      void qc.invalidateQueries({ queryKey: storefrontQuestsQuery(coreHttp).queryKey });
      await qc.invalidateQueries({ queryKey: ['my-storefront'] });
    },
    onError: (e) => setError(actErrText(e)),
  });

  return (
    <>
      <p className="text-sm text-stone-600">{SIGNUP_COPY.reviewIntro}</p>
      <StorefrontPreview sf={sf} />
      {needsReview && (
        <Card>
          <p className="text-sm font-semibold text-stone-900">{STOREFRONT_REVIEW_PROMISE}</p>
        </Card>
      )}
      <div role="status" aria-live="polite">
        {done && <p className="text-sm font-medium text-success-fg">{done}</p>}
      </div>
      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}
      <StepBar onBack={onBack} next={{ label: copy.button, loading: submitMut.isPending, onPress: () => submitMut.mutate() }} />
    </>
  );
}
