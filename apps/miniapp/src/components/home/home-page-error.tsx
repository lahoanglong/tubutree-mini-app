import { useRef } from 'react';
import { vi } from '../../i18n/vi';
import { getLoadErrorMessage } from '../../services/api';
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
  const busy = useRef(false);
  // `retrying` chỉ đúng sau lần dựng lại kế tiếp nên hai cú chạm sát nhau vẫn tải lại hai lần; ref đồng bộ chặn ngay. Lỗi tải đã hiện ở từng khối nên chỉ cần nhả khoá.
  const retry = () => {
    if (busy.current) return;
    busy.current = true;
    const release = () => {
      busy.current = false;
    };
    try {
      Promise.resolve(onRetry()).then(release, release);
    } catch (e) {
      release();
      throw e;
    }
  };
  return (
    <section aria-label={vi.home.loadErrorTitle} data-testid="home-page-error" style={{ padding: '4px 16px 0' }}>
      <Card variant="outline" padding={0}>
        <ErrorState
          variant="inline"
          showSupport
          title={vi.home.loadErrorTitle}
          message={getLoadErrorMessage(error)}
          retrying={retrying}
          onRetry={retry}
        />
      </Card>
    </section>
  );
}
