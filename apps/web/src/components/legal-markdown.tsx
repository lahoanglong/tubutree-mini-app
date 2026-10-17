import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';

type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'para'; lines: string[] }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'hr' };

const BULLET = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,})\s*$/;

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = () => {
    if (para.length) blocks.push({ kind: 'para', lines: para });
    if (list) blocks.push(list);
    para = [];
    list = null;
  };
  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1]!.length >= 3 ? 3 : 2, text: heading[2]!.trim() });
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: 'hr' });
      continue;
    }
    const item = BULLET.exec(line) ?? ORDERED.exec(line);
    if (item) {
      const kind = BULLET.test(line) ? 'ul' : 'ol';
      if (para.length || (list && list.kind !== kind)) flush();
      if (!list) list = { kind, items: [] };
      list.items.push(item[1]!);
      continue;
    }
    if (list) flush();
    para.push(line.trim());
  }
  flush();
  return blocks;
}

const INLINE = /\*\*(.+?)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const LINK_CLASS = 'font-medium text-forest-700 underline underline-offset-2 hover:text-forest-800';

/** Chỉ cho liên kết nội bộ, https, mailto, tel: chặn javascript:/data:/`//host` do admin dán nhầm hoặc bị chèn. */
function safeHref(url: string): { href: string; external: boolean } | null {
  // Trình duyệt đọc "/\host" như "//host" (về host khác), nên gạch chéo ngược bị chặn ở mọi dạng đường dẫn.
  if (url.includes('\\')) return null;
  if (/^\/(?!\/)/.test(url)) return { href: url, external: false };
  if (/^https:\/\//i.test(url) || /^http:\/\//i.test(url)) return { href: url, external: true };
  if (/^(mailto|tel):/i.test(url)) return { href: url, external: false };
  return null;
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[1] !== undefined) {
      out.push(<strong key={key++}>{m[1]}</strong>);
    } else {
      const target = safeHref(m[3]!);
      if (!target) {
        out.push(m[2]!);
      } else if (target.external) {
        out.push(
          <a key={key++} href={target.href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
            {m[2]}
          </a>,
        );
      } else if (target.href.startsWith('/')) {
        out.push(
          <Link key={key++} href={target.href} className={LINK_CLASS}>
            {m[2]}
          </Link>,
        );
      } else {
        out.push(
          <a key={key++} href={target.href} className={LINK_CLASS}>
            {m[2]}
          </a>,
        );
      }
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Markdown tối giản cho trang điều khoản/chính sách: tiêu đề, đoạn, danh sách, đậm, liên kết, đường kẻ. Dựng bằng phần tử
 * React (không dangerouslySetInnerHTML) nên HTML thô trong nội dung bị escape, không cần thêm thư viện markdown.
 */
export function LegalMarkdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  if (blocks.length === 0) return null;
  return (
    <div className="space-y-3 text-base leading-relaxed text-stone-700">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading':
            return b.level === 2 ? (
              <h2 key={i} className="pt-4 font-display text-xl font-semibold text-stone-900">
                {inline(b.text)}
              </h2>
            ) : (
              <h3 key={i} className="pt-2 text-lg font-semibold text-stone-900">
                {inline(b.text)}
              </h3>
            );
          case 'para':
            return (
              <p key={i}>
                {b.lines.map((line, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {inline(line)}
                  </Fragment>
                ))}
              </p>
            );
          case 'ul':
            return (
              <ul key={i} className="list-disc space-y-1 pl-6">
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="list-decimal space-y-1 pl-6">
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </ol>
            );
          case 'hr':
            return <hr key={i} className="border-stone-200" />;
        }
      })}
    </div>
  );
}
