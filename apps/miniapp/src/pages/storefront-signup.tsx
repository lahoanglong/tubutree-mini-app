import { useState } from 'react';
import { Input, useNavigate, useSnackbar } from 'zmp-ui';
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
  type StorefrontEdit,
} from '../services/storefront-api';
import { getAffiliateMe } from '../services/affiliate-api';
import { getErrorMessage, getLoadErrorMessage } from '../services/api';
import { haptic } from '../utils/haptic';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ErrorState } from '../components/ui/empty-state';
import { Field } from '../components/ui/form';
import { Icon } from '../components/ui/icon';
import { PriceTag } from '../components/ui/price-tag';
import { ProgressBar } from '../components/ui/progress-bar';
import { Skeleton } from '../components/ui/skeleton';
import { SR_ONLY } from '../components/ui/sr-only';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { Heading, Text } from '../components/ui/text';
import { ImageUpload } from '../components/image-upload';
import { PickerSheet, TemplatePickerSheet, TEMPLATE_HINT, TEMPLATE_TITLE } from '../components/storefront-pickers';
import { StorefrontPreview } from '../components/storefront-preview';

const SECTION: React.CSSProperties = { margin: '0 16px 12px' };

interface Props {
  /** null = chưa có gian hàng (API trả 404). */
  sf: StorefrontEdit | null;
  onOpenEditor: () => void;
}

/**
 * Luồng 4 bước mở gian hàng cho CTV: điều kiện, thông tin, sản phẩm, xem trước và gửi duyệt. Dùng đúng API và luật duyệt đang có
 * (storefront.require_approval): bước cuối gọi lệnh đăng, máy chủ quyết gian hàng chờ duyệt hay hiện ngay.
 */
