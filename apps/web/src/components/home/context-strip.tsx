'use client';

import { useMemo } from 'react';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import { homeContextVariant, homeTodoCount, readTodoRows, type HomeContextVariant, type HomeKindState } from '@tubutree/app-core/home-layout';
import { useAuth } from '@/lib/auth-context';
import { browserStorage } from '@/lib/recently-viewed';
import { MemberCard, MemberCardSkeleton, MemberCardUnavailable } from './member-card';
import { NewCustomerGift } from './new-customer-gift';
import { TodoStrip, useHomeTodoHint, type useHomeTodoQueries } from './todo-strip';

type TodoQueries = ReturnType<typeof useHomeTodoQueries>;

/**
 * Biến thể của dải ngữ cảnh (xem `homeContextVariant`). Đang khôi phục phiên của khách cũ: khung chờ, vì chưa biết việc cần làm hay hạng thành viên, và vẽ thẻ
 * thành viên rồi đổi sang Việc cần làm sẽ chớp. Cũng ghi dấu nhớ "có việc cần làm" cho lần mở sau.
 */
export function useHomeContextVariant({ kind, restoring, todo }: { kind: HomeKindState; restoring: boolean; todo: TodoQueries }): HomeContextVariant {
  const userId = useAuth().user?.id;
  useHomeTodoHint(todo, userId);
  const todoRemembered = useMemo(() => (todo.authed ? readTodoRows(browserStorage(), userId) > 0 : false), [todo.authed, userId]);
  if (restoring && kind === 'returning') return 'skeleton';
  return homeContextVariant({ kind, todoCount: homeTodoCount(todo.todoQ.data), todoPending: todo.loading, todoRemembered });
}

export interface HomeContextStripProps {
  variant: HomeContextVariant;
  kind: HomeKindState;
  /** Phiên lỗi (mất mạng, API tạm lỗi lúc khôi phục): khách cũ thấy thẻ thành viên báo lỗi kèm "Thử lại". */
  unavailable: boolean;
  onRetry: () => void;
  todo: TodoQueries;
  /** Cấu hình công khai dựng sẵn ở máy chủ: khách vãng lai có đúng dải Quà khách mới 64px ngay trong HTML đầu, không nhảy sau hydrate. */
  initialConfig?: PublicConfig;
}

/**
 * MỘT dải cao đúng `HOME_CONTEXT_HEIGHT` ở mọi biến thể (khung chờ, Việc cần làm, Quà khách mới, thẻ thành viên): dữ liệu về muộn chỉ đổi nội dung trong dải,
 * không đẩy các khối dưới. Chiều cao do vỏ khối ở home-view giữ; thành phần này chỉ chọn nội dung.
 */
export function HomeContextStrip({ variant, kind, unavailable, onRetry, todo, initialConfig }: HomeContextStripProps) {
  if (variant === 'skeleton') return <MemberCardSkeleton />;
  if (variant === 'todo') return <TodoStrip data={todo.todoQ.data} />;
  if (variant === 'gift') return <NewCustomerGift initialConfig={initialConfig} fallback={<MemberCard />} />;
  return kind === 'returning' && unavailable ? <MemberCardUnavailable onRetry={onRetry} /> : <MemberCard />;
}
