import { vi } from '../../i18n/vi';
import { getErrorMessage } from '../../services/api';
import { Card } from '../ui/card';
import { ErrorState } from '../ui/empty-state';

export interface HomePageErrorProps {
  error?: unknown;
  /** Tải lại cả trang (thường là `refreshHomeQueries`) — trả Promise để biết lúc nào xong. */
  onRetry: () => unknown;
  retrying?: boolean;
}

/**
 * Dải lỗi cấp trang của Trang chủ (D7 mục 5): API sập hẳn thì một thẻ có tiêu đề, một nút "Thử lại" và hotline thay cho
 * hàng loạt thẻ lỗi từng kệ. Nằm ngay dưới ô tìm để khách thấy ngay, không phải kéo xuống mới biết trang đang lỗi.
 */
export function HomePageError({ error, onRetry, retrying }: HomePageErrorProps) {
  return (
    <section aria-label={vi.home.loadErrorTitle} data-testid="home-page-error" style={{ padding: '4px 16px 0' }}>
      <Card variant="outline" padding={0}>
        <ErrorState
          variant="inline"
          showSupport
          title={vi.home.loadErrorTitle}
          message={getErrorMessage(error)}
          retrying={retrying}
          onRetry={() => void onRetry()}
        />
      </Card>
    </section>
  );
}
