'use client';

import { useRef } from 'react';
import { useMutation, type UseMutateFunction, type UseMutationOptions, type UseMutationResult } from '@tanstack/react-query';
import { isThenable } from '@/components/mini/button';

export type LockedMutation<TData, TError, TVariables, TContext> = Omit<
  UseMutationResult<TData, TError, TVariables, TContext>,
  'mutate' | 'mutateAsync'
> & { mutate: UseMutateFunction<TData, TError, TVariables, TContext> };

/**
 * `useMutation` mà `mutate` bỏ qua cú gọi thứ hai khi cú đầu chưa xong. `disabled={isPending}` chỉ đúng sau
 * lần dựng lại kế tiếp, nên hai cú bấm sát nhau trong cùng khung hình vẫn đều thấy nút đang bật và đều gọi
 * API; ref đồng bộ thì chặn được ngay. Khoá nhả ở `onSettled` (thành công lẫn lỗi) nên lỗi mạng không làm
 * nút chết. `onSettled` của người dùng trả Promise (vd tải lại danh sách) thì khoá nhả SAU khi nó xong, kể cả khi nó
 * ném lỗi: nhả trước thì lệnh khác đích đổi `variables` của mutation, nút hết bận, và chạm lại đích cũ gửi lệnh mới
 * trong lúc máy chủ chưa xác nhận dữ liệu mới.
 *
 * `keyOf` chia khoá theo đích của thao tác: các nút cùng loại nhưng khác đích vẫn gọi song song, chỉ cú bấm
 * lặp vào CÙNG đích bị bỏ qua. Cố ý không trả `mutateAsync`: đường đó không qua khoá.
 */
export function useLockedMutation<TData = unknown, TError = Error, TVariables = void, TContext = unknown>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
  keyOf: (variables: TVariables) => string = () => '',
): LockedMutation<TData, TError, TVariables, TContext> {
  const inFlight = useRef(new Set<string>());
  const { onSettled } = options;
  const { mutate, mutateAsync: _unguarded, ...rest } = useMutation<TData, TError, TVariables, TContext>({
    ...options,
    onSettled: (...args) => {
      const release = () => {
        inFlight.current.delete(keyOf(args[2]));
      };
      try {
        const result = onSettled?.(...args);
        if (!isThenable(result)) {
          release();
          return result;
        }
        return Promise.resolve(result).finally(release);
      } catch (e) {
        release();
        throw e;
      }
    },
  });

  const guardedMutate: UseMutateFunction<TData, TError, TVariables, TContext> = (variables, callbacks) => {
    const key = keyOf(variables);
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    mutate(variables, callbacks);
  };

  return { ...rest, mutate: guardedMutate };
}
