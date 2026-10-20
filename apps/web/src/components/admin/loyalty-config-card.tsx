'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Gift } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setConfig, type ConfigRow } from '@/lib/admin-client';
import { configValue, LOYALTY_DEFAULTS, LOYALTY_KEYS, parseCheckinPoints, parseIntInRange } from '@/lib/admin-config-forms';
import { Field, INPUT_CLASS, Notice } from './ui';
import { useConfirm } from './confirm-dialog';

interface NumbersForm {
  checkin: string[];
  maxOrderTotal: string;
  staffCap: string;
  memberCap: string;
}

function readForm(rows: ConfigRow[] | undefined): NumbersForm {
  const pts = configValue<unknown>(rows, LOYALTY_KEYS.checkinPoints, LOYALTY_DEFAULTS.checkinPoints);
  const checkin = Array.isArray(pts) && pts.length === 7 ? pts.map((p) => String(p)) : LOYALTY_DEFAULTS.checkinPoints.map(String);
  const num = (key: string, d: number) => {
    const v = configValue<unknown>(rows, key, d);
    return String(typeof v === 'number' ? v : d);
  };
  return {
    checkin,
    maxOrderTotal: num(LOYALTY_KEYS.posMaxOrderTotal, LOYALTY_DEFAULTS.posMaxOrderTotal),
    staffCap: num(LOYALTY_KEYS.posStaffDailyCap, LOYALTY_DEFAULTS.posStaffDailyCap),
    memberCap: num(LOYALTY_KEYS.posMemberDailyCap, LOYALTY_DEFAULTS.posMemberDailyCap),
  };
}

/** Kiểm cả form → danh sách {key, value} cần ghi, hoặc câu lỗi đầu tiên. */
export function buildLoyaltyWrites(f: NumbersForm): { writes?: { key: string; value: unknown }[]; error?: string } {
  const pts = parseCheckinPoints(f.checkin);
  if (pts.error) return { error: `Điểm danh — ${pts.error}` };
  const max = parseIntInRange(f.maxOrderTotal, 1000, 1_000_000_000, 'Trần mỗi hoá đơn');
  if (max.error) return { error: max.error };
  const staff = parseIntInRange(f.staffCap, 1, 1_000_000_000, 'Trần điểm/nhân viên/ngày');
  if (staff.error) return { error: staff.error };
  const member = parseIntInRange(f.memberCap, 1, 1_000_000_000, 'Trần điểm/thành viên/ngày');
  if (member.error) return { error: member.error };
  return {
    writes: [
      { key: LOYALTY_KEYS.checkinPoints, value: pts.value },
      { key: LOYALTY_KEYS.posMaxOrderTotal, value: max.value },
      { key: LOYALTY_KEYS.posStaffDailyCap, value: staff.value },
      { key: LOYALTY_KEYS.posMemberDailyCap, value: member.value },
    ],
  };
}

/**
 * Cấu hình Điểm Xanh: bảng điểm danh 7 ngày + tích điểm tại quầy (công tắc + trần). Ghi qua
 * PUT /admin/config chung (BE kiểm luật ở admin-config-rules.ts); chỉ gửi khoá có thay đổi hoặc chưa có
 * trong DB — mỗi lần ghi là một dòng lịch sử config.
 */
