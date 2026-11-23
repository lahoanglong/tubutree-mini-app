'use client';

import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { ToneBadge } from '@/components/admin/ui';
import type { Tone } from '@/lib/recycling';
import { rowFixLink, type HandoverBoard, type HandoverItem } from './golive-api';

const STATE_LABEL: Record<HandoverItem['state'], string> = { configured: 'Đã cấu hình', pending: 'Chờ điền', host: 'Kiểm tay', optional: 'Tuỳ chọn' };

function stateTone(item: HandoverItem): Tone {
  if (item.state === 'configured') return 'success';
  if (item.state === 'host') return 'info';
  if (item.state === 'optional') return 'neutral';
  return item.status === 'FAIL' ? 'danger' : 'warning';
}

/**
 * "Cấu hình bên thứ 3 chờ bàn giao Go-Live": khoá và quyết định người ngoài đội kỹ thuật phải đưa (chủ OA, chủ shop, Accesstrade, người trực
 * VPS), gom từ đúng các dòng vàng của bảng kiểm. Bộ đếm chỉ tính việc bắt buộc; việc API không kiểm được từ container hiện "Kiểm tay", việc chủ
 * quyết có làm hay không hiện "Tuỳ chọn". Chỉ có tên biến và đã điền hay chưa: API không trả giá trị khoá.
 */
export function HandoverCard({ board }: { board: HandoverBoard }) {
  const done = board.configured === board.total;
  const failed = board.items.some((i) => i.state === 'pending' && i.status === 'FAIL');
  const host = board.items.filter((i) => i.state === 'host').length;
  const optional = board.items.filter((i) => i.state === 'optional').length;
  const border = failed ? 'border-danger-fg' : done ? 'border-success-fg' : 'border-warning-fg';
  return (
    <article data-testid="gio-g-handover" className={`rounded-card border-l-4 bg-stone-0 p-3 shadow-card ${border}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 break-words text-sm font-semibold text-stone-900">{board.title}</h3>
        <ToneBadge tone={failed ? 'danger' : done ? 'success' : 'warning'}>
          {board.configured}/{board.total} việc bắt buộc đã cấu hình
        </ToneBadge>
      </header>
      <p className="mt-1 text-xs text-stone-600">
        {host > 0 ? `${host} việc kiểm tay trên máy chủ, ` : ''}
        {optional > 0 ? `${optional} việc tuỳ chọn chủ quyết, ` : ''}
        không tính vào bộ đếm. Bấm từng việc để xem biến cần điền và cách lấy. Bảng chỉ hiện tên biến và đã điền hay chưa, không hiện giá trị khoá.
      </p>
      <ul className="mt-2 divide-y divide-stone-200">
        {board.items.map((it) => (
          <Row key={it.key} item={it} />
        ))}
      </ul>
    </article>
  );
}

function Row({ item }: { item: HandoverItem }) {
  const fix = item.checks.map((c) => rowFixLink(c, 'infra')).find((l) => l !== null) ?? null;
  return (
    <li data-testid="gio-g-handover-item" data-key={item.key} data-state={item.state} data-configured={item.configured ? 'true' : 'false'}>
      <details className="group text-xs">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 py-1.5 sm:min-h-0 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">
            <span className="block break-words font-medium text-stone-900">{item.title}</span>
            <span className="block break-words text-stone-600">{item.owner}</span>
          </span>
          <ToneBadge tone={stateTone(item)}>{STATE_LABEL[item.state]}</ToneBadge>
          <ChevronDown className="h-4 w-4 shrink-0 text-stone-500 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-1.5 pb-2">
          {item.vars.length > 0 ? (
            <ul aria-label="Biến cần điền" className="flex flex-wrap gap-1.5">
              {item.vars.map((v) => (
                <li key={v.name} className="inline-flex max-w-full items-center gap-1 rounded-control bg-stone-50 px-1.5 py-0.5">
                  <code className="break-all text-stone-900">{v.name}</code>
                  <span className={v.configured ? 'text-success-fg' : v.optional ? 'text-stone-600' : 'text-warning-fg'}>
                    {v.configured ? 'Đã điền' : v.optional ? 'Tuỳ chọn' : 'Chờ điền'}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="break-words text-stone-700">{item.guide}</p>
          {item.checks
            .filter((c) => c.status !== 'PASS')
            .map((c) => (
              <p key={c.id} data-check={c.id} className="break-words text-stone-600">
                {c.title}: {c.detail}
              </p>
            ))}
          {fix ? (
            <Link href={fix.href} className="inline-flex min-h-[44px] items-center font-medium text-forest-700 underline sm:min-h-0">
              Sửa ở {fix.label}
            </Link>
          ) : null}
        </div>
      </details>
    </li>
  );
}
