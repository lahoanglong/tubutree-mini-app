import type { ReactNode } from 'react';
import { History, Search } from 'lucide-react';
import type { ProductSuggestion } from '@tubutree/app-core/api/catalog';
import { browseText } from '@/lib/browse-text';
import type { CategoryEntry } from '@/lib/browse-categories';
import { formatVnd } from '@/lib/format-vnd';
import { cardPricing } from '@/lib/flash-price';
import { useActiveFlashSales } from '@/lib/use-flash-sales';
import { SUGGEST_MIN_CHARS } from '@/lib/use-suggest';
import { foldVietnamese, includesFolded } from '@/lib/vn-fold';
import { ui } from '@/lib/guest-ui';

export const SUGGEST_LIMITS = { recent: 3, categories: 4 } as const;

/**
 * Gợi ý khi gõ: từ khoá gần đây + danh mục (khớp không dấu ở client) + sản phẩm (API).
 *
 * A11y: mỗi dòng là `<button type="button">` thật, các nhóm là `role="group"` có tên — danh sách nút phẳng, không phải
 * listbox. Tên sản phẩm là dữ liệu nên chỉ được render dạng text của React. Không có gì để hiện (chưa gõ + chưa có lịch
 * sử) thì không vẽ khung rỗng.
 */
export function SuggestList({
  draft,
  recent,
  categories,
  products,
  loading,
  onPickKeyword,
  onPickCategory,
  onPickProduct,
  onClearRecent,
}: {
  draft: string;
  recent: string[];
  categories: CategoryEntry[];
  products: ProductSuggestion[];
  loading: boolean;
  onPickKeyword: (term: string) => void;
  onPickCategory: (entry: CategoryEntry) => void;
  onPickProduct: (product: ProductSuggestion, index: number) => void;
  onClearRecent: () => void;
}) {
  const flash = useActiveFlashSales();
  const term = draft.trim();
  const recentShown = term ? recent.filter((r) => includesFolded(r, term)).slice(0, SUGGEST_LIMITS.recent) : recent;
  const categoriesShown = term ? categories.filter((c) => includesFolded(c.label, term)).slice(0, SUGGEST_LIMITS.categories) : [];
  const productsShown = term ? products : [];
  const longEnough = foldVietnamese(term).length >= SUGGEST_MIN_CHARS;
  const nothing = longEnough && !loading && recentShown.length === 0 && categoriesShown.length === 0 && productsShown.length === 0;

  if (!term && recentShown.length === 0) return null;

  return (
    <section aria-label={browseText.suggest.title} className="pb-6">
      {term && (
        <SuggestRow icon={<Search className="h-4 w-4 text-stone-500" aria-hidden="true" />} onPress={() => onPickKeyword(term)}>
          {browseText.suggest.searchFor(term)}
        </SuggestRow>
      )}
      {recentShown.length > 0 && (
        <Group
          title={browseText.suggest.recent}
          action={
            term ? undefined : (
              <button type="button" onClick={onClearRecent} className={`${ui.btnText} text-forest-700`}>
                {browseText.suggest.clearRecent}
              </button>
            )
          }
        >
          {recentShown.map((r) => (
            <SuggestRow key={r} icon={<History className="h-4 w-4 text-stone-500" aria-hidden="true" />} onPress={() => onPickKeyword(r)}>
              {r}
            </SuggestRow>
          ))}
        </Group>
      )}
      {categoriesShown.length > 0 && (
        <Group title={browseText.suggest.categories}>
          {categoriesShown.map((c) => (
            <SuggestRow key={`${c.kind}:${c.key}`} icon={<c.icon className="h-4 w-4 text-forest-600" aria-hidden="true" />} onPress={() => onPickCategory(c)}>
              {c.label}
            </SuggestRow>
          ))}
        </Group>
      )}
      {productsShown.length > 0 && (
        <Group title={browseText.suggest.products}>
          {productsShown.map((p, i) => (
            <SuggestRow key={p.slug} icon={<Thumb src={p.thumbnail} />} subtitle={formatVnd(cardPricing(p, flash).price)} onPress={() => onPickProduct(p, i)}>
              {p.name}
            </SuggestRow>
          ))}
        </Group>
      )}
      {nothing && <p className="py-3 text-sm text-stone-600">{browseText.suggest.none}</p>}
    </section>
  );
}

function SuggestRow({ icon, subtitle, onPress, children }: { icon: ReactNode; subtitle?: string; onPress: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onPress} className="flex min-h-11 w-full items-center gap-2.5 py-1.5 text-left hover:bg-stone-50">
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-stone-900">{children}</span>
        {subtitle && <span className="block text-xs text-stone-600">{subtitle}</span>}
      </span>
    </button>
  );
}

function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="pt-2">
      <div className="flex min-h-11 items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-600">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Khung 40×40 giữ chỗ cố định nên ảnh tải xong không làm dòng nhảy. Ảnh chỉ để trang trí (alt=""). */
function Thumb({ src }: { src: string | null }) {
  return (
    <span aria-hidden="true" className="block h-10 w-10 flex-none overflow-hidden rounded-control bg-stone-100">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt="" loading="lazy" className="block h-full w-full object-cover" />}
    </span>
  );
}
