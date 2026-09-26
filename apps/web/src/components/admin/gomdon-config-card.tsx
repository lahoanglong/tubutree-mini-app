'use client';

import { useEffect, useState } from 'react';
import { Recycle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getGomdonStatus, setConfig, type ConfigRow } from '@/lib/admin-client';
import {
  buildGomdonConfigValue,
  configValue,
  GOMDON_CONFIG_KEY,
  GOMDON_TOGGLE_KEY,
  readGomdonForm,
  WAREHOUSE_LABEL,
  type WarehouseForm,
} from '@/lib/admin-config-forms';
import { Field, INPUT_CLASS, Notice } from './ui';

/** Hằng (không phải `{}` mới mỗi render) — useEffect bên dưới so sánh theo tham chiếu. */
const NO_CONFIG: Record<string, unknown> = Object.freeze({}) as Record<string, unknown>;

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} aria-hidden />
      <span className={ok ? 'text-neutral-700' : 'text-red-700'}>
        {label}: {ok ? 'đã đặt' : 'chưa đặt'}
      </span>
    </span>
  );
}

/**
 * Cấu hình thu gom tái chế (Gomdon): công tắc hiện lựa chọn ở checkout + kho lấy hàng/cân nặng mặc định.
 * Tài khoản Gomdon & webhook secret nằm ở ENV, form này KHÔNG sửa và KHÔNG hiển thị chúng.
 */
export function GomdonConfigCard({ rows }: { rows: ConfigRow[] | undefined }) {
  const qc = useQueryClient();
  const statusQ = useQuery({ queryKey: ['admin-gomdon-status'], queryFn: getGomdonStatus });
  const current = configValue<unknown>(rows, GOMDON_CONFIG_KEY, NO_CONFIG);
  const toggle = configValue<unknown>(rows, GOMDON_TOGGLE_KEY, false) === true;

  const [warehouse, setWarehouse] = useState<WarehouseForm>(() => readGomdonForm(current).warehouse);
  const [weight, setWeight] = useState(() => readGomdonForm(current).weight);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<unknown>(current);

  // Nạp lại form khi dữ liệu config về (lần đầu rows còn undefined) hoặc sau khi lưu.
  useEffect(() => {
    if (current !== loadedFrom) {
      const f = readGomdonForm(current);
      setWarehouse(f.warehouse);
      setWeight(f.weight);
      setLoadedFrom(current);
    }
  }, [current, loadedFrom]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-config'] });
    void qc.invalidateQueries({ queryKey: ['admin-gomdon-status'] });
  };

  const saveToggle = useMutation({
    mutationFn: (on: boolean) => setConfig(GOMDON_TOGGLE_KEY, on),
    onSuccess: (_r, on) => {
      setMsg({ ok: true, text: on ? 'Đã BẬT lựa chọn thu gom ở checkout.' : 'Đã TẮT lựa chọn thu gom ở checkout.' });
      refresh();
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không lưu được.' }),
  });

  const saveWarehouse = useMutation({
    mutationFn: () => {
      const built = buildGomdonConfigValue(current, warehouse, weight);
      if (!built.value) throw new Error(built.error);
      return setConfig(GOMDON_CONFIG_KEY, built.value);
    },
    onSuccess: () => {
      setMsg({ ok: true, text: 'Đã lưu kho lấy hàng & cân nặng mặc định.' });
      refresh();
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không lưu được.' }),
  });

  const st = statusQ.data;
  const toggleOnButNotLive = toggle && st && !st.recyclingEnabled;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Recycle className="h-4 w-4 text-green-700" aria-hidden />
          <h3 className="text-sm font-semibold text-neutral-900">Thu gom vật liệu tái chế (Gomdon)</h3>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            role="switch"
            aria-checked={toggle}
            checked={toggle}
            disabled={saveToggle.isPending || !rows}
            onChange={(e) => {
              setMsg(null);
              saveToggle.mutate(e.target.checked);
            }}
          />
          <span className="font-medium">Hiện lựa chọn thu gom ở checkout</span>
        </label>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {statusQ.isError && <span className="text-xs text-red-600">Không tải được tình trạng tích hợp.</span>}
        {st && (
          <>
            <StatusDot ok={st.baseUrlSet} label="Base URL" />
            <StatusDot ok={st.credentialsSet} label="Tài khoản Gomdon" />
            <StatusDot ok={st.webhookSecretSet} label="Webhook secret" />
            <span className="text-xs">
              Khách{' '}
              <b className={st.recyclingEnabled ? 'text-green-700' : 'text-neutral-600'}>
                {st.recyclingEnabled ? 'ĐANG thấy' : 'KHÔNG thấy'}
              </b>{' '}
              lựa chọn thu gom
            </span>
          </>
        )}
      </div>

      {toggleOnButNotLive && (
        <div className="mt-2">
          <Notice tone="warning">
            Công tắc đang bật nhưng khách vẫn KHÔNG thấy lựa chọn thu gom vì Gomdon chưa cấu hình đủ (thiếu base URL/tài khoản
            trong env). Không hứa thu gom khi không có ai đi thu.
          </Notice>
        </div>
      )}

      <div className="mt-2">
        <Notice tone="info">
          Tài khoản Gomdon (<code>GOMDON_PHONE</code>, <code>GOMDON_PASSWORD</code>), <code>GOMDON_BASE_URL</code> và{' '}
          <code>GOMDON_WEBHOOK_SECRET</code> đặt trong biến môi trường của server API — không sửa ở đây và không bao giờ hiển
          thị. Đổi xong cần khởi động lại API.
        </Notice>
      </div>

      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          saveWarehouse.mutate();
        }}
      >
        <div className="text-xs font-semibold uppercase text-neutral-500">Kho lấy hàng (người gửi trên vận đơn)</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(Object.keys(WAREHOUSE_LABEL) as (keyof WarehouseForm)[]).map((f) => (
            <Field key={f} label={WAREHOUSE_LABEL[f]}>
              <input
                className={INPUT_CLASS}
                value={warehouse[f]}
                maxLength={255}
                onChange={(e) => setWarehouse((w) => ({ ...w, [f]: e.target.value }))}
                disabled={saveWarehouse.isPending}
              />
            </Field>
          ))}
          <Field label="Cân nặng mặc định mỗi sản phẩm (gram)" hint="Dùng khi biến thể chưa khai cân nặng — quyết định số kg thu gom tối đa.">
            <input
              className={INPUT_CLASS}
              inputMode="numeric"
              value={weight}
              onChange={(e) => setWeight(e.target.value.replace(/\D/g, ''))}
              disabled={saveWarehouse.isPending}
            />
          </Field>
        </div>
        <button
          type="submit"
          disabled={saveWarehouse.isPending || !rows}
          className="rounded bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:bg-neutral-300"
        >
          {saveWarehouse.isPending ? 'Đang lưu…' : 'Lưu kho & cân nặng'}
        </button>
      </form>

      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
