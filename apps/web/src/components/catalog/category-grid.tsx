import { browseText } from '@/lib/browse-text';
import { SEGMENT_ENTRIES, type CategoryEntry } from '@/lib/browse-categories';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Danh mục thật (có hàng) hoặc 4 phân khúc dự phòng, hiện khi chưa có truy vấn nào. Mỗi ô là `<button>` thật nên
 * Tab/Enter/Space hoạt động; tên truy cập là nhãn danh mục (icon chỉ để trang trí). Đang tải: khung chờ cùng chiều cao ô.
 */
export function CategoryGrid({
  entries,
  isLoading,
  onSelect,
  title = browseText.categories,
  placeholderCount = SEGMENT_ENTRIES.length,
}: {
  entries: CategoryEntry[];
  isLoading: boolean;
  onSelect: (entry: CategoryEntry) => void;
  title?: string;
  placeholderCount?: number;
}) {
  return (
    <section aria-label={title} className="py-2">
      <h2 className="mb-2 font-display text-lg font-semibold text-stone-900">{title}</h2>
      {isLoading ? (
        <div data-testid="category-grid-loading" aria-hidden="true" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: placeholderCount }, (_, i) => (
            <Skeleton key={i} height={48} rounded="rounded-card" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {entries.map((e) => (
            <button
              key={`${e.kind}:${e.key}`}
              type="button"
              onClick={() => onSelect(e)}
              className="flex min-h-12 min-w-0 items-center gap-2 rounded-card border border-stone-200 bg-stone-0 p-3 text-left transition hover:border-forest-600/40 hover:bg-forest-50"
            >
              <e.icon className="h-4 w-4 flex-none text-forest-600" aria-hidden="true" />
              <span className="min-w-0 truncate text-sm font-semibold text-stone-900">{e.label}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
