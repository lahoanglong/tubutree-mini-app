import type { HomeContextVariant } from '@tubutree/app-core/home-layout';
import type { HomeTodo } from '../../services/shop-api';
import { MemberCard, MemberCardSkeleton, MemberCardUnavailable } from './member-card';
import { NewCustomerGift } from './new-customer-gift';
import { TodoStrip } from './todo-strip';

export interface HomeContextStripProps {
  variant: HomeContextVariant;
  /** Đang khôi phục phiên: khách cũ chưa biết là ai nên thẻ thành viên giữ khung chờ. */
  restoring: boolean;
  /** Khôi phục phiên thất bại (mất mạng, API tạm lỗi): khách cũ thấy thẻ báo lỗi kèm "Thử lại", không bị đưa về bố cục khách mới. */
  sessionFailed: boolean;
  todo: HomeTodo | undefined;
  onRetrySession: () => void;
}

/**
 * MỘT dải cao `HOME_CONTEXT_HEIGHT` ngay dưới header: khung chờ, Việc cần làm (một dòng), Quà khách mới (thu gọn) hoặc thẻ thành viên gọn. Biến thể do
 * `homeContextVariant` quyết (cùng với web) và biến thể nào cũng cao bằng nhau, nên dữ liệu về muộn chỉ đổi nội dung trong dải, không đẩy các khối dưới.
 * Khách mới không còn ưu đãi (đã có đơn, lỗi cấu hình) thì dải vẽ thẻ thành viên thay vì để trống.
 */
export function HomeContextStrip({ variant, restoring, sessionFailed, todo, onRetrySession }: HomeContextStripProps) {
  if (variant === 'skeleton') return <MemberCardSkeleton />;
  if (variant === 'todo') return <TodoStrip data={todo} />;
  if (variant === 'gift') return <NewCustomerGift fallback={<MemberCard />} />;
  if (restoring) return <MemberCardSkeleton />;
  if (sessionFailed) return <MemberCardUnavailable onRetry={onRetrySession} />;
  return <MemberCard />;
}
