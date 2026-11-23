'use client';

import Link from 'next/link';
import { ToneBadge } from '@/components/admin/ui';
import { rowFixLink, type HandoverBoard, type HandoverItem } from './golive-api';

/**
 * "Cấu hình bên thứ 3 chờ bàn giao Go-Live": khoá và quyết định người ngoài đội kỹ thuật phải đưa (chủ OA, chủ shop, Accesstrade, người trực
 * VPS), gom từ đúng các dòng vàng của bảng kiểm. Mỗi việc một dòng gọn (tên, người phụ trách, Đã cấu hình / Chờ điền); bấm mở để xem biến cần
 * điền, cách lấy và lời của bộ kiểm. Chỉ có tên biến và đã điền hay chưa: API không trả giá trị khoá.
 */
export function HandoverCard({ board }: { board: HandoverBoard }) {
  const done = board.configured === board.total;
  return (
    <article data-testid="gio-g-handover" className={`rounded-card border-l-4 bg-stone-0 p-3 shadow-card ${done ? 'border-success-fg' : 'border-warning-fg'}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 break-words text-sm font-semibold text-stone-900">{board.title}</h3>
        <ToneBadge tone={done ? 'success' : 'warning'}>
          {board.configured}/{board.total} đã cấu hình
        </ToneBadge>
      </header>
      <p className="mt-1 text-xs text-stone-600">Bấm từng việc để xem biến cần điền và cách lấy. Bảng chỉ hiện tên biến và đã điền hay chưa, không hiện giá trị khoá.</p>
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
    <li data-testid="gio-g-handover-item" data-key={item.key} data-configured={item.configured ? 'true' : 'false'}>
      <details className="text-xs">
        <summary className="flex min-h-[44px] cursor-pointer items-center gap-2 py-1.5 sm:min-h-0">
          <span className="min-w-0 flex-1">
            <span className="block break-words font-medium text-stone-900">{item.title}</span>
            <span className="block break-words text-stone-600">{item.owner}</span>
          </span>
          <ToneBadge tone={item.configured ? 'success' : item.status === 'FAIL' ? 'danger' : 'warning'}>{item.configured ? 'Đã cấu hình' : 'Chờ điền'}</ToneBadge>
        </summary>
        <div className="space-y-1.5 pb-2">
          {item.vars.length > 0 ? (
            <ul aria-label="Biến cần điền" className="flex flex-wrap gap-1.5">
              {item.vars.map((v) => (
                <li key={v.name} className="inline-flex max-w-full items-center gap-1 rounded-control bg-stone-50 px-1.5 py-0.5">
                  <code className="break-all text-stone-900">{v.name}</code>
                  <span className={v.configured ? 'text-success-fg' : 'text-warning-fg'}>{v.configured ? 'Đã điền' : 'Chờ điền'}</span>
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
