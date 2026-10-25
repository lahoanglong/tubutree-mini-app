import { Fragment, type ReactNode } from 'react';
import { isLegalSlug, type LegalSlug } from '@tubutree/app-core/legal';
import { Heading, Text } from './ui/text';

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'para'; lines: string[] }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'hr' };

const BULLET = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,})\s*$/;

export function parseBlocks(source: string): Block[] {
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
      blocks.push({ kind: 'heading', text: heading[2]!.trim() });
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

const INTERNAL_POLICY = /^\/chinh-sach\/([a-z-]+)$/;

/** Liên kết ngoài chỉ hiện chữ: Mini App không điều hướng ra ngoài. Liên kết /chinh-sach/<loại> mở popup chính sách tương ứng. */
function inline(text: string, onPolicy?: (slug: LegalSlug) => void): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[1] !== undefined) {
      out.push(<strong key={key++}>{m[1]}</strong>);
    } else {
      const target = INTERNAL_POLICY.exec(m[3] ?? '')?.[1];
      if (onPolicy && target && isLegalSlug(target)) {
        out.push(
          <button
            key={key++}
            type="button"
            onClick={() => onPolicy(target)}
            style={{ all: 'unset', cursor: 'pointer', color: 'var(--color-text-link, inherit)', textDecoration: 'underline' }}
          >
            {m[2]}
          </button>,
        );
      } else {
        out.push(m[2]);
      }
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Markdown tối giản của trang chính sách (tiêu đề, đoạn, danh sách, đậm); dựng bằng phần tử React nên HTML thô bị escape. */
export function LegalMarkdown({ source, onPolicy }: { source: string; onPolicy?: (slug: LegalSlug) => void }) {
  const blocks = parseBlocks(source);
  return (
    <div data-testid="legal-markdown" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading':
            return (
              <Heading key={i} variant="title-sm" as="h3" style={{ marginTop: 6 }}>
                {inline(b.text, onPolicy)}
              </Heading>
            );
          case 'para':
            return (
              <Text key={i} variant="body-sm" tone="secondary" as="p" style={{ margin: 0 }}>
                {b.lines.map((line, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {inline(line, onPolicy)}
                  </Fragment>
                ))}
              </Text>
            );
          case 'ul':
          case 'ol': {
            const List = b.kind;
            return (
              <List key={i} style={{ margin: 0, paddingLeft: 20, listStyle: b.kind === 'ul' ? 'disc' : 'decimal' }}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Text variant="body-sm" tone="secondary">
                      {inline(it, onPolicy)}
                    </Text>
                  </li>
                ))}
              </List>
            );
          }
          case 'hr':
            return <hr key={i} style={{ border: 0, borderTop: '1px solid var(--color-border-subtle)', width: '100%' }} />;
        }
      })}
    </div>
  );
}
