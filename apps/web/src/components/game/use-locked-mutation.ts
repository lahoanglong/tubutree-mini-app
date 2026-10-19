'use client';

import { useRef } from 'react';
import { useMutation, type UseMutateFunction, type UseMutationOptions, type UseMutationResult } from '@tanstack/react-query';

export type LockedMutation<TData, TError, TVariables, TContext> = Omit<
  UseMutationResult<TData, TError, TVariables, TContext>,
  'mutate' | 'mutateAsync'
> & { mutate: UseMutateFunction<TData, TError, TVariables, TContext> };

/**
 * `useMutation` mà `mutate` bỏ qua cú gọi thứ hai khi cú đầu chưa xong. `disabled={isPending}` chỉ đúng sau
 * lần dựng lại kế tiếp, nên hai cú bấm sát nhau trong cùng khung hình vẫn đều thấy nút đang bật và đều gọi
 * API; ref đồng bộ thì chặn được ngay. Khoá nhả ở `onSettled` (thành công lẫn lỗi) nên lỗi mạng không làm
 * nút chết.
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
      inFlight.current.delete(keyOf(args[2]));
      return onSettled?.(...args);
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
