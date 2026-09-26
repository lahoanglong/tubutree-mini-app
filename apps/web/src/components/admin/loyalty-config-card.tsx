'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Gift } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setConfig, type ConfigRow } from '@/lib/admin-client';
import { configValue, LOYALTY_DEFAULTS, LOYALTY_KEYS, parseCheckinPoints, parseIntInRange } from '@/lib/admin-config-forms';
import { Field, INPUT_CLASS, Notice } from './ui';

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
  const staff = parseIntInRange(f.staffCap, 1, 10_000_000, 'Trần điểm/nhân viên/ngày');
  if (staff.error) return { error: staff.error };
  const member = parseIntInRange(f.memberCap, 1, 10_000_000, 'Trần điểm/thành viên/ngày');
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
    mutationFn: (on: boolean) => setConfig(LOYALTY_KEYS.posEnabled, on),
    onSuccess: (_r, on) => {
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
    <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-green-700" aria-hidden />
          <h3 className="text-sm font-semibold text-neutral-900">Điểm Xanh — điểm danh & tích điểm tại quầy</h3>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            role="switch"
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
          <div className="text-xs font-semibold uppercase text-neutral-500">Điểm danh 7 ngày (điểm mỗi ngày, 0–100)</div>
          <div className="mt-1 grid grid-cols-7 gap-1.5">
            {form.checkin.map((v, i) => (
              <label key={i} className="text-center text-[11px] text-neutral-500">
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
          <p className="mt-1 text-[11px] text-neutral-500">
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
            className="rounded bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:bg-neutral-300"
          >
            {saveNumbers.isPending ? 'Đang lưu…' : 'Lưu tham số tích điểm'}
          </button>
          <Link href="/admin/pos" className="text-sm font-medium text-green-700 underline">
            Mở màn thu ngân →
          </Link>
        </div>
      </form>

      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
