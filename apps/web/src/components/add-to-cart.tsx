'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { addToCart, formatVnd } from '@/lib/shop-client';
import { ui } from '@/lib/guest-ui';

interface Variation {
  id: string;
  name: string;
  retailPrice: number;
  salePrice: number | null;
  stock: number;
}

export default function AddToCart({ variations }: { variations: Variation[] }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { status } = useAuth();
  const inStock = variations.filter((v) => v.stock > 0);
  const [selectedId, setSelectedId] = useState<string>((inStock[0] ?? variations[0])?.id ?? '');
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const selected = variations.find((v) => v.id === selectedId);
  const price = selected?.salePrice ?? selected?.retailPrice ?? 0;
  const available = (selected?.stock ?? 0) > 0;
  // Số lượng luôn giới hạn theo tồn kho của phân loại đang chọn (tối thiểu 1) — tránh
  // trường hợp chuyển sang phân loại còn ít/hết hàng nhưng vẫn giữ số lượng của phân loại cũ,
  // dẫn đến gửi lên giỏ hàng số lượng vượt tồn kho (hoặc bằng 0 nếu hết hàng).
  const maxQty = Math.max(selected?.stock ?? 1, 1);

  // Đổi phân loại → reset số lượng về 1 thay vì giữ số lượng cũ (có thể vượt tồn kho mới).
  useEffect(() => {
    setQty(1);
  }, [selectedId]);

  const onAdd = async () => {
    if (status !== 'authenticated') {
      router.push('/dang-nhap');
      return;
    }
    if (!selected || !available) return;
    setBusy(true);
    setMsg(null);
    try {
      const cart = await addToCart(selected.id, qty);
      // Badge giỏ ở header đọc cùng queryKey ['cart'] nhưng nằm trong layout nên không bao giờ
      // remount, và providers tắt refetchOnWindowFocus — không cập nhật thì khách thêm 3 món
      // vẫn thấy số cũ, tưởng chưa thêm được rồi thêm lại thành trùng số lượng.
      qc.setQueryData(['cart'], cart);
      setMsg('Đã thêm vào giỏ!');
      setSuccess(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Không thêm được vào giỏ.');
      setSuccess(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      {variations.length > 1 && (
        <div role="group" aria-labelledby="variation-label">
          <div id="variation-label" className="text-sm font-semibold text-stone-900">
            Phân loại
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {variations.map((v) => {
              const out = v.stock <= 0;
              const active = v.id === selectedId;
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedId(v.id)}
                  className={`min-h-11 rounded-control border px-4 text-sm transition ${
                    active
                      ? 'border-forest-600 bg-forest-50 font-semibold text-forest-700'
                      : 'border-stone-450 bg-stone-0 text-stone-800 hover:bg-stone-50'
                  } ${out ? 'opacity-60 line-through' : ''}`}
                >
                  {v.name} · {formatVnd(v.salePrice ?? v.retailPrice)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <div className="flex items-center rounded-control border border-stone-450 bg-stone-0">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="h-11 w-11 text-lg text-stone-800"
            aria-label="Giảm số lượng"
          >
            −
          </button>
          <span className="w-8 text-center text-stone-900" aria-live="polite">
            {qty}
          </span>
          <button
            type="button"
            onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
            className="h-11 w-11 text-lg text-stone-800"
            aria-label="Tăng số lượng"
          >
            +
          </button>
        </div>
        <button type="button" onClick={onAdd} disabled={busy || !available} className={`${ui.btnPrimary} flex-1`}>
          {!available ? 'Hết hàng' : busy ? 'Đang thêm…' : `Thêm vào giỏ · ${formatVnd(price * qty)}`}
        </button>
      </div>

      {msg && (
        <p role="status" className={`mt-3 text-sm ${success ? 'text-success-fg' : 'text-danger-fg'}`}>
          {msg}{' '}
          {success && (
            <a href="/gio-hang" className="font-semibold underline">
              Xem giỏ hàng →
            </a>
          )}
        </p>
      )}
    </div>
  );
}
