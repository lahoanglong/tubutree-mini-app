import { createContext, useContext } from 'react';
import { vi } from '../../i18n/vi';
import { getLoadErrorMessage } from '../../services/api';
import { haptic } from '../../utils/haptic';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Heading, Text } from '../ui/text';

/**
 * true khi Trang chủ đã hiện MỘT dải lỗi cấp trang (API sập hẳn): khối lỗi từng kệ ẩn đi, không xếp chồng 6 thẻ giống hệt nhau.
 * Cho cả những khối tự dựng HomeBlockError bên trong (giờ vàng, Mua lại) mà trang không điều khiển trực tiếp.
 */
export const HomeBlockErrorSuppressed = createContext(false);

export interface HomeBlockErrorProps {
  title: string;
  error?: unknown;
  /** Thường là `query.refetch` — trả Promise thì Button tự khoá bấm lại tới khi xong. */
  onRetry: () => unknown;
  /** Đang tải lại sau lỗi (`BlockQuery.isFetching` từ `useBlockQuery`, vốn giữ khối lỗi ở lại suốt lúc tải lại). */
  retrying?: boolean;
  /** Khối cùng hàng có nút "Xem tất cả" 44px (HomeSection có `seeAllTo`) → hàng tiêu đề cao 44px; không thì bằng khung chờ: không min-height, cách 8px. */
  seeAllRow?: boolean;
}

/**
 * Khối lỗi gọn của Trang chủ (C-084): giữ tiêu đề + một dòng thông báo + "Thử lại" ngay tại chỗ để khách không tưởng
 * cửa hàng ít hàng. Mỗi khối lỗi độc lập — thử lại chỉ tải lại đúng khối này. Hàng tiêu đề khai báo y hệt hàng của
 * HomeSection ở khung chờ để tiêu đề không nhảy khi đổi trạng thái.
 */
export function HomeBlockError({ title, error, onRetry, retrying, seeAllRow = true }: HomeBlockErrorProps) {
  const suppressed = useContext(HomeBlockErrorSuppressed);
  if (suppressed) return null;
  return (
    <section aria-label={title} data-testid="home-block-error" style={{ padding: '16px 16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', minHeight: seeAllRow ? 44 : undefined, marginBottom: seeAllRow ? 0 : 8 }}>
        <Heading variant="title-sm" as="h2">
          {title}
        </Heading>
      </div>
      <Card variant="outline" padding={12}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text variant="body-sm" tone="secondary" style={{ minWidth: 0 }}>
            {getLoadErrorMessage(error)}
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
