/** Điền mẫu chữ có chỗ trống `{tên}`. Thiếu biến thì ném lỗi, không để lộ "{t}" ra cho khách; `label` chỉ để câu báo lỗi chỉ đúng khoá. */
export function fillTemplate(template: string, vars: Record<string, string | number> = {}, label = template): string {
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined) throw new Error(`shop-copy: khoá "${label}" thiếu biến {${name}}`);
    return String(v);
  });
}
