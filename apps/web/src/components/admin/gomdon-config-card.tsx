'use client';

import { useEffect, useState } from 'react';
import { Recycle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  checkGomdonConnection,
  getGomdonStatus,
  setConfig,
  type ConfigRow,
  type GomdonConnectionHealth,
} from '@/lib/admin-client';
import {
  buildGomdonConfigValue,
  configValue,
  GOMDON_CONFIG_KEY,
  GOMDON_TOGGLE_KEY,
  readGomdonForm,
  WAREHOUSE_LABEL,
  type WarehouseForm,
} from '@/lib/admin-config-forms';
import { formatDateTime } from '@/lib/format-date';
import { BTN_XS_SECONDARY, Field, INPUT_CLASS, Notice } from './ui';

/** Hằng (không phải `{}` mới mỗi render) — useEffect bên dưới so sánh theo tham chiếu. */
const NO_CONFIG: Record<string, unknown> = Object.freeze({}) as Record<string, unknown>;

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-success-fg' : 'bg-danger-fg'}`} aria-hidden />
      <span className={ok ? 'text-stone-700' : 'text-danger-fg'}>
        {label}: {ok ? 'đã đặt' : 'chưa đặt'}
      </span>
    </span>
  );
}

/** Lần gọi Gomdon gần nhất của API — để admin thấy Gomdon đang lỗi trước khi đơn thành "tạo tay". */
function ConnectionLine({ c }: { c: GomdonConnectionHealth }) {
  const okAt = c.lastOkAt ? Date.parse(c.lastOkAt) : 0;
  const errAt = c.lastErrorAt ? Date.parse(c.lastErrorAt) : 0;
  let tone = 'text-stone-600';
  let text = 'chưa gọi Gomdon lần nào từ khi API khởi động';
  if (c.credentialsRejected) {
    tone = 'text-danger-fg';
    text = 'Gomdon từ chối tài khoản';
  } else if (okAt && okAt >= errAt) {
    tone = 'text-success-fg';
    text = `ổn, lần cuối ${formatDateTime(c.lastOkAt!)}`;
  } else if (errAt) {
    tone = 'text-warning-fg';
    text = `lỗi lúc ${formatDateTime(c.lastErrorAt!)}`;
  }
  return (
    <span className="text-xs">
      Kết nối: <b className={tone}>{text}</b>
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
  const [checkMsg, setCheckMsg] = useState<{ ok: boolean; text: string } | null>(null);
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
      setMsg({ ok: true, text: on ? 'Đã BẬT công tắc kỹ thuật Gomdon.' : 'Đã TẮT công tắc kỹ thuật Gomdon.' });
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

  const checkConnection = useMutation({
    mutationFn: checkGomdonConnection,
    onSuccess: (r) => {
      setCheckMsg({ ok: r.ok, text: r.ok ? r.message : `Không đăng nhập được Gomdon: ${r.message}` });
      void qc.invalidateQueries({ queryKey: ['admin-gomdon-status'] });
    },
    onError: (e) => setCheckMsg({ ok: false, text: e instanceof Error ? e.message : 'Không kiểm tra được kết nối.' }),
  });

  const st = statusQ.data;
  const rejected = st?.connection?.credentialsRejected === true;
  const lastError = st?.connection?.lastError ?? null;
  const toggleOnButNotLive = toggle && st && !st.recyclingEnabled && !rejected;

  return (
    <section className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Recycle className="h-4 w-4 text-forest-700" aria-hidden />
          <h2 className="font-display text-sm font-semibold text-stone-900">Thu kèm rác qua Gomdon (kỹ thuật)</h2>
        </div>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm sm:min-h-0">
          <input
            type="checkbox"
            role="switch"
            className="accent-forest-600"
            aria-checked={toggle}
            checked={toggle}
            disabled={saveToggle.isPending || !rows}
            onChange={(e) => {
              setMsg(null);
              saveToggle.mutate(e.target.checked);
            }}
          />
          <span className="font-medium">Công tắc kỹ thuật Gomdon</span>
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {statusQ.isError && <span className="text-xs text-danger-fg">Không tải được tình trạng tích hợp.</span>}
        {st && (
          <>
            <StatusDot ok={st.baseUrlSet} label="Base URL" />
            <StatusDot ok={st.credentialsSet} label="Tài khoản Gomdon" />
            <StatusDot ok={st.webhookSecretSet} label="Webhook secret" />
            <span className="text-xs">
              Khách{' '}
              <b className={st.pickupVisible ? 'text-success-fg' : 'text-stone-600'}>
                {st.pickupVisible ? 'ĐANG thấy' : 'KHÔNG thấy'}
              </b>{' '}
              lựa chọn thu gom
            </span>
            {st.connection && <ConnectionLine c={st.connection} />}
          </>
        )}
        <button
          type="button"
          onClick={() => {
            setCheckMsg(null);
            checkConnection.mutate();
          }}
          disabled={checkConnection.isPending}
          className={BTN_XS_SECONDARY}
        >
          {checkConnection.isPending ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
        </button>
      </div>
      {checkMsg && (
        <p role={checkMsg.ok ? 'status' : 'alert'} className={`mt-1 text-xs ${checkMsg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
          {checkMsg.text}
        </p>
      )}

      {st && (
        <p className="mt-1 text-xs text-stone-600">
          Khách chỉ thấy lựa chọn thu gom khi bật thêm &quot;Bật chương trình với khách&quot; và &quot;Cách Thu kèm đơn&quot; ở Khách hàng › Đổi rác › Cấu hình chung.
        </p>
      )}

      {rejected && (
        <div className="mt-2">
          <Notice tone="danger">
            Gomdon đang từ chối tài khoản (<code>GOMDON_PHONE</code>/<code>GOMDON_PASSWORD</code>) nên khách tạm KHÔNG thấy lựa
            chọn thu gom. Đơn thu gom đang chờ sẽ tự tạo vận đơn khi đăng nhập lại được. Sai tài khoản thì sửa env rồi khởi động
            lại API; Gomdon vừa mở khoá tài khoản thì bấm &quot;Kiểm tra kết nối&quot;.{lastError && <> Lỗi gần nhất: {lastError}</>}
          </Notice>
        </div>
      )}

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
        <div className="text-xs font-semibold uppercase text-stone-500">Kho lấy hàng (người gửi trên vận đơn)</div>
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
          className="min-h-[44px] rounded-control bg-forest-600 px-4 py-1.5 text-sm font-medium text-stone-0 hover:bg-forest-700 disabled:bg-stone-200 disabled:text-stone-500 sm:min-h-[36px]"
        >
          {saveWarehouse.isPending ? 'Đang lưu…' : 'Lưu kho & cân nặng'}
        </button>
      </form>

      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
