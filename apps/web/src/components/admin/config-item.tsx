'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { setConfig, type ConfigRow } from '@/lib/admin-client';
import { useConfirm } from './confirm-dialog';

/** Nhóm khoá đi thẳng vào tiền khách trả, điểm, ví, hoa hồng, mã giảm, tài khoản nhận tiền và đổi rác: sửa nhầm là sai tiền hoặc sai điểm ngay ở đơn kế tiếp. */
const MONEY_PREFIXES = [
  'payment.',
  'loyalty.',
  'shipping.',
  'wallet.',
  'waste.',
  'affiliate.',
  'coupon.',
  'cashback.',
  'dealer.',
  'flashsale.',
  'merchant.',
  'voucher.',
  'referral.',
  'groupbuy.',
  'subscribe.',
  'coins.',
];

/** Nhóm trộn khoá tiền/điểm với khoá không đụng tiền (đường dẫn, số ô vườn, hạt giống, XP…): chỉ hỏi khi tên khoá nói về điểm, thưởng, giá, trần, giải, bậc thưởng, đơn tối thiểu, hạn mức mua bằng điểm. */
const MIXED_PREFIXES = ['community.', 'game.', 'seasonpass.'];
const MIXED_MONEY_KEY = /(^|[._])(points?|reward|bonus|cost|price|unlock|budget|cap|prizes?|tiers?|min_order|limit)([._]|$)/;

/** Khoá tiền nằm ngoài các nhóm trên: phạt đi trễ trừ thẳng vào lương nhân viên. */
const MONEY_KEYS = new Set(['attendance.late_fine']);

const isMoneyKey = (key: string) =>
  MONEY_KEYS.has(key) ||
  MONEY_PREFIXES.some((p) => key.startsWith(p)) ||
  (MIXED_PREFIXES.some((p) => key.startsWith(p)) && MIXED_MONEY_KEY.test(key));

/** Một dòng trong "Tất cả tham số (JSON)" của tab Cấu hình. */
export function ConfigItem({ row, onSaved }: { row: ConfigRow; onSaved: () => void }) {
  // Nội dung điều khoản/chính sách là văn bản dài nhiều dòng: sửa bằng ô nhiều dòng và lưu chữ thô, không bắt gõ JSON một dòng.
  const isText = row.key.startsWith('legal.') && typeof row.value === 'string';
  const [val, setVal] = useState(isText ? (row.value as string) : JSON.stringify(row.value));
  const [err, setErr] = useState<string | null>(null);
  const dead = row.deprecated === true;
  const { confirm, dialog } = useConfirm();
  const save = useMutation({
    mutationFn: async () => {
      let parsed: unknown;
      if (isText) {
        parsed = val;
      } else {
        try {
          parsed = JSON.parse(val);
        } catch {
          throw new Error('JSON không hợp lệ');
        }
      }
      if (isMoneyKey(row.key)) {
        const ok = await confirm({
          title: 'Xác nhận đổi cấu hình tiền/điểm',
          message: `${row.key}\n${JSON.stringify(row.value)} → ${JSON.stringify(parsed)}\n\nÁp dụng ngay cho mọi đơn, ví và điểm của khách.`,
          confirmLabel: 'Lưu thay đổi',
        });
        if (!ok) return null;
      }
      return setConfig(row.key, parsed);
    },
    onSuccess: (res) => {
      if (res === null) return;
      setErr(null);
      onSaved();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Lỗi'),
  });
  return (
    <div className={`rounded-card border border-stone-200 p-3 ${dead ? 'border-dashed bg-stone-50' : 'bg-stone-0'}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="min-w-0 break-all">{row.key}</span>
        {dead && <span className="rounded bg-stone-200 px-1.5 py-0.5 text-[11px] font-medium text-stone-600">Không dùng</span>}
      </div>
      {row.description && <div className="text-xs text-stone-500">{row.description}</div>}
      {dead && <div className="text-xs text-stone-500">Hệ thống không còn đọc khoá này nên sửa sẽ không có tác dụng.</div>}
      <div className={isText ? 'mt-1 flex flex-col gap-2' : 'mt-1 flex gap-2'}>
        {isText ? (
          <textarea
            value={val}
            onChange={(e) => setVal(e.target.value)}
            disabled={dead}
            aria-label={row.key}
            className="min-h-[160px] w-full rounded-control border border-stone-450 bg-stone-0 px-2 py-1 text-sm text-stone-900 disabled:bg-stone-100 disabled:text-stone-500"
          />
        ) : (
          <input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            disabled={dead}
            aria-label={row.key}
            className="min-h-[44px] min-w-0 flex-1 rounded-control border border-stone-450 bg-stone-0 px-2 py-1 font-mono text-sm text-stone-900 disabled:bg-stone-100 disabled:text-stone-500"
          />
        )}
        {!dead && (
          <button
            onClick={() => {
              setErr(null);
              save.mutate();
            }}
            disabled={save.isPending}
            className="min-h-[44px] shrink-0 rounded-control bg-forest-600 px-3 py-1 text-sm text-stone-0 hover:bg-forest-700 disabled:bg-stone-200 disabled:text-stone-500"
          >
            {save.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
        )}
      </div>
      {err && <div className="text-xs text-danger-fg">{err}</div>}
      {dialog}
    </div>
  );
}
