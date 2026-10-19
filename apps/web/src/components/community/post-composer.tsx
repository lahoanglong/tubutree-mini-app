'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Hash, HelpCircle, Leaf, Lightbulb, X, type LucideIcon } from 'lucide-react';
import { createPost, type CreatePostInput, type FeedCategory } from '@tubutree/app-core/api/feed';
import type { ProductSuggestion } from '@tubutree/app-core/api/catalog';
import { Sheet } from '@/components/ui/sheet';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { ImageUpload } from './image-upload';
import { ProductPicker } from './product-picker';

type ComposeKind = Extract<CreatePostInput['kind'], 'QUESTION' | 'SHOWCASE' | 'TIP'>;

const KINDS: { value: ComposeKind; label: string; Icon: LucideIcon }[] = [
  { value: 'QUESTION', label: 'Hỏi đáp', Icon: HelpCircle },
  { value: 'SHOWCASE', label: 'Trải nghiệm', Icon: Leaf },
  { value: 'TIP', label: 'Mẹo hay', Icon: Lightbulb },
];

const MAX_TAGS = 5;
const TITLE_PLACEHOLDER = 'Tiêu đề câu hỏi (vd: Nước rửa chén sinh học dùng được cho bình sữa không?)';

// Tách CHỈ theo dấu phẩy (giữ thẻ nhiều từ như "sen đá"), bỏ '#' đầu, bỏ rỗng, khử trùng không phân biệt hoa/thường
// (API chuẩn hoá về chữ thường), tối đa MAX_TAGS.
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

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

const chipClass = (on: boolean) =>
  `inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium ${
    on ? 'border-forest-600 bg-forest-600 text-stone-0' : 'border-stone-450 bg-stone-0 text-stone-800 hover:bg-stone-50'
  }`;

/** Khung soạn bài cộng đồng (cùng nội dung với `post-composer.tsx` của Mini App); `onPosted` nhận câu thông báo để trang hiện. */
export function PostComposer({
  open,
  onClose,
  categories,
  onPosted,
  eventId,
  eventTitle,
}: {
  open: boolean;
  onClose: () => void;
  categories: FeedCategory[];
  onPosted: (message: string) => void;
  eventId?: string;
  eventTitle?: string;
}) {
  const defaultKind: ComposeKind = eventId ? 'SHOWCASE' : 'QUESTION';
  const [kind, setKind] = useState<ComposeKind>(defaultKind);
  const [category, setCategory] = useState<FeedCategory | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductSuggestion[]>([]);
  const [tagsRaw, setTagsRaw] = useState('');

  const tags = parseTags(tagsRaw);
  const removeTag = (t: string) => setTagsRaw(tags.filter((x) => x !== t).join(', '));
  const reset = () => {
    setKind(defaultKind);
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
      createPost(coreHttp, {
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
      reset();
      onPosted(res.status === 'PENDING' ? 'Bài đang chờ duyệt, sẽ hiện sau khi được duyệt 🌱' : 'Đã đăng bài 🌿');
    },
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Đăng bài"
      size="full"
      footer={
        <button type="button" disabled={!canSubmit || submit.isPending} onClick={() => submit.mutate()} className={`${ui.btnPrimary} w-full`}>
          {submit.isPending ? 'Đang đăng…' : 'Đăng'}
        </button>
      }
    >
      {eventId && <div className="mt-2 rounded-control bg-stone-100 px-3 py-2 text-sm font-semibold text-forest-700">Dự thi: {eventTitle}</div>}

      <div className="mt-3 flex flex-wrap gap-2">
        {KINDS.map(({ value, label, Icon }) => (
          <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)} className={chipClass(kind === value)}>
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {categories.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-sm font-semibold text-stone-900">Chọn danh mục</div>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button key={c.id} type="button" aria-pressed={category?.id === c.id} onClick={() => setCategory((prev) => (prev?.id === c.id ? null : c))} className={chipClass(category?.id === c.id)}>
                {`${c.icon ?? ''} ${c.name}`.trim()}
              </button>
            ))}
          </div>
        </div>
      )}

      {kind === 'QUESTION' && (
        <div className="mt-3">
          <input aria-label={TITLE_PLACEHOLDER} placeholder={TITLE_PLACEHOLDER} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} className={ui.field} />
          {needsTitle && <p className="mt-1 text-xs text-danger-fg">Câu hỏi cần có tiêu đề</p>}
        </div>
      )}

      <div className="mt-3">
        <textarea
          aria-label="Chia sẻ chi tiết…"
          placeholder="Chia sẻ chi tiết…"
          value={body}
          maxLength={5000}
          rows={4}
          onChange={(e) => setBody(e.target.value)}
          className={`${ui.field} min-h-28 py-2`}
        />
      </div>

      <ImageUpload value={images} onChange={setImages} max={6} />

      <ProductPicker value={products} onChange={setProducts} max={5} />

      <div className="mb-3 mt-3">
        <label htmlFor="community-tags" className="mb-1 block text-sm font-semibold text-stone-900">
          Thẻ (hashtag)
        </label>
        <input
          id="community-tags"
          aria-label="Thẻ (hashtag)"
          placeholder="vd: da nhạy cảm, đồ cho bé (cách nhau dấu phẩy)"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          className={ui.field}
        />
        {tags.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <li key={t} className="flex items-center gap-1 rounded-full bg-stone-100 pl-2 text-xs text-forest-700">
                <Hash className="h-3.5 w-3.5" aria-hidden="true" />
                {t}
                <button type="button" aria-label={`Gỡ thẻ ${t}`} onClick={() => removeTag(t)} className="inline-flex h-11 min-h-11 w-11 items-center justify-center">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {submit.isError && (
        <p role="alert" className={ui.error}>
          {errorText(submit.error)}
        </p>
      )}
    </Sheet>
  );
}