export function StorefrontSignupFlow({ sf, onOpenEditor }: Props) {
  const [step, setStep] = useState(sf ? 1 : 0);
  const last = SIGNUP_STEPS.length - 1;

  return (
    <div style={{ paddingBottom: 'calc(120px + var(--safe-bottom))' }}>
      <div style={{ padding: '12px 16px' }}>
        <Text variant="caption" tone="brand" as="div">
          {SIGNUP_COPY.stepOf(step + 1, SIGNUP_STEPS.length)}
        </Text>
        <Heading variant="title-md" as="h2" style={{ marginTop: 2 }}>{SIGNUP_STEPS[step]!.title}</Heading>
        <div style={{ marginTop: 8 }}>
          <ProgressBar value={step + 1} max={SIGNUP_STEPS.length} ariaLabel={`Bước ${step + 1} trên ${SIGNUP_STEPS.length}`} />
        </div>
        <ol style={{ display: 'flex', justifyContent: 'space-between', listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
          {SIGNUP_STEPS.map((s, i) => (
            <li key={s.key} aria-current={i === step ? 'step' : undefined}>
              <Text variant="caption" tone={i === step ? 'brand' : 'tertiary'} style={{ fontWeight: i === step ? 700 : 400 }}>
                {i < step ? '✓ ' : ''}{s.label}
              </Text>
            </li>
          ))}
        </ol>
      </div>

      {step === 0 && <ConditionsStep sf={sf} onStarted={() => setStep(1)} />}
      {step === 1 && sf && <InfoStep sf={sf} onBack={() => setStep(0)} onDone={() => setStep(2)} />}
      {step === 2 && sf && <ProductsStep sf={sf} onBack={() => setStep(1)} onDone={() => setStep(last)} />}
      {step === last && sf && <ReviewStep sf={sf} onBack={() => setStep(2)} />}
      {step >= 1 && !sf && <div style={{ padding: 16 }}><Skeleton height={120} radius="var(--radius-card)" /></div>}

      {sf && step > 0 && (
        <div style={{ ...SECTION, textAlign: 'center' }}>
          <Button variant="ghost" onPress={onOpenEditor}>{SIGNUP_COPY.openFullEditor}</Button>
        </div>
      )}
    </div>
  );
}

function ConditionsStep({ sf, onStarted }: { sf: StorefrontEdit | null; onStarted: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const meQ = useQuery({ queryKey: ['affiliate-me'], queryFn: getAffiliateMe, retry: false });
  const gate = signupGate(meQ.data);
  const startMut = useMutation({
    mutationFn: async () => {
      if (!sf) await createStorefront();
    },
    onSuccess: async () => {
      haptic('medium');
      await qc.invalidateQueries({ queryKey: ['my-storefront'] });
      onStarted();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  if (meQ.isLoading) return <div style={{ padding: 16 }}><Skeleton height={160} radius="var(--radius-card)" /></div>;
  if (meQ.isError) {
    return <div style={{ padding: 16 }}><ErrorState message={getLoadErrorMessage(meQ.error)} onRetry={() => void meQ.refetch()} /></div>;
  }

  return (
    <>
      <Card style={SECTION}>
        <Text variant="body-sm" tone="secondary" as="p" style={{ margin: '0 0 10px' }}>{SIGNUP_COPY.conditionsIntro}</Text>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {signupConditionRows(gate, sf, !sf || storefrontNeedsReview(sf)).map((c) => (
            <li key={c.text} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Icon icon={c.state === 'done' ? Check : c.state === 'info' ? Info : Circle} size="sm" tone={c.state === 'done' ? 'brand' : 'muted'} style={{ marginTop: 2, flexShrink: 0 }} />
              <div>
                <Text variant="body-sm">
                  {c.statusLabel && <span style={SR_ONLY}>{c.statusLabel}: </span>}
                  {c.text}
                </Text>
                {c.hint && <Text variant="caption" tone="tertiary" as="div">{c.hint}</Text>}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {gate === 'READY' && (
        <Text variant="body-sm" tone="brand" as="div" style={{ ...SECTION, fontWeight: 600 }}>✓ {SIGNUP_COPY.isCtv}</Text>
      )}
      {gate === 'NEEDS_CTV' && (
        <Card style={SECTION}>
          <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>{SIGNUP_COPY.needsCtv}</Text>
          <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 4 }}>{SIGNUP_COPY.registerHint}</Text>
        </Card>
      )}
      {gate === 'CANNOT_BE_CTV' && (
        <Card style={SECTION}>
          <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>{SIGNUP_COPY.cannotCtv}</Text>
          <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 4 }}>{SIGNUP_COPY.cannotCtvHint}</Text>
        </Card>
      )}

      {gate !== 'CANNOT_BE_CTV' && (
        <StickyActionBar
          primary={
            gate === 'READY' ? (
              <Button fullWidth loading={startMut.isPending} onPress={() => startMut.mutate()}>{SIGNUP_COPY.start}</Button>
            ) : (
              <Button fullWidth onPress={() => navigate('/affiliate')}>{SIGNUP_COPY.registerCta}</Button>
            )
          }
        />
      )}
    </>
  );
}

function InfoStep({ sf, onBack, onDone }: { sf: StorefrontEdit; onBack: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [title, setTitle] = useState(sf.title);
  const [note, setNote] = useState(sf.headerNote ?? '');
  const [avatarUrl, setAvatarUrl] = useState(sf.avatarUrl ?? '');
  const [coverUrl, setCoverUrl] = useState(sf.coverUrl ?? '');
  const [error, setError] = useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: () =>
      updateStorefront({ title: title.trim(), headerNote: note.trim(), avatarUrl: avatarUrl.trim(), coverUrl: coverUrl.trim() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['my-storefront'] });
      onDone();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const next = () => {
    const problem = validateStorefrontInfo({ title, headerNote: note });
    setError(problem);
    if (!problem) saveMut.mutate();
  };

  return (
    <>
      <Card style={SECTION}>
        <Text variant="body-sm" tone="secondary" as="p" style={{ margin: '0 0 12px' }}>{SIGNUP_COPY.infoIntro}</Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label={SIGNUP_COPY.titleLabel} error={error ?? undefined}>
            <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div>
            <Text variant="label" as="div" style={{ marginBottom: 2 }}>{SIGNUP_COPY.slugLabel}</Text>
            <Text variant="body-md" as="div">/s/{sf.slug}</Text>
            <Text variant="caption" tone="tertiary" as="div">{SIGNUP_COPY.slugHint}</Text>
          </div>
          <Field label={SIGNUP_COPY.noteLabel}>
            <Input.TextArea
              value={note}
              maxLength={STOREFRONT_NOTE_MAX}
              placeholder={SIGNUP_COPY.notePlaceholder}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <Text variant="label" tone="tertiary" as="div" style={{ marginTop: -8 }}>{note.length}/{STOREFRONT_NOTE_MAX}</Text>
        </div>
      </Card>
      <Card style={SECTION}>
        <Heading variant="title-sm" as="h3" style={{ marginBottom: 8 }}>{SIGNUP_COPY.imagesTitle}</Heading>
        <ImageUpload label="Ảnh đại diện" value={avatarUrl} onChange={setAvatarUrl} maxDim={400} quality={0.8} />
        <ImageUpload label="Ảnh bìa" value={coverUrl} onChange={setCoverUrl} maxDim={1000} quality={0.75} />
      </Card>
      <StepBar onBack={onBack} next={{ label: SIGNUP_COPY.next, loading: saveMut.isPending, onPress: next }} />
    </>
  );
}

function ProductsStep({ sf, onBack, onDone }: { sf: StorefrontEdit; onBack: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [pickerCol, setPickerCol] = useState<string | null>(null);
  const items = sf.collections.flatMap((c) => c.items);
  const refresh = () => qc.invalidateQueries({ queryKey: ['my-storefront'] });
  const fail = (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' });

  const templateMut = useMutation({
    mutationFn: (categoryId: string) => applyStorefrontTemplate(categoryId),
    onSuccess: async () => {
      haptic('medium');
      setTemplateOpen(false);
      await refresh();
    },
    onError: fail,
  });
  const openPicker = useMutation({
    mutationFn: async () => sf.collections[0]?.id ?? (await createCollection({ title: SIGNUP_COPY.defaultCollection })).id,
    onSuccess: (id) => setPickerCol(id),
    onError: fail,
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => removeItem(id),
    onSuccess: () => void refresh(),
    onError: fail,
  });

  return (
    <>
      <Text variant="body-sm" tone="secondary" as="p" style={{ ...SECTION, marginTop: 0 }}>{SIGNUP_COPY.productsIntro}</Text>

      {sf.collections.length === 0 && (
        <Card style={SECTION}>
          <Heading variant="title-sm" as="h3">{SIGNUP_COPY.templateTitle}</Heading>
          <Text variant="caption" tone="tertiary" as="div" style={{ margin: '2px 0 10px' }}>{SIGNUP_COPY.templateHint}</Text>
          <Button variant="secondary" fullWidth onPress={() => setTemplateOpen(true)}>Chọn danh mục</Button>
        </Card>
      )}

      <Card style={SECTION}>
        <Heading variant="title-sm" as="h3">{SIGNUP_COPY.selectedTitle(items.length)}</Heading>
        {items.length === 0 ? (
          <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 4 }}>{SIGNUP_COPY.noProducts}</Text>
        ) : (
          items.map((it) => (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body-sm" as="div">{it.product.name}</Text>
                <PriceTag value={it.product.salePrice ?? it.product.basePrice} size="sm" />
              </div>
              <button
                type="button"
                aria-label={`Bỏ ${it.product.name}`}
                className="tubu-press touch-target"
                onClick={() => removeMut.mutate(it.id)}
                style={{ minWidth: 44, minHeight: 44, border: 'none', background: 'transparent', cursor: 'pointer' }}
              >
                <Icon icon={Trash2} size="sm" tone="danger" />
              </button>
            </div>
          ))
        )}
        <Button variant="secondary" icon={Plus} loading={openPicker.isPending} style={{ marginTop: 10 }} onPress={() => openPicker.mutate()}>
          {SIGNUP_COPY.pickCta}
        </Button>
      </Card>

      <StepBar
        onBack={onBack}
        hint={items.length === 0 ? SIGNUP_COPY.needProduct : undefined}
        next={{ label: SIGNUP_COPY.next, disabled: items.length === 0, onPress: onDone }}
      />

      <BottomSheet open={templateOpen} onClose={() => setTemplateOpen(false)} title={TEMPLATE_TITLE} description={TEMPLATE_HINT}>
        <TemplatePickerSheet
          applying={templateMut.isPending}
          applyingCategoryId={templateMut.variables ?? null}
          onPick={(categoryId) => templateMut.mutate(categoryId)}
          onSkip={() => setTemplateOpen(false)}
          skipLoading={false}
          skipLabel="Để sau, tự chọn sản phẩm"
        />
      </BottomSheet>
      <BottomSheet open={!!pickerCol} onClose={() => setPickerCol(null)} title={SIGNUP_COPY.pickCta}>
        {pickerCol && <PickerSheet collectionId={pickerCol} onAdded={() => void refresh()} onClose={() => setPickerCol(null)} />}
      </BottomSheet>
    </>
  );
}

function ReviewStep({ sf, onBack }: { sf: StorefrontEdit; onBack: () => void }) {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const copy = storefrontPublishCopy(sf);
  const needsReview = storefrontNeedsReview(sf);
  const submitMut = useMutation({
    mutationFn: () => publishStorefront(true),
    onSuccess: async (res) => {
      haptic('medium');
      openSnackbar({ text: storefrontPublishedMessage(res, sf), type: 'success' });
      void qc.invalidateQueries({ queryKey: ['storefront-quests'] });
      await qc.invalidateQueries({ queryKey: ['my-storefront'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <>
      <Text variant="body-sm" tone="secondary" as="p" style={{ ...SECTION, marginTop: 0 }}>{SIGNUP_COPY.reviewIntro}</Text>
      <div style={SECTION}>
        <StorefrontPreview sf={sf} />
      </div>
      {needsReview && (
        <Card style={SECTION}>
          <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>{STOREFRONT_REVIEW_PROMISE}</Text>
        </Card>
      )}
      <StepBar onBack={onBack} next={{ label: copy.button, loading: submitMut.isPending, onPress: () => submitMut.mutate() }} />
    </>
  );
}

function StepBar({
  onBack, next, hint,
}: {
  onBack: () => void;
  next: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean };
  hint?: string;
}) {
  return (
    <StickyActionBar
      summary={hint ? <Text variant="caption" tone="secondary" as="div">{hint}</Text> : undefined}
      secondary={<Button variant="secondary" onPress={onBack}>{SIGNUP_COPY.back}</Button>}
      primary={<Button fullWidth loading={next.loading} disabled={next.disabled} onPress={next.onPress}>{next.label}</Button>}
    />
  );
}