export function LoyaltyConfigCard({ rows }: { rows: ConfigRow[] | undefined }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const posEnabled = configValue<unknown>(rows, LOYALTY_KEYS.posEnabled, LOYALTY_DEFAULTS.posEnabled) === true;
  const [form, setForm] = useState<NumbersForm>(() => readForm(rows));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Nạp lại form CHỈ khi giá trị các khoá tích điểm trong DB đổi (lần đầu tải xong / sau khi lưu) — bật
  // tắt công tắc hay sửa khoá khác không được xoá số admin đang gõ dở.
  const snapshot = JSON.stringify(readForm(rows));
  const [loadedSnapshot, setLoadedSnapshot] = useState(snapshot);

  useEffect(() => {
    if (snapshot !== loadedSnapshot) {
      setForm(JSON.parse(snapshot) as NumbersForm);
      setLoadedSnapshot(snapshot);
    }
  }, [snapshot, loadedSnapshot]);

  const saveToggle = useMutation({
    mutationFn: async (on: boolean) => {
      // Chỉ bật mới cộng điểm cho khách; tắt là hướng an toàn nên lưu ngay.
      if (on) {
        const ok = await confirm({
          title: 'Xác nhận đổi cấu hình tiền/điểm',
          message: `${LOYALTY_KEYS.posEnabled}\nfalse → true\n\nThu ngân bắt đầu cộng điểm Xanh cho thành viên ngay.`,
          confirmLabel: 'Lưu thay đổi',
        });
        if (!ok) return null;
      }
      await setConfig(LOYALTY_KEYS.posEnabled, on);
      return on;
    },
    onSuccess: (done, on) => {
      if (done === null) return;
      setMsg({ ok: true, text: on ? 'Đã BẬT tích điểm tại quầy.' : 'Đã TẮT tích điểm tại quầy.' });
      void qc.invalidateQueries({ queryKey: ['admin-config'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không lưu được.' }),
  });

  const saveNumbers = useMutation({
    mutationFn: async () => {
      const built = buildLoyaltyWrites(form);
      if (!built.writes) throw new Error(built.error);
      const before = readForm(rows);
      const beforeWrites = buildLoyaltyWrites(before).writes ?? [];
      const changed = built.writes.filter(
        (w, i) => JSON.stringify(w.value) !== JSON.stringify(beforeWrites[i]?.value) || configValue(rows, w.key, undefined) === undefined,
      );
      if (changed.length === 0) return 0;
      const oldByKey = new Map(beforeWrites.map((w) => [w.key, configValue<unknown>(rows, w.key, w.value)]));
      const ok = await confirm({
        title: 'Xác nhận đổi cấu hình tiền/điểm',
        message: `${changed.map((w) => `${w.key}\n${JSON.stringify(oldByKey.get(w.key))} → ${JSON.stringify(w.value)}`).join('\n\n')}\n\nÁp dụng ngay cho mọi lượt điểm danh và tích điểm của khách.`,
        confirmLabel: 'Lưu thay đổi',
      });
      if (!ok) return null;
      // Tuần tự: lỗi ở khoá nào thì dừng và báo đúng khoá đó (các khoá trước đã lưu).
      for (const w of changed) {
        try {
          await setConfig(w.key, w.value);
        } catch (e) {
          throw new Error(`${w.key}: ${e instanceof Error ? e.message : 'không lưu được'}`);
        }
      }
      return changed.length;
    },
    onSuccess: (n) => {
      if (n === null) return;
      setMsg({ ok: true, text: n === 0 ? 'Không có thay đổi.' : `Đã lưu ${n} tham số tích điểm.` });
      void qc.invalidateQueries({ queryKey: ['admin-config'] });
    },
    onError: (e) => {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không lưu được.' });
      void qc.invalidateQueries({ queryKey: ['admin-config'] });
    },
  });

  const weekTotal = form.checkin.reduce((s, v) => s + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);

  return (
    <section className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-forest-700" aria-hidden />
          <h2 className="font-display text-sm font-semibold text-stone-900">Điểm Xanh — điểm danh & tích điểm tại quầy</h2>
        </div>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm sm:min-h-0">
          <input
            type="checkbox"
            role="switch"
            className="accent-forest-600"
            aria-checked={posEnabled}
            checked={posEnabled}
            disabled={saveToggle.isPending || !rows}
            onChange={(e) => {
              setMsg(null);
              saveToggle.mutate(e.target.checked);
            }}
          />
          <span className="font-medium">Bật tích điểm tại quầy (POS)</span>
        </label>
      </div>
      {!posEnabled && rows && (
        <div className="mt-2">
          <Notice tone="warning">
            Đang TẮT: thu ngân tra cứu được thành viên nhưng không cộng được điểm; thẻ thành viên trong app không hứa tích điểm
            tại quầy.
          </Notice>
        </div>
      )}

      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          saveNumbers.mutate();
        }}
      >
        <div>
          <div className="text-xs font-semibold uppercase text-stone-500">Điểm danh 7 ngày (điểm mỗi ngày, 0–100.000)</div>
          <div className="mt-1 grid grid-cols-7 gap-1.5">
            {form.checkin.map((v, i) => (
              <label key={i} className="text-center text-[11px] text-stone-500">
                N{i + 1}
                <input
                  aria-label={`Điểm ngày ${i + 1}`}
                  className={`${INPUT_CLASS} mt-0.5 px-1 text-center`}
                  inputMode="numeric"
                  value={v}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, checkin: f.checkin.map((x, j) => (j === i ? e.target.value.replace(/\D/g, '') : x)) }))
                  }
                  disabled={saveNumbers.isPending}
                />
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-stone-500">
            Tổng {weekTotal} điểm/tuần mỗi khách. Điểm điểm danh & tại quầy KHÔNG tính vào xét hạng.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Trần mỗi hoá đơn tại quầy (đ)">
            <input
              className={INPUT_CLASS}
              inputMode="numeric"
              value={form.maxOrderTotal}
              onChange={(e) => setForm((f) => ({ ...f, maxOrderTotal: e.target.value.replace(/\D/g, '') }))}
              disabled={saveNumbers.isPending}
            />
          </Field>
          <Field label="Trần điểm / nhân viên / ngày">
            <input
              className={INPUT_CLASS}
              inputMode="numeric"
              value={form.staffCap}
              onChange={(e) => setForm((f) => ({ ...f, staffCap: e.target.value.replace(/\D/g, '') }))}
              disabled={saveNumbers.isPending}
            />
          </Field>
          <Field label="Trần điểm / thành viên / ngày">
            <input
              className={INPUT_CLASS}
              inputMode="numeric"
              value={form.memberCap}
              onChange={(e) => setForm((f) => ({ ...f, memberCap: e.target.value.replace(/\D/g, '') }))}
              disabled={saveNumbers.isPending}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saveNumbers.isPending || !rows}
            className="min-h-[44px] rounded-control bg-forest-600 px-4 py-1.5 text-sm font-medium text-stone-0 hover:bg-forest-700 disabled:bg-stone-200 disabled:text-stone-500 sm:min-h-[36px]"
          >
            {saveNumbers.isPending ? 'Đang lưu…' : 'Lưu tham số tích điểm'}
          </button>
          <Link href="/admin/pos" className="inline-flex min-h-[44px] items-center text-sm font-medium text-forest-700 underline sm:min-h-0">
            Mở màn thu ngân →
          </Link>
        </div>
      </form>

      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
