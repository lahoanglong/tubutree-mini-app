import { Children, cloneElement, Fragment, isValidElement, useEffect, useId, useRef } from 'react';
import type { InputHTMLAttributes, MouseEvent, ReactElement, ReactNode } from 'react';
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
 * `Input` (ui/input.tsx) xuống `<input>` thật. Nhiều con / không phải phần tử: bọc nhóm `role="group"` có tên. */
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
          <Text variant="field-label" tone="secondary">
            {label}
          </Text>
        </label>
      ) : (
        <Text variant="field-label" tone="secondary" as="div" style={{ marginBottom: 4 }} data-testid="field-label">
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
// `inert` (không phải `true`: React 18 không biết thuộc tính này, chuỗi rỗng mới ra đúng `inert=""` trên DOM) khi
// chấm chọn chỉ là hình: axe `nested-interactive` vẫn tính `<input tabindex="-1">` là phần tử focus được lồng trong
// hàng cha role radio/checkbox, kể cả khi đã aria-hidden. Cây inert không focus được và không nhận chạm, nên cú
// chạm vào chấm đi thẳng tới `onClick` của hàng cha (đúng một sự kiện). Trình duyệt không hiểu `inert` thì vẫn còn
// `tabIndex -1` ở dưới, hành vi như trước.
const INERT = { inert: '' } as Record<string, string>;

// Khung 44px lớn hơn control 24px: cú chạm trúng phần đệm (target là chính khung) chuyển cho <input>
// bên trong để vùng chạm thật sự là 44px. Cú chạm vào nhãn/ô đi đường label gốc, target khác khung nên
// không bị chuyển lần hai. Control trang trí thì hàng cha tự xử lý bấm nên không chuyển.
function forwardPaddingTap(e: MouseEvent<HTMLDivElement>) {
  if (e.target !== e.currentTarget) return;
  e.currentTarget.querySelector('input')?.click();
}

// `flush`: khung chạm vẫn 44x44 nhưng chỉ chiếm đúng 24px bề ngang của bố cục (lớp `.tubu-hit-flush` trong tokens.css: margin âm bù đệm trái; ô nằm sát mép trái
// của cột 24px), phần nhô ra là vùng chạm thêm trên đệm của thẻ và khe giữa các cột. Dùng cho ô chọn đầu dòng (giỏ: cột 24 + khoảng 12, PL-19) thay vì chiếm cả 44px.
function hitArea(testId: string, children: ReactNode, decorative: boolean, flush = false) {
  return (
    <div
      data-testid={testId}
      aria-hidden={decorative || undefined}
      {...(decorative ? INERT : null)}
      onClick={decorative ? undefined : forwardPaddingTap}
      className={flush ? 'tubu-hit-flush' : undefined}
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
// đã có tên và tự xử lý bấm (checkout.tsx) — nên coi là trang trí: ẩn khỏi cây truy cập, khỏi thứ tự Tab
// (tabIndex -1 để không thành "ẩn mà vẫn focus được") và, nhờ `inert` ở hitArea, khỏi cú chạm.
// Hợp đồng: chấm không tên là thuần hình, KHÔNG nhận bấm và KHÔNG phát onChange. Hàng cha giữ `onClick`;
// chấm không tên chỉ đi với `onChange={() => {}}` (bắt buộc để React coi là controlled). jsdom bỏ qua
// `inert` nên `input.click()` trong test vẫn gọi onChange, đó không phải hành vi trình duyệt thật
// (`form-decorative-usage.spec.ts` canh các chỗ gọi bằng phân tích mã nguồn).
const DECORATIVE_INPUT = { tabIndex: -1 } as const;

type ControlBase = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'value'> & {
  /** Nhãn hiện cạnh control; `<label>` bọc ngoài nên chạm nhãn cũng đổi trạng thái. */
  label?: ReactNode;
  value?: string | number;
};

export type CheckboxProps = ControlBase & {
  /** Hàng "Chọn tất cả" khi mới chọn một phần: gán `input.indeterminate` (trình đọc màn hình đọc "chọn một phần"), CSS vẽ gạch ngang qua `:indeterminate`. */
  indeterminate?: boolean;
  /** Ô chọn đầu dòng: chiếm cột 24px, vùng chạm 44px nhô ra hai phía (lớp `.tubu-hit-flush`). Mặc định false: khung chiếm 44px như mọi chỗ khác. */
  flush?: boolean;
};

/**
 * Ô 24px tự vẽ trên `<input>` gốc (thay `zmp-ui` Checkbox/Radio: bỏ mã thành phần và luật CSS của chúng). `<input>` trong suốt
 * phủ kín ô nên cú chạm và bàn phím đi thẳng vào control thật; hình (`.tubu-check__mark`) đổi theo `:checked`/`:disabled` bằng CSS ở `tokens.css`.
 */
function ChoiceControl({ kind, label, children, indeterminate, className, ...rest }: CheckboxProps & { kind: 'checkbox' | 'radio' }) {
  const text = children ?? label;
  const inputRef = useRef<HTMLInputElement>(null);
  // `indeterminate` chỉ là thuộc tính DOM, không có thuộc tính HTML. Trình duyệt tự xoá nó khi người dùng bấm ô, nên gán lại sau mọi lần vẽ chứ không
  // chỉ khi prop đổi. Không đặt `aria-checked` trên `<input>` gốc: ARIA cấm, và trình đọc màn hình có thể bỏ qua nó để đọc "chưa chọn".
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = kind === 'checkbox' && Boolean(indeterminate);
  });
  return (
    <label className={['tubu-check', `tubu-check--${kind}`, className].filter(Boolean).join(' ')}>
      <span className="tubu-check__box">
        <input {...rest} ref={inputRef} type={kind} className="tubu-check__input" />
        <span className="tubu-check__mark" aria-hidden="true">
          {kind === 'checkbox' && (
            <svg viewBox="0 0 14 11" fill="none">
              <path d="M1.5 5.5L5 9L12.5 1.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </span>
      {text !== undefined && text !== null && text !== false && text !== '' && <span className="tubu-check__label">{text}</span>}
    </label>
  );
}

/** Checkbox DS: ô 24px trong khung chạm tối thiểu 44px (audit DS v2 44px touch target). */
export function Checkbox({ flush = false, ...rest }: CheckboxProps) {
  const decorative = !hasName(rest);
  return hitArea('checkbox-hit-area', <ChoiceControl kind="checkbox" {...(decorative ? DECORATIVE_INPUT : null)} {...rest} />, decorative, flush);
}

export type RadioProps = ControlBase;

/** Radio DS: chấm tròn 24px trong khung chạm 44px. */
export function Radio(props: RadioProps) {
  const decorative = !hasName(props);
  return hitArea('radio-hit-area', <ChoiceControl kind="radio" {...(decorative ? DECORATIVE_INPUT : null)} {...props} />, decorative);
}

export type SwitchProps = ControlBase;

/** Công tắc DS: `<input type="checkbox" role="switch">` 40×24 (trình đọc màn hình đọc "công tắc, bật/tắt") trong khung chạm 44px. */
export function Switch({ label: ownLabel, children, className, ...rest }: SwitchProps) {
  const label = ownLabel ?? children;
  const decorative = !hasName({ label, ...rest });
  const Wrapper = label ? 'label' : 'div';
  return hitArea(
    'switch-hit-area',
    <Wrapper className="tubu-switch-wrap">
      <input {...(decorative ? DECORATIVE_INPUT : null)} {...rest} type="checkbox" role="switch" className={['tubu-switch', className].filter(Boolean).join(' ')} />
      {label && <span className="tubu-switch-wrap__label">{label}</span>}
    </Wrapper>,
    decorative,
  );
}
