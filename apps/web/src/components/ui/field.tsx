'use client';

import { Children, cloneElement, Fragment, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { ui } from '@/lib/guest-ui';

export interface FieldProps {
  label: string;
  error?: string;
  children: ReactNode;
}

/**
 * Khung nhãn + control + lỗi, cùng cách gắn nhãn với `Field` của Mini App: con duy nhất là một phần tử thì nó nhận `id`
 * (nhãn là `<label htmlFor>`), khi có lỗi thêm `aria-invalid` + `aria-describedby`; nhiều con thì bọc `role="group"` có tên.
 */
export function Field({ label, error, children }: FieldProps) {
  const uid = useId();
  const labelId = `${uid}-label`;
  const errorId = `${uid}-error`;
  const only = Children.count(children) === 1 && isValidElement(children) && children.type !== Fragment ? (children as ReactElement<Record<string, unknown>>) : null;
  const controlId = only ? ((only.props.id as string | undefined) ?? `${uid}-control`) : undefined;

  const control = only ? (
    cloneElement(only, {
      id: controlId,
      ...(error ? { 'aria-invalid': true, 'aria-describedby': [only.props['aria-describedby'], errorId].filter(Boolean).join(' ') } : null),
    })
  ) : (
    <div role="group" aria-labelledby={labelId} aria-describedby={error ? errorId : undefined}>
      {children}
    </div>
  );

  return (
    <div>
      {only ? (
        <label id={labelId} htmlFor={controlId} className="mb-1 block text-xs text-stone-600">
          {label}
        </label>
      ) : (
        <div id={labelId} className="mb-1 text-xs text-stone-600">
          {label}
        </div>
      )}
      {control}
      {error && (
        <div id={errorId} className={`mt-0.5 ${ui.error}`}>
          <span aria-hidden="true">⚠ </span>
          {error}
        </div>
      )}
    </div>
  );
}
