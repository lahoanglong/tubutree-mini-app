import { vi } from '../../i18n/vi';
import { Heading, Text } from '../ui/text';

export interface ListHeadingProps {
  /** Tên danh mục/phân khúc đang xem; null khi đang tìm kiếm (từ khoá đã nằm trong ô tìm). */
  title: string | null;
  /** Thiếu số (lần tải đầu lỗi) thì không in "0 sản phẩm": khách sẽ hiểu nhầm cửa hàng hết hàng. */
  count: number | undefined;
  isLoading: boolean;
}

/**
 * Một tiêu đề + một dòng số kết quả cho cả danh sách (thay "tên danh mục lặp ở chip, chip lọc và tiêu đề"). Số kết quả là vùng
 * `aria-live="polite"`: lúc đang tải chỉ có khoảng trắng không-ngắt (giữ chiều cao một dòng, không phát gì), khi có số mới trình đọc
 * màn hình đọc đúng một lần.
 */
export function ListHeading({ title, count, isLoading }: ListHeadingProps) {
  return (
    <div style={{ padding: '4px 16px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {title && (
        <Heading variant="title-sm" as="h2" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </Heading>
      )}
      <p aria-live="polite" aria-atomic="true" data-testid="result-count" style={{ margin: 0, minWidth: 0 }}>
        <Text variant="body-sm" tone="secondary">
          {isLoading || count === undefined ? ' ' : vi.browse.resultCount(count)}
        </Text>
      </p>
    </div>
  );
}
