/**
 * zmp-sdk/apis nhúng nguyên zod (~46 KB sau nén) chỉ để kiểm tham số trước khi gọi native: `utils/decorator.js` gọi `schema.safeParse(arg)`,
 * ném lỗi badRequest khi sai, còn khi đúng thì đẩy `data` vào CUỐI mảng đối số và handler vẫn nhận đối số GỐC ở vị trí đầu
 * (`var h=m; ...; h.push(s.data); u.apply(void 0, h)`). Kết quả parse của zod không đi vào lời gọi native nào.
 *
 * Bản build thay zod bằng module này (`build-vendor-shims.ts`): mọi schema nhận mọi giá trị, nên với tham số hợp lệ lời gọi giống hệt.
 * Tham số không hợp lệ sẽ tới native thay vì bị chặn sớm, nên mã gọi SDK phải tự làm sạch đầu vào như `zmp-bridge.ts` đang làm
 * (cắt title/description của openShareSheet, thay thumbnail không phải URL).
 *
 * Mọi lời gọi dựng schema (`object(...)`, `.optional()`, `.url()`, `t.enum(...)`…) trả lại cùng một schema; chỉ `safeParse`/`parse` có kết quả.
 */
type Schema = ((...args: unknown[]) => Schema) & { [key: string]: unknown };

const build = (..._args: unknown[]): Schema => schema;

const schema: Schema = new Proxy(build as Schema, {
  get(_target, key) {
    if (key === 'safeParse') return (data: unknown) => ({ success: true, data });
    if (key === 'parse') return (data: unknown) => data;
    // Không giả làm thenable hay giá trị nguyên thuỷ.
    if (typeof key === 'symbol' || key === 'then') return undefined;
    return build;
  },
});

export default schema;
export const object = build;
export const string = build;
export const number = build;
export const boolean = build;
export const array = build;
