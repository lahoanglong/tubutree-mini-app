'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { GeoPicker, EMPTY_GEO, type GeoValue } from '@/components/geo-picker';
import {
  getCart,
  getAddresses,
  createAddress,
  checkoutQuote,
  placeOrder,
  formatVnd,
  type AddressDTO,
  type OrderDTO,
} from '@/lib/shop-client';

const VN_PHONE = /^(0|\+84)\d{9}$/;
// Tỉnh/phường chọn qua GeoPicker (mã Pancake thật, hệ 2 cấp — không còn quận/huyện);
// chỉ 3 field text còn lại (mirror miniapp address-section.tsx).
const EMPTY = { recipient: '', phone: '', street: '' };
type Form = typeof EMPTY;

export default function CheckoutPage() {
  const { status } = useAuth();
  const qc = useQueryClient();
  const [addressId, setAddressId] = useState<string | null>(null);
  const [payment, setPayment] = useState('COD');
  const [placed, setPlaced] = useState<OrderDTO | null>(null);
  const [idemKey] = useState(() => (typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Math.random())));

  const cartQ = useQuery({ queryKey: ['cart'], queryFn: getCart, enabled: status === 'authenticated' });
  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses, enabled: status === 'authenticated' });

  useEffect(() => {
    if (addrQ.data && addressId === null) {
      const def = addrQ.data.find((a) => a.isDefault) ?? addrQ.data[0];
      if (def) setAddressId(def.id);
    }
  }, [addrQ.data, addressId]);

  const quoteQ = useQuery({
    queryKey: ['quote', addressId],
    queryFn: () => checkoutQuote(addressId!),
    enabled: !!addressId && status === 'authenticated',
  });

  const place = useMutation({
    mutationFn: () => placeOrder({ addressId: addressId!, paymentMethod: payment }, idemKey),
    onSuccess: (order) => {
      setPlaced(order);
      void qc.invalidateQueries({ queryKey: ['cart'] });
    },
  });

  if (status === 'idle' || status === 'loading') {
    return (
      <Shell>
        <div className="py-20 text-center">
          <p className="text-neutral-400">Đang tải…</p>
        </div>
      </Shell>
    );
  }

  if (status !== 'authenticated') {
    return (
      <Shell>
        <div className="py-20 text-center">
          <p className="text-neutral-600">Vui lòng đăng nhập để thanh toán.</p>
          <Link href="/dang-nhap" className="mt-4 inline-block rounded-full bg-primary-600 px-6 py-2.5 font-semibold text-white">
            Đăng nhập với Zalo
          </Link>
        </div>
      </Shell>
    );
  }

  if (placed) {
    return (
      <Shell>
        <div className="py-16 text-center">
          <div className="text-6xl">🎉</div>
          <h2 className="mt-4 text-xl font-bold">Đặt hàng thành công!</h2>
          <p className="mt-2 text-neutral-600">
            Mã đơn <span className="font-semibold text-leaf-700">{placed.code}</span> · {formatVnd(placed.total)}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/tai-khoan" className="rounded-md bg-primary-600 px-5 py-2.5 font-medium text-white">
              Xem đơn của tôi
            </Link>
            <Link href="/" className="rounded-md border border-neutral-200 px-5 py-2.5">
              Tiếp tục mua sắm
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  const cart = cartQ.data;
  const quote = quoteQ.data;

  return (
    <Shell>
      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <section className="rounded-lg border border-neutral-100 bg-white p-4">
            <h2 className="font-semibold">Địa chỉ giao hàng</h2>
            <AddressPicker
              addresses={addrQ.data ?? []}
              selectedId={addressId}
              onSelect={setAddressId}
              onCreated={(a) => {
                void qc.invalidateQueries({ queryKey: ['addresses'] });
                setAddressId(a.id);
              }}
            />
          </section>

          <section className="rounded-lg border border-neutral-100 bg-white p-4">
            <h2 className="font-semibold">Phương thức thanh toán</h2>
            <div className="mt-2 space-y-2">
              {[
                { k: 'COD', label: 'Thanh toán khi nhận hàng (COD)' },
                { k: 'BANK_TRANSFER', label: 'Chuyển khoản ngân hàng' },
              ].map((p) => (
                <label key={p.k} className="flex cursor-pointer items-center gap-3 rounded-md border border-neutral-200 p-3 text-sm">
                  <input type="radio" name="pay" checked={payment === p.k} onChange={() => setPayment(p.k)} />
                  {p.label}
                </label>
              ))}
            </div>
          </section>
        </div>

        <div className="h-fit rounded-lg border border-neutral-100 bg-white p-4">
          <h2 className="font-semibold">Đơn hàng</h2>
          <div className="mt-2 max-h-40 space-y-1 overflow-auto text-sm">
            {cart?.items.map((it) => (
              <div key={it.id} className="flex justify-between">
                <span className="text-neutral-600">{it.productName} ×{it.quantity}</span>
                <span>{formatVnd(it.total)}</span>
              </div>
            ))}
          </div>
          <Row label="Tạm tính" value={formatVnd(quote?.subtotal ?? cart?.subtotal ?? 0)} />
          {(quote?.discount ?? 0) > 0 && <Row label="Giảm giá" value={`-${formatVnd(quote!.discount)}`} green />}
          <Row label="Phí vận chuyển" value={quote ? (quote.shippingFee === 0 ? 'Miễn phí' : formatVnd(quote.shippingFee)) : '…'} />
          <div className="mt-3 flex justify-between border-t pt-3 font-bold">
            <span>Tổng cộng</span>
            <span className="text-clay-700">{formatVnd(quote?.total ?? 0)}</span>
          </div>
          {quote && quote.pointsEarned > 0 && (
            <p className="mt-1 text-xs text-leaf-700">+{quote.pointsEarned} Điểm Xanh sau khi giao</p>
          )}

          <button
            onClick={() => place.mutate()}
            disabled={!addressId || !quote || place.isPending}
            className="mt-4 w-full rounded-md bg-primary-600 px-6 py-3 font-medium text-white hover:bg-primary-700 disabled:bg-neutral-300"
          >
            {place.isPending ? 'Đang đặt hàng…' : 'Đặt hàng'}
          </button>
          {place.isError && (
            <p className="mt-2 text-sm text-red-600">
              {place.error instanceof Error ? place.error.message : 'Đặt hàng thất bại.'}
            </p>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Row({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div className={`mt-1 flex justify-between text-sm ${green ? 'text-leaf-700' : ''}`}>
      <span className={green ? '' : 'text-neutral-600'}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function AddressPicker({
  addresses,
  selectedId,
  onSelect,
  onCreated,
}: {
  addresses: AddressDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreated: (a: AddressDTO) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [geo, setGeo] = useState<GeoValue>(EMPTY_GEO);
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createAddress({
        recipient: form.recipient.trim(),
        phone: form.phone.replace(/\s/g, ''),
        street: form.street.trim(),
        province: geo.province,
        ward: geo.ward,
        district: '', // hệ 2 cấp (Pancake) — không còn quận/huyện
        provinceCode: geo.provinceCode,
        wardCode: geo.wardCode,
        districtCode: '',
      }),
    onSuccess: (a) => {
      setAdding(false);
      setForm(EMPTY);
      setGeo(EMPTY_GEO);
      onCreated(a);
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Lỗi'),
  });

  const valid = useMemo(
    () =>
      Object.values(form).every((v) => v.trim()) &&
      VN_PHONE.test(form.phone.replace(/\s/g, '')) &&
      !!geo.provinceCode &&
      !!geo.wardCode,
    [form, geo],
  );

  return (
    <div className="mt-2 space-y-2">
      {addresses.map((a) => (
        <label
          key={a.id}
          className={`flex cursor-pointer gap-3 rounded-md border p-3 text-sm ${
            selectedId === a.id ? 'border-primary-600 bg-primary-50' : 'border-neutral-200'
          }`}
        >
          <input type="radio" name="addr" checked={selectedId === a.id} onChange={() => onSelect(a.id)} className="mt-1" />
          <span>
            <span className="font-medium">{a.recipient} · {a.phone}</span>
            <br />
            <span className="text-neutral-600">{a.street}, {a.ward}, {a.district}, {a.province}</span>
          </span>
        </label>
      ))}

      {adding ? (
        <div className="space-y-2 rounded-md border border-neutral-200 p-3">
          <input
            placeholder={LABEL.recipient}
            value={form.recipient}
            onChange={(e) => setForm((f) => ({ ...f, recipient: e.target.value }))}
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          <input
            placeholder={LABEL.phone}
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          <GeoPicker value={geo} onChange={setGeo} />
          <input
            placeholder={LABEL.street}
            value={form.street}
            onChange={(e) => setForm((f) => ({ ...f, street: e.target.value }))}
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button onClick={() => setAdding(false)} className="rounded border border-neutral-200 px-4 py-2 text-sm">Hủy</button>
            <button
              onClick={() => create.mutate()}
              disabled={!valid || create.isPending}
              className="flex-1 rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:bg-neutral-300"
            >
              Lưu địa chỉ
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="text-sm font-semibold text-primary-700">
          + Thêm địa chỉ mới
        </button>
      )}
    </div>
  );
}

const LABEL: Record<keyof Form, string> = {
  recipient: 'Người nhận',
  phone: 'Số điện thoại',
  street: 'Số nhà, đường',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/gio-hang" className="text-sm text-primary-600">← Về giỏ hàng</Link>
      <h1 className="mt-3 text-xl font-bold">Thanh toán</h1>
      <div className="mt-4">{children}</div>
    </main>
  );
}
