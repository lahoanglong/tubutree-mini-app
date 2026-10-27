import { browseText } from '@/lib/browse-text';
import { SEGMENT_ENTRIES, type CategoryEntry } from '@/lib/browse-categories';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollRow } from '@/components/mini/scroll-row';

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
      <h2 className="mb-2 font-display text-lg font-semibold text-stone-900 max-md:text-base">
        {title}
      </h2>
      {isLoading ? (
        <div
          data-testid="category-grid-loading"
          aria-hidden="true"
          className="scroll-x gap-2 max-md:-mx-4 max-md:max-w-none max-md:px-4 max-md:py-1 md:flex-wrap"
        >
          {Array.from({ length: placeholderCount }, (_, i) => (
            <div key={i} className="flex-none max-md:w-28 md:basis-[calc(25%-0.375rem)]">
              <Skeleton height={44} rounded="rounded-full md:rounded-card" />
            </div>
          ))}
        </div>
      ) : (
        <ScrollRow
          label={title}
          className="gap-2 max-md:-mx-4 max-md:max-w-none max-md:px-4 max-md:pb-2 max-md:pt-1 md:flex-wrap md:overflow-visible"
        >
          {entries.map((e) => (
            <button
              key={`${e.kind}:${e.key}`}
              type="button"
              onClick={() => onSelect(e)}
              className="flex min-h-11 min-w-0 flex-none items-center gap-2 whitespace-nowrap rounded-full border border-stone-200 bg-stone-0 px-3.5 text-left transition hover:border-forest-600/40 hover:bg-forest-50 md:min-h-12 md:basis-[calc(25%-0.375rem)] md:rounded-card md:p-3 md:whitespace-normal"
            >
              {e.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={e.image}
                  alt=""
                  width={24}
                  height={24}
                  loading="lazy"
                  className="h-6 w-6 flex-none rounded-md object-cover"
                />
              ) : (
                <e.icon className="h-5 w-5 flex-none text-forest-600" aria-hidden="true" />
              )}
              <span className="min-w-0 break-words text-sm font-semibold text-stone-900 md:line-clamp-2">
                {e.label}
              </span>
            </button>
          ))}
        </ScrollRow>
      )}
    </section>
  );
}
