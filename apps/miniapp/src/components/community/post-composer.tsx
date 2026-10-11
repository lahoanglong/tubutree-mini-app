import { useState } from 'react';
import { Input, useSnackbar } from 'zmp-ui';
import { useMutation } from '@tanstack/react-query';
import { Hash, HelpCircle, Leaf, Lightbulb, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { createPost, type CreatePostInput, type FeedCategory } from '../../services/feed-api';
import { getErrorMessage } from '../../services/api';
import { MultiImageUpload } from '../image-upload';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { Icon } from '../ui/icon';
import { IconButton } from '../ui/icon-button';
import { Text } from '../ui/text';
import { ProductPicker } from './product-picker';
import type { ProductSuggestion } from '../../services/shop-api';
import { haptic } from '../../utils/haptic';
import { vi } from '../../i18n/vi';

type ComposeKind = Extract<CreatePostInput['kind'], 'QUESTION' | 'SHOWCASE' | 'TIP'>;

const KINDS: { value: ComposeKind; label: string; icon: LucideIcon }[] = [
  { value: 'QUESTION', label: vi.community.kindQuestion, icon: HelpCircle },
  { value: 'SHOWCASE', label: vi.community.kindShowcase, icon: Leaf },
  { value: 'TIP', label: vi.community.kindTip, icon: Lightbulb },
];

const MAX_TAGS = 5;

// Tách CHỈ theo dấu phẩy (giữ thẻ nhiều từ — vd "sen đá"), bỏ '#' đầu, trim, bỏ rỗng,
// khử trùng KHÔNG phân biệt hoa/thường (BE slugify về chữ thường), cap MAX_TAGS.
function parseTags(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of raw.split(',')) {
    const label = piece.trim().replace(/^#+/, '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export default function PostComposer({
  visible,
  onClose,
  categories,
  onPosted,
  eventId,
  eventTitle,
}: {
  visible: boolean;
  onClose: () => void;
  categories: FeedCategory[];
  onPosted: () => void;
  eventId?: string;
  eventTitle?: string;
}) {
  const { openSnackbar } = useSnackbar();
  // Mở từ 1 sự kiện → mặc định "Khoe vườn" (khoe thành quả dự thi) thay vì "Hỏi đáp".
  const [kind, setKind] = useState<ComposeKind>(eventId ? 'SHOWCASE' : 'QUESTION');
  const [category, setCategory] = useState<FeedCategory | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductSuggestion[]>([]);
  const [tagsRaw, setTagsRaw] = useState('');

  const tags = parseTags(tagsRaw);
  const removeTag = (t: string) => setTagsRaw(tags.filter((x) => x !== t).join(', '));

  const reset = () => {
    setKind(eventId ? 'SHOWCASE' : 'QUESTION');
    setCategory(null);
    setTitle('');
    setBody('');
    setImages([]);
    setProducts([]);
    setTagsRaw('');
  };

  const needsTitle = kind === 'QUESTION' && title.trim().length === 0;
  const canSubmit = body.trim().length > 0 && !needsTitle;

  const submit = useMutation({
    mutationFn: () =>
      createPost({
        kind,
        categoryId: category?.id,
        title: kind === 'QUESTION' ? title.trim() : undefined,
        body: body.trim(),
        images: images.length > 0 ? images : undefined,
        productSlugs: products.map((p) => p.slug),
        tagSlugs: tags.length > 0 ? tags : undefined,
        eventId,
      }),
    onSuccess: (res) => {
      haptic('medium');
      if (res.status === 'PENDING') {
        openSnackbar({ text: vi.community.pendingNotice, type: 'info' });
      } else {
        openSnackbar({ text: vi.community.posted, type: 'success' });
      }
      reset();
      onPosted();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <BottomSheet
      open={visible}
      onClose={onClose}
      title={vi.community.compose}
      size="full"
      footer={
        <Button
          fullWidth
          loading={submit.isPending}
          disabled={!canSubmit}
          onPress={() => submit.mutate()}
        >
          {vi.community.post}
        </Button>
      }
    >
      {eventId && (
        <div
          style={{
            background: 'var(--color-bg-subtle)',
            borderRadius: 'var(--radius-control)',
            padding: '8px 12px',
            marginTop: 8,
          }}
        >
          <Text variant="body-sm" tone="brand" style={{ fontWeight: 600 }}>
            {vi.community.entryFor}: {eventTitle}
          </Text>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {KINDS.map((k) => (
          <Chip
            key={k.value}
            icon={k.icon}
            selected={kind === k.value}
            onPress={() => {
              haptic('light');
              setKind(k.value);
            }}
          >
            {k.label}
          </Chip>
        ))}
      </div>

      {categories.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text variant="label" as="div" style={{ marginBottom: 4 }}>
            {vi.community.pickCategory}
          </Text>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {categories.map((c) => (
              <Chip
                key={c.id}
                selected={category?.id === c.id}
                onPress={() => {
                  haptic('light');
                  setCategory((prev) => (prev?.id === c.id ? null : c));
                }}
              >
                {`${c.icon ?? ''} ${c.name}`.trim()}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {kind === 'QUESTION' && (
        <div style={{ marginTop: 12 }}>
          <Input
            aria-label={vi.community.titlePlaceholder}
            placeholder={vi.community.titlePlaceholder}
            value={title}
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
          />
          {needsTitle && (
            <Text variant="caption" tone="danger" as="div" style={{ marginTop: 4 }}>
              {vi.community.needTitle}
            </Text>
          )}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <Input.TextArea
          aria-label={vi.community.bodyPlaceholder}
          placeholder={vi.community.bodyPlaceholder}
          value={body}
          maxLength={5000}
          rows={4}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>

      <MultiImageUpload value={images} onChange={setImages} max={6} label="Ảnh đính kèm bài viết" />

      <ProductPicker value={products} onChange={setProducts} max={5} />

      <div style={{ marginTop: 12, marginBottom: 12 }}>
        <Text variant="label" as="div" style={{ marginBottom: 4 }}>
          {vi.community.tags}
        </Text>
        <Input
          aria-label={vi.community.tags}
          placeholder={vi.community.tagsPlaceholder}
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
        />
        {tags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {tags.map((t) => (
              <div
                key={t}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '0 0 0 8px',
                  borderRadius: 'var(--radius-pill)',
                  background: 'var(--color-bg-subtle)',
                }}
              >
                <Icon icon={Hash} size="sm" tone="brand" />
                <Text variant="caption" tone="brand">
                  {t}
                </Text>
                <IconButton
                  icon={X}
                  size="sm"
                  label={vi.common.cancel}
                  onPress={() => {
                    haptic('light');
                    removeTag(t);
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
