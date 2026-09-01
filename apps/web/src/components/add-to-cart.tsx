'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { addToCart, formatVnd } from '@/lib/shop-client';

interface Variation {
  id: string;
  name: string;
  retailPrice: number;
  salePrice: number | null;
  stock: number;
}

export default function AddToCart({ variations }: { variations: Variation[] }) {
  const router = useRouter();
  const { status } = useAuth();
  const inStock = variations.filter((v) => v.stock > 0);
  const [selectedId, setSelectedId] = useState<string>((inStock[0] ?? variations[0])?.id ?? '');
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const selected = variations.find((v) => v.id === selectedId);
  const price = selected?.salePrice ?? selected?.retailPrice ?? 0;
  const available = (selected?.stock ?? 0) > 0;

  const onAdd = async () => {
    if (status !== 'authenticated') {
      router.push('/dang-nhap');
      return;
    }
    if (!selected || !available) return;
    setBusy(true);
    setMsg(null);
    try {
      await addToCart(selected.id, qty);
      setMsg('Đã thêm vào giỏ!');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Không thêm được vào giỏ.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      {variations.length > 1 && (
        <>
          <div className="text-sm font-semibold">Phân loại</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {variations.map((v) => {
              const out = v.stock <= 0;
              const active = v.id === selectedId;
              return (
                <button
                  key={v.id}
                  onClick={() => setSelectedId(v.id)}
                  className={`rounded-md border px-3 py-1.5 text-sm transition ${
                    active ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-neutral-200'
                  } ${out ? 'opacity-50 line-through' : ''}`}
                >
                  {v.name} · {formatVnd(v.salePrice ?? v.retailPrice)}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-4 flex items-center gap-3">
        <div className="flex items-center rounded-md border border-neutral-200">
          <button
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="px-3 py-2 text-lg"
            aria-label="Giảm"
          >
            −
          </button>
          <span className="w-8 text-center">{qty}</span>
          <button
            onClick={() => setQty((q) => Math.min(selected?.stock ?? 1, q + 1))}
            className="px-3 py-2 text-lg"
            aria-label="Tăng"
          >
            +
          </button>
        </div>
        <button
          onClick={onAdd}
          disabled={busy || !available}
          className="flex-1 rounded-md bg-primary-600 px-6 py-3 font-medium text-white transition hover:bg-primary-700 disabled:bg-neutral-300"
        >
          {!available ? 'Hết hàng' : busy ? 'Đang thêm…' : `Thêm vào giỏ · ${formatVnd(price * qty)}`}
        </button>
      </div>

      {msg && (
        <p className="mt-3 text-sm text-leaf-700">
          {msg}{' '}
          {msg.includes('giỏ') && (
            <a href="/gio-hang" className="font-semibold underline">
              Xem giỏ hàng →
            </a>
          )}
        </p>
      )}
    </div>
  );
}
