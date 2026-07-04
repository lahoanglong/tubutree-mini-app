import { useState } from 'react';
import { Box, Text, Button, Input, Sheet, useSnackbar } from 'zmp-ui';
import { useMutation } from '@tanstack/react-query';
import { Hash, X } from 'lucide-react';
import { createPost, type CreatePostInput, type FeedCategory } from '../../services/feed-api';
import { getErrorMessage } from '../../services/api';
import { MultiImageUpload } from '../image-upload';
import { ProductPicker } from './product-picker';
import type { ProductSuggestion } from '../../services/shop-api';
import { haptic } from '../../utils/haptic';
import { vi } from '../../i18n/vi';

type ComposeKind = Extract<CreatePostInput['kind'], 'QUESTION' | 'SHOWCASE' | 'TIP'>;

const KINDS: { value: ComposeKind; label: string }[] = [
  { value: 'QUESTION', label: '❓ ' + vi.community.kindQuestion },
  { value: 'SHOWCASE', label: '🌿 ' + vi.community.kindShowcase },
  { value: 'TIP', label: '💡 ' + vi.community.kindTip },
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
}: {
  visible: boolean;
  onClose: () => void;
  categories: FeedCategory[];
  onPosted: () => void;
}) {
  const { openSnackbar } = useSnackbar();
  const [kind, setKind] = useState<ComposeKind>('QUESTION');
  const [category, setCategory] = useState<FeedCategory | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductSuggestion[]>([]);
  const [tagsRaw, setTagsRaw] = useState('');

  const tags = parseTags(tagsRaw);
  const removeTag = (t: string) => setTagsRaw(tags.filter((x) => x !== t).join(', '));

  const reset = () => {
    setKind('QUESTION');
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
    <Sheet visible={visible} onClose={onClose} autoHeight>
      <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
        <Text bold size="large">
          {vi.community.compose}
        </Text>

        <Box flex style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {KINDS.map((k) => (
            <Text
              key={k.value}
              size="small"
              onClick={() => {
                haptic('light');
                setKind(k.value);
              }}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--radius-full)',
                border: `1px solid ${kind === k.value ? 'var(--primary-600)' : 'var(--neutral-200)'}`,
                color: kind === k.value ? 'var(--primary-700)' : 'var(--neutral-600)',
                background: kind === k.value ? 'var(--primary-50)' : 'transparent',
              }}
            >
              {k.label}
            </Text>
          ))}
        </Box>

        {categories.length > 0 && (
          <Box mt={3}>
            <Text size="xSmall" bold style={{ marginBottom: 4 }}>
              {vi.community.pickCategory}
            </Text>
            <Box flex style={{ gap: 8, flexWrap: 'wrap' }}>
              {categories.map((c) => (
                <Text
                  key={c.id}
                  size="small"
                  onClick={() => {
                    haptic('light');
                    setCategory((prev) => (prev?.id === c.id ? null : c));
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-full)',
                    border: `1px solid ${category?.id === c.id ? 'var(--primary-600)' : 'var(--neutral-200)'}`,
                    color: category?.id === c.id ? 'var(--primary-700)' : 'var(--neutral-600)',
                    background: category?.id === c.id ? 'var(--primary-50)' : 'transparent',
                  }}
                >
                  {c.icon ?? ''} {c.name}
                </Text>
              ))}
            </Box>
          </Box>
        )}

        {kind === 'QUESTION' && (
          <Box mt={3}>
            <Input
              placeholder={vi.community.titlePlaceholder}
              value={title}
              maxLength={160}
              onChange={(e) => setTitle(e.target.value)}
            />
            {needsTitle && (
              <Text size="xSmall" style={{ color: 'var(--danger)', marginTop: 4 }}>
                {vi.community.needTitle}
              </Text>
            )}
          </Box>
        )}

        <Box mt={3}>
          <Input.TextArea
            placeholder={vi.community.bodyPlaceholder}
            value={body}
            maxLength={5000}
            rows={4}
            onChange={(e) => setBody(e.target.value)}
          />
        </Box>

        <MultiImageUpload value={images} onChange={setImages} max={6} />

        <ProductPicker value={products} onChange={setProducts} max={5} />

        <Box mt={3}>
          <Text size="xSmall" bold style={{ marginBottom: 4 }}>
            {vi.community.tags}
          </Text>
          <Input
            placeholder={vi.community.tagsPlaceholder}
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
          />
          {tags.length > 0 && (
            <Box flex style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {tags.map((t) => (
                <Box
                  key={t}
                  flex
                  alignItems="center"
                  style={{
                    gap: 4,
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-full)',
                    background: 'var(--leaf-100, var(--neutral-100))',
                    color: 'var(--leaf-700)',
                  }}
                >
                  <Hash size={11} />
                  <Text size="xSmall" style={{ color: 'var(--leaf-700)' }}>
                    {t}
                  </Text>
                  <Box
                    role="button"
                    aria-label={vi.common.cancel}
                    className="tubu-press"
                    onClick={() => {
                      haptic('light');
                      removeTag(t);
                    }}
                  >
                    <X size={11} />
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>

        <Button
          fullWidth
          loading={submit.isPending}
          disabled={!canSubmit || submit.isPending}
          onClick={() => submit.mutate()}
          style={{ marginTop: 16, background: 'var(--primary-600)' }}
        >
          {vi.community.post}
        </Button>
      </Box>
    </Sheet>
  );
}
