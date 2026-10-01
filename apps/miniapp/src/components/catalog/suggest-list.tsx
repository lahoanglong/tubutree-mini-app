import type { CSSProperties, ReactNode } from 'react';
import { History, Search } from 'lucide-react';
import type { CategoryEntry } from '../../hooks/use-categories';
import { SUGGEST_MIN_CHARS } from '../../hooks/use-suggest';
import type { ProductSuggestion } from '../../services/shop-api';
import { vi } from '../../i18n/vi';
import { foldVietnamese, includesFolded } from '../../utils/vn-fold';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { PriceTag } from '../ui/price-tag';
import { Text } from '../ui/text';

export const SUGGEST_LIMITS = { recent: 3, categories: 4 } as const;

export interface SuggestListProps {
  draft: string;
  recent: string[];
  categories: CategoryEntry[];
  products: ProductSuggestion[];
  loading: boolean;
  onPickKeyword: (term: string) => void;
  onPickCategory: (entry: CategoryEntry) => void;
  onPickProduct: (product: ProductSuggestion, index: number) => void;
  onClearRecent: () => void;
}

const ELLIPSIS: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

/**
 * Gợi ý khi gõ (spec 5b.2): từ khoá gần đây + danh mục (khớp không dấu ở client) + sản phẩm (API).
 *
 * A11y: mỗi dòng là `<button type="button">` thật (Tab/Enter/Space), các nhóm là `role="group"` có tên —
 * một danh sách nút phẳng, không phải listbox (không cần mũi tên/aria-selected). Tên sản phẩm là dữ liệu
 * nên chỉ được render dạng text của React (không bao giờ HTML).
 * Không có gì để hiện (chưa gõ + chưa có lịch sử) → không vẽ khung rỗng.
 */
export function SuggestList({ draft, recent, categories, products, loading, onPickKeyword, onPickCategory, onPickProduct, onClearRecent }: SuggestListProps) {
  const term = draft.trim();
  const recentShown = term ? recent.filter((r) => includesFolded(r, term)).slice(0, SUGGEST_LIMITS.recent) : recent;
  const categoriesShown = term ? categories.filter((c) => includesFolded(c.label, term)).slice(0, SUGGEST_LIMITS.categories) : [];
  const productsShown = term ? products : []; // chưa gõ gì thì chỉ có lịch sử, kể cả khi caller còn giữ kết quả cũ
  // Cùng cổng "đủ dài" với useSuggest (đã bỏ dấu), nên "́" lẻ / khoảng trắng không tính là ký tự.
  const longEnough = foldVietnamese(term).length >= SUGGEST_MIN_CHARS;
  const nothing = longEnough && !loading && recentShown.length === 0 && categoriesShown.length === 0 && productsShown.length === 0;

  if (!term && recentShown.length === 0) return null;

  return (
    <section aria-label={vi.browse.suggest.title} style={{ padding: '0 16px 24px' }}>
      {term && (
        <SuggestRow icon={<Icon icon={Search} size="sm" tone="muted" />} onPress={() => onPickKeyword(term)}>
          {vi.browse.suggest.searchFor(term)}
        </SuggestRow>
      )}
      {recentShown.length > 0 && (
        <Group
          title={vi.browse.suggest.recent}
          action={
            term ? undefined : (
              <Button variant="ghost" onPress={onClearRecent} style={{ minWidth: 0 }}>
                {vi.browse.suggest.clearRecent}
              </Button>
            )
          }
        >
          {recentShown.map((r) => (
            <SuggestRow key={r} icon={<Icon icon={History} size="sm" tone="muted" />} onPress={() => onPickKeyword(r)}>
              {r}
            </SuggestRow>
          ))}
        </Group>
      )}
      {categoriesShown.length > 0 && (
        <Group title={vi.browse.suggest.categories}>
          {categoriesShown.map((c) => (
            <SuggestRow key={`${c.kind}:${c.key}`} icon={<Icon icon={c.icon} size="sm" tone="brand" />} onPress={() => onPickCategory(c)}>
              {c.label}
            </SuggestRow>
          ))}
        </Group>
      )}
      {productsShown.length > 0 && (
        <Group title={vi.browse.suggest.products}>
          {productsShown.map((p, i) => (
            <SuggestRow key={p.slug} icon={<Thumb src={p.thumbnail} />} subtitle={<PriceTag value={p.basePrice} size="sm" />} onPress={() => onPickProduct(p, i)}>
              {p.name}
            </SuggestRow>
          ))}
        </Group>
      )}
      {nothing && (
        <Text variant="body-sm" tone="tertiary" as="p" style={{ padding: '12px 0' }}>
          {vi.browse.suggest.none}
        </Text>
      )}
    </section>
  );
}

function SuggestRow({ icon, subtitle, onPress, children }: { icon: ReactNode; subtitle?: ReactNode; onPress: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="tubu-press"
      onClick={onPress}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        minHeight: 44,
        padding: '6px 0',
        boxSizing: 'border-box',
        textAlign: 'left',
        fontFamily: 'inherit',
        background: 'none',
        border: 0,
      }}
    >
      {icon}
      <span style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body-sm" as="span" style={{ ...ELLIPSIS, fontWeight: 600 }}>
          {children}
        </Text>
        {subtitle}
      </span>
    </button>
  );
}

function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} style={{ paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        <Text variant="label" tone="secondary">
          {title}
        </Text>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Khung 40×40 giữ chỗ cố định → ảnh tải xong không làm dòng nhảy. Ảnh chỉ để trang trí (alt=""). */
function Thumb({ src }: { src: string | null }) {
  return (
    <span aria-hidden="true" style={{ display: 'block', width: 40, height: 40, flex: '0 0 auto', borderRadius: 'var(--radius-media)', overflow: 'hidden', background: 'var(--color-bg-subtle)' }}>
      {src && <img src={src} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
    </span>
  );
}
