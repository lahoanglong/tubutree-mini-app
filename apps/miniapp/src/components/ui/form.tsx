import { Children, cloneElement, Fragment, isValidElement, useId } from 'react';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { Checkbox as ZCheckbox, Radio as ZRadio, Switch as ZSwitch } from 'zmp-ui';
import { Text } from './text';

export interface FieldProps {
  label: string;
  error?: string;
  children: ReactNode;
}

/** Khung nhãn + nội dung + lỗi cho một control (Input/Checkbox/...), dùng chung 1 kiểu hiển thị
 * lỗi thay vì mỗi form tự vẽ lại (audit DS v2 — chuẩn hoá form control).
 *
 * Nhãn phải GẮN với control thì trình đọc màn hình mới đọc được (axe `label`, A4-005): khi `children`
 * là đúng một phần tử, Field cấp cho nó `id` (nhãn là `<label htmlFor>`), và khi có lỗi thì thêm
 * `aria-invalid` + `aria-describedby` trỏ vào thông báo lỗi. `id` nằm trong props nên đi xuyên qua
 * Input của ZaUI xuống `<input>` thật. Nhiều con / không phải phần tử: bọc nhóm `role="group"` có tên. */
export function Field({ label, error, children }: FieldProps) {
  const uid = useId();
  const labelId = `${uid}-label`;
  const errorId = `${uid}-error`;
  const only = Children.count(children) === 1 && isValidElement(children) && children.type !== Fragment ? (children as ReactElement<Record<string, unknown>>) : null;
  const controlId = only ? ((only.props.id as string | undefined) ?? `${uid}-control`) : undefined;

  const control = only ? (
    cloneElement(only, {
      id: controlId,
      ...(error
        ? { 'aria-invalid': true, 'aria-describedby': [only.props['aria-describedby'], errorId].filter(Boolean).join(' ') }
        : null),
    })
  ) : (
    <div role="group" aria-labelledby={labelId} aria-describedby={error ? errorId : undefined}>
      {children}
    </div>
  );

  return (
    <div>
      {only ? (
        <label id={labelId} htmlFor={controlId} style={{ display: 'block', marginBottom: 4 }}>
          <Text variant="caption" tone="secondary">
            {label}
          </Text>
        </label>
      ) : (
        <Text variant="caption" tone="secondary" as="div" style={{ marginBottom: 4 }} data-testid="field-label">
          <span id={labelId}>{label}</span>
        </Text>
      )}
      {control}
      {error && (
        // "⚠ " is kept as its own element (not concatenated into the same text node as `error`)
        // so testing-library's getNodeText — which only reads an element's own direct text-node
        // children — still matches on the raw error string alone.
        <div id={errorId}>
          <Text variant="caption" tone="danger" as="div" style={{ marginTop: 2 }}>
            <span aria-hidden="true">⚠ </span>
            {error}
          </Text>
        </div>
      )}
    </div>
  );
}

// `minWidth` (không chỉ `minHeight`) là bắt buộc: khi Checkbox/Radio/Switch đứng làm flex item
// trong một hàng flex (vd dòng giỏ hàng) mà không có `label`/`children` hiển thị, flex item mặc
// định co theo nội dung (flex-shrink, không tự giãn ngang) — hộp chạm thực tế co lại còn đúng
// bề rộng control gốc (24px medium/16px small), dưới ngưỡng 44px dù minHeight đã đủ (audit
// A4-14 phát hiện khi migrate cart.tsx dùng lại component này — Task 25).
function hitArea(testId: string, children: ReactNode, decorative: boolean) {
  return (
    <div
      data-testid={testId}
      aria-hidden={decorative || undefined}
      style={{ minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center' }}
    >
      {children}
    </div>
  );
}

interface NameProps {
  label?: ReactNode;
  children?: ReactNode;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  id?: string;
}

/** Control có tên truy cập khi có nhãn hiển thị (`label` / `children`), aria-label/aria-labelledby, hoặc `id`:
 * `Field` cấp `id` để gắn `<label htmlFor>` (giống `TimeInput`), nên có `id` nghĩa là nhãn ngoài đã trỏ vào. */
function hasName(p: NameProps): boolean {
  const visible = (v: ReactNode) => v !== undefined && v !== null && v !== false && v !== '';
  return visible(p.label) || visible(p.children) || !!p['aria-label'] || !!p['aria-labelledby'] || p.id !== undefined;
}

// Control không có tên không dùng được bằng trình đọc màn hình (axe `label`, A4-005 — 6 ô ở checkout).
// Mọi chỗ dùng như vậy hiện nay là chấm chọn thị giác thuần tuý nằm trong hàng cha role=radio/checkbox
// đã có tên và tự xử lý bấm (checkout.tsx) — nên coi là trang trí: ẩn khỏi cây truy cập và khỏi thứ tự
// Tab (tabIndex -1 để không thành "ẩn mà vẫn focus được"), nhưng vẫn bấm/đổi giá trị bình thường.
const DECORATIVE_INPUT = { tabIndex: -1 } as const;

// ZaUI's own CheckboxProps declares `value: string | number` as REQUIRED (it's only actually
// needed inside a <Checkbox.Group>) — forwarding React.ComponentProps<typeof ZCheckbox> as-is
// would force every standalone caller to pass a meaningless `value`. Make it optional here and
// default it, since a standalone Checkbox never reads it.
export type CheckboxProps = Omit<ComponentProps<typeof ZCheckbox>, 'value'> & { value?: string | number };

/** Checkbox đã theme sẵn qua ZaUI bridge (Task 4) — wrapper này CHỈ thêm vùng chạm tối thiểu
 * 44px, không tự vẽ lại hành vi check/uncheck (audit DS v2 44px touch target). */
export function Checkbox({ value = '', ...rest }: CheckboxProps) {
  const decorative = !hasName(rest);
  return hitArea('checkbox-hit-area', <ZCheckbox value={value} {...(decorative ? DECORATIVE_INPUT : null)} {...rest} />, decorative);
}

export type RadioProps = ComponentProps<typeof ZRadio>;

/** Radio đã theme sẵn qua ZaUI bridge (Task 4) — wrapper này CHỈ thêm vùng chạm tối thiểu 44px. */
export function Radio(props: RadioProps) {
  const decorative = !hasName(props);
  return hitArea('radio-hit-area', <ZRadio {...(decorative ? DECORATIVE_INPUT : null)} {...props} />, decorative);
}

export type SwitchProps = ComponentProps<typeof ZSwitch>;

/** Switch đã theme sẵn qua ZaUI bridge (Task 4) — wrapper này CHỈ thêm vùng chạm tối thiểu 44px. */
export function Switch(props: SwitchProps) {
  const decorative = !hasName(props);
  return hitArea('switch-hit-area', <ZSwitch {...(decorative ? DECORATIVE_INPUT : null)} {...props} />, decorative);
}
