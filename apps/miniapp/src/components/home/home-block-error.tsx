import { vi } from '../../i18n/vi';
import { getErrorMessage } from '../../services/api';
import { haptic } from '../../utils/haptic';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Heading, Text } from '../ui/text';

export interface HomeBlockErrorProps {
  title: string;
  error?: unknown;
  /** Thường là `query.refetch` — trả Promise thì Button tự khoá bấm lại tới khi xong. */
  onRetry: () => unknown;
  /** Đang tải lại sau lỗi: query lỗi vẫn `isLoading=false` nên phải truyền riêng `isFetching`. */
  retrying?: boolean;
}

/**
 * Khối lỗi gọn của Trang chủ (C-084): giữ tiêu đề + một dòng thông báo + "Thử lại" ngay tại chỗ để khách không tưởng
 * cửa hàng ít hàng. Mỗi khối lỗi độc lập — thử lại chỉ tải lại đúng khối này. Hàng tiêu đề cao 44px như
 * HomeSection để vị trí tiêu đề không nhảy giữa khung chờ và khối lỗi.
 */
export function HomeBlockError({ title, error, onRetry, retrying }: HomeBlockErrorProps) {
  return (
    <section aria-label={title} data-testid="home-block-error" style={{ padding: '16px 16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', minHeight: 44 }}>
        <Heading variant="title-sm" as="h2">
          {title}
        </Heading>
      </div>
      <Card variant="outline" padding={12}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text variant="body-sm" tone="secondary" style={{ minWidth: 0 }}>
            {getErrorMessage(error)}
          </Text>
          <Button
            variant="secondary"
            loading={retrying}
            aria-label={vi.home.retryLabel(title)}
            onPress={() => {
              haptic('light');
              return onRetry();
            }}
            style={{ flex: '0 0 auto', minWidth: 0 }}
          >
            {vi.home.retry}
          </Button>
        </div>
      </Card>
    </section>
  );
}
