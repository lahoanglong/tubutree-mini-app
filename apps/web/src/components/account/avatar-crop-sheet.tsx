'use client';

import { useEffect, useState, type PointerEvent } from 'react';
import { Check, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { ui } from '@/lib/guest-ui';

const MASK = 240;
const OUTPUT = 200;

/**
 * Cắt ảnh đại diện thành hình tròn 200x200 JPEG, cùng cách làm với `AvatarCropModal` của Mini App: kéo để dời, thanh trượt
 * 1–3 để thu phóng. Ảnh nguồn được phủ kín khung theo kiểu "cover" ở cả bản xem trước lẫn bản vẽ canvas để vùng cắt ra khớp vùng khách thấy.
 */
export function AvatarCropSheet({
  open,
  imageSrc,
  onClose,
  onConfirm,
}: {
  open: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onConfirm: (croppedDataUrl: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (open) {
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    }
  }, [open, imageSrc]);

  if (!open || !imageSrc) return null;

  const down = (e: PointerEvent) => {
    // Bắt pointer để vẫn nhận move/up khi ngón tay kéo ra ngoài khung tròn.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Môi trường không hỗ trợ bắt pointer: vẫn còn onPointerLeave để dừng kéo.
    }
    setDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };
  const move = (e: PointerEvent) => {
    if (dragging) setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };
  const up = () => setDragging(false);

  const confirm = () => {
    setProcessing(true);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setProcessing(false);
        onConfirm(imageSrc);
        return;
      }
      ctx.beginPath();
      ctx.arc(OUTPUT / 2, OUTPUT / 2, OUTPUT / 2, 0, Math.PI * 2);
      ctx.clip();
      const k = OUTPUT / MASK;
      const aspect = img.width / img.height;
      const baseW = aspect > 1 ? MASK * aspect : MASK;
      const baseH = aspect > 1 ? MASK : MASK / aspect;
      const w = baseW * zoom;
      const h = baseH * zoom;
      ctx.drawImage(img, (MASK / 2 - w / 2 + offset.x) * k, (MASK / 2 - h / 2 + offset.y) * k, w * k, h * k);
      const url = canvas.toDataURL('image/jpeg', 0.82);
      setProcessing(false);
      onConfirm(url);
    };
    img.onerror = () => {
      setProcessing(false);
      onConfirm(imageSrc);
    };
    img.src = imageSrc;
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Cắt ảnh đại diện"
      description="Kéo di chuyển hoặc thu phóng để chọn góc mặt đẹp nhất"
      footer={
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className={`${ui.btnSecondary} flex-1 gap-1.5`}>
            <X className="h-4 w-4" aria-hidden="true" />
            Hủy chọn
          </button>
          <button type="button" onClick={confirm} disabled={processing} className={`${ui.btnPrimary} flex-1 gap-1.5`}>
            <Check className="h-4 w-4" aria-hidden="true" />
            {processing ? 'Đang xử lý…' : 'Xác nhận dùng'}
          </button>
        </div>
      }
    >
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        className="relative mx-auto overflow-hidden rounded-full bg-stone-100 ring-2 ring-forest-600"
        style={{ width: MASK, height: MASK, cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ảnh data URL cục bộ, next/image không áp dụng được */}
        <img
          src={imageSrc}
          alt=""
          draggable={false}
          className="pointer-events-none absolute left-1/2 top-1/2 h-full w-full max-w-none object-cover"
          style={{ transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
        />
      </div>
      <div className="mb-2 mt-5 flex items-center justify-center gap-3">
        <ZoomOut className="h-[18px] w-[18px] text-stone-600" aria-hidden="true" />
        <input
          type="range"
          aria-label="Thu phóng"
          min={1}
          max={3}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
          className="min-h-11 w-44 accent-forest-600"
        />
        <ZoomIn className="h-[18px] w-[18px] text-stone-600" aria-hidden="true" />
      </div>
    </Sheet>
  );
}
