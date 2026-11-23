import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { metadataScope, withoutMetadataBuilders } from './metadata-scope';

const HEAD = `import type { Metadata } from 'next';\n`;

describe('metadataScope: miễn quét hàm dựng thẻ meta SEO theo cây cú pháp', () => {
  it('trang thương hiệu thật: bỏ generateMetadata và brandMeta, giữ BrandPage và hàm phụ BrandPage cũng gọi', () => {
    const file = '../app/brand/[slug]/page.tsx';
    const src = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    const { builders, text } = metadataScope(src, file);
    expect(builders).toEqual(['generateMetadata', 'brandMeta']);
    expect(text).toContain('export default async function BrandPage');
    expect(text).toContain('const brandPath =');
    expect(text).not.toContain("' ✓'");
  });

  it('hồi quy W21-04 §3.2: hàm trả Metadata khai TRÊN generateMetadata vẫn được miễn; ký hiệu trong component vẫn bị bắt', () => {
    const src = `${HEAD}
function brandMeta(b: { name: string }): Metadata {
  return { title: \`\${b.name} ✓\` };
}
export async function generateMetadata(): Promise<Metadata> {
  return brandMeta({ name: 'A' });
}
export default function BrandPage() {
  // huy hiệu ✓ cạnh tên
  return <script type="application/ld+json">{JSON.stringify({ ...brandMeta({ name: 'A' }), title: 'A' })}</script>;
}
`;
    const { builders, text } = metadataScope(src);
    expect(builders).toEqual(['brandMeta', 'generateMetadata']);
    expect(text.match(/✓/g)).toEqual(['✓']);
    expect(text).toContain('// huy hiệu ✓ cạnh tên');
  });

  it('chỉ kiểu Metadata của Next mới miễn: kiểu cùng tên tự khai trong file thì hàm vẫn bị quét; nhập đổi tên (Metadata as M) vẫn nhận', () => {
    const local = `type Metadata = { title: string };
const badge = (): Metadata => ({ title: ' ✓' });
export async function generateMetadata() { return { title: 'A' }; }
export default function Page() { return <main>{badge().title}</main>; }
`;
    expect(metadataScope(local).builders).toEqual(['generateMetadata']);
    expect(metadataScope(local).text).toContain('✓');
    const aliased = `import type { Metadata as M } from 'next';
function brandMeta(): M { return { title: 'A ✓' }; }
export async function generateMetadata(): Promise<M> { return brandMeta(); }
export default function Page() { return <main>A</main>; }
`;
    expect(metadataScope(aliased).builders).toEqual(['brandMeta', 'generateMetadata']);
    expect(metadataScope(aliased).text).not.toContain('✓');
    const wrapped = `${HEAD}
function many(): Metadata[] { return [{ title: ' ✓' }]; }
export async function generateMetadata(): Promise<Metadata> { return many()[0]!; }
export default function Page() { return <main>{many().length}</main>; }
`;
    expect(metadataScope(wrapped).builders).toEqual(['generateMetadata']);
  });

  it('hàm phụ không khai kiểu chỉ hàm meta gọi (kể cả gọi gián tiếp) thì được miễn', () => {
    const src = `${HEAD}
const tick = (on: boolean) => (on ? ' ✓' : '');
function suffix(on: boolean) { return tick(on); }
export async function generateMetadata(): Promise<Metadata> {
  return { title: 'A' + suffix(true) };
}
export default function Page() { return <main>A</main>; }
`;
    const { builders, text } = metadataScope(src);
    expect(builders).toEqual(['tick', 'suffix', 'generateMetadata']);
    expect(text).not.toContain('✓');
  });

  it('hàm phụ mà giao diện cũng gọi thì vẫn bị quét', () => {
    const src = `${HEAD}
const tick = (on: boolean) => (on ? ' ✓' : '');
export async function generateMetadata(): Promise<Metadata> {
  return { title: 'A' + tick(true) };
}
export default function Page() { return <main>{tick(true)}</main>; }
`;
    const { builders, text } = metadataScope(src);
    expect(builders).toEqual(['generateMetadata']);
    expect(text).toContain("' ✓'");
  });

  it('hàm phụ được export (file khác có thể nhập làm icon) thì vẫn bị quét', () => {
    const src = `${HEAD}
export const tick = () => ' ✓';
export async function generateMetadata(): Promise<Metadata> {
  return { title: 'A' + tick() };
}
export default function Page() { return <main>A</main>; }
`;
    expect(metadataScope(src).builders).toEqual(['generateMetadata']);
  });

  it('tên trùng ở vị trí khoá (a.tick, { tick: 1 }, kiểu { tick: string }, thuộc tính JSX) không tính là lần gọi', () => {
    const src = `${HEAD}
const tick = () => ' ✓';
export async function generateMetadata(): Promise<Metadata> {
  return { title: 'A' + tick() };
}
export default function Page({ o }: { o: { tick: string } }) {
  const x = { tick: 1 };
  return <main tick="1">{o.tick}{x.tick}</main>;
}
`;
    expect(metadataScope(src).builders).toEqual(['tick', 'generateMetadata']);
  });

  it('{ tick } viết tắt và export { tick } là lần dùng ngoài hàm meta', () => {
    const short = `${HEAD}
const tick = () => ' ✓';
export async function generateMetadata(): Promise<Metadata> {
  return { title: 'A' + tick() };
}
export default function Page() { const o = { tick }; return <main>{o.tick()}</main>; }
`;
    expect(metadataScope(short).builders).toEqual(['generateMetadata']);
    const reexport = `${HEAD}
const tick = () => ' ✓';
export async function generateMetadata(): Promise<Metadata> {
  return { title: 'A' + tick() };
}
export default function Page() { return <main>A</main>; }
export { tick };
`;
    expect(metadataScope(reexport).builders).toEqual(['generateMetadata']);
  });

  it('comment ngay trên hàm meta vẫn bị quét (chỉ bỏ thân câu khai báo)', () => {
    const src = `${HEAD}
// ghi chú ✓ nằm ngoài hàm
export async function generateMetadata(): Promise<Metadata> {
  return { title: 'A ✓' };
}
export default function Page() { return <main>A</main>; }
`;
    expect(withoutMetadataBuilders(src).match(/✓/g)).toEqual(['✓']);
  });

  it('file không có generateMetadata thì báo lỗi: mục trong danh sách miễn quét đã cũ', () => {
    expect(() => metadataScope(`${HEAD}export default function Page() { return <main>A</main>; }\n`, 'x.tsx')).toThrow(/x\.tsx không có generateMetadata/);
  });
});
