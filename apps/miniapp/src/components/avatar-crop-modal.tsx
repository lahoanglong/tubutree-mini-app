import { useRef, useState, useEffect } from 'react';
import { Sheet } from 'zmp-ui';
import { ZoomIn, ZoomOut, Check, X } from 'lucide-react';
import { haptic } from '../utils/haptic';
import { Button } from './ui/button';
import { Heading, Text } from './ui/text';

export interface AvatarCropModalProps {
  visible: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onConfirm: (croppedDataUrl: string) => void;
}

export function AvatarCropModal({
  visible,
  imageSrc,
  onClose,
  onConfirm,
}: AvatarCropModalProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [processing, setProcessing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset controls when a new image opens
  useEffect(() => {
    if (visible) {
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    }
  }, [visible, imageSrc]);

  if (!visible || !imageSrc) return null;

  // Touch & Mouse Drag handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    // Bắt pointer để tiếp tục nhận move/up ngay cả khi ngón tay kéo ra khỏi khung tròn 240px —
    // nếu không, onPointerLeave sẽ bắn ra giữa chừng và dừng theo dõi kéo sớm.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // một số môi trường/loại pointer không hỗ trợ — bỏ qua, vẫn còn fallback onPointerLeave
    }
    setDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handlePointerUp = () => {
    setDragging(false);
  };

  // Process circular crop using HTML5 Canvas
  const handleConfirm = () => {
    haptic('medium');
    setProcessing(true);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const outputSize = 200; // Optimal 200x200px avatar resolution (~20KB)
      const canvas = document.createElement('canvas');
      canvas.width = outputSize;
      canvas.height = outputSize;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        setProcessing(false);
        onConfirm(imageSrc);
        return;
      }

      // Draw circular clip path
      ctx.beginPath();
      ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
      ctx.clip();

      // Mask container diameter is 240px
      const maskSize = 240;
      const scaleFactor = outputSize / maskSize;

      // Calculate image drawing bounds
      const aspect = img.width / img.height;
      let baseW = maskSize;
      let baseH = maskSize;

      if (aspect > 1) {
        baseW = maskSize * aspect;
      } else {
        baseH = maskSize / aspect;
      }

      const scaledW = baseW * zoom;
      const scaledH = baseH * zoom;

      // Center initial placement + offset
      const maskCenterX = maskSize / 2;
      const maskCenterY = maskSize / 2;

      const drawX = (maskCenterX - scaledW / 2 + offset.x) * scaleFactor;
      const drawY = (maskCenterY - scaledH / 2 + offset.y) * scaleFactor;
      const finalW = scaledW * scaleFactor;
      const finalH = scaledH * scaleFactor;

      ctx.drawImage(img, drawX, drawY, finalW, finalH);

      const croppedUrl = canvas.toDataURL('image/jpeg', 0.82);
      setProcessing(false);
      onConfirm(croppedUrl);
    };

    img.onerror = () => {
      setProcessing(false);
      onConfirm(imageSrc);
    };

    img.src = imageSrc;
  };

  // Sheet nền tối giữ nguyên có chủ đích: thao tác cắt ảnh nổi trên nền tối, không theo nền sáng của BottomSheet.
  return (
    <Sheet visible={visible} onClose={onClose} autoHeight>
      <div style={{ padding: 16, background: 'var(--color-bg-inverse)', color: 'var(--color-text-inverse)', textAlign: 'center' }}>
        <Heading variant="title-md" as="h2" tone="inverse" style={{ marginBottom: 4 }}>
          Cắt ảnh đại diện
        </Heading>
        <Text variant="caption" tone="inverse" as="p" style={{ margin: 0, marginBottom: 16, opacity: 0.7 }}>
          Kéo di chuyển hoặc thu phóng để chọn góc mặt đẹp nhất
        </Text>

        {/* Circular Crop Viewport Frame */}
        <div
          ref={containerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          style={{
            position: 'relative',
            width: 240,
            height: 240,
            margin: '0 auto',
            borderRadius: '50%',
            overflow: 'hidden',
            boxShadow: '0 0 0 9999px var(--color-bg-scrim), 0 0 0 3px var(--color-action-primary-bg)',
            cursor: dragging ? 'grabbing' : 'grab',
            touchAction: 'none',
            userSelect: 'none',
            background: 'var(--color-bg-inverse)',
          }}
        >
          <img
            src={imageSrc}
            alt="crop preview"
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              maxWidth: 'none',
              maxHeight: 'none',
              // width/height 100% + cover: khớp với công thức "cover" dùng khi cắt bằng Canvas
              // bên dưới (handleConfirm) — trước đây height:'auto' khiến ảnh ngang (aspect>1)
              // không phủ kín chiều cao khung tròn, làm vùng cắt xuất ra khác vùng user thấy.
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              pointerEvents: 'none',
            }}
          />
        </div>

        {/* Zoom Slider Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 24, marginBottom: 16 }}>
          <ZoomOut size={18} color="var(--color-text-inverse)" style={{ opacity: 0.7 }} aria-hidden />
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            style={{
              width: 180,
              accentColor: 'var(--color-action-primary-bg)',
              cursor: 'pointer',
            }}
          />
          <ZoomIn size={18} color="var(--color-text-inverse)" style={{ opacity: 0.7 }} aria-hidden />
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <Button
            fullWidth
            variant="secondary"
            onPress={() => {
              haptic('light');
              onClose();
            }}
            style={{ background: 'var(--stone-700)', color: 'var(--color-text-inverse)' }}
          >
            <X size={16} style={{ marginRight: 6 }} aria-hidden /> Hủy chọn
          </Button>

          <Button fullWidth loading={processing} icon={Check} onPress={handleConfirm}>
            Xác nhận dùng
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
