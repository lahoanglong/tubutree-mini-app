import { useRef, useState, useEffect } from 'react';
import { Box, Text, Button, Sheet } from 'zmp-ui';
import { ZoomIn, ZoomOut, Check, X } from 'lucide-react';
import { haptic } from '../utils/haptic';

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

  return (
    <Sheet visible={visible} onClose={onClose} autoHeight>
      <Box p={4} style={{ background: '#121212', color: '#ffffff', textAlign: 'center' }}>
        <Text bold size="large" style={{ color: '#ffffff', marginBottom: 4 }}>
          Cắt ảnh đại diện
        </Text>
        <Text size="xSmall" style={{ color: '#a0a0a0', marginBottom: 16 }}>
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
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.75), 0 0 0 3px var(--leaf-500)',
            cursor: dragging ? 'grabbing' : 'grab',
            touchAction: 'none',
            userSelect: 'none',
            background: '#000000',
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
              width: '100%',
              height: 'auto',
              pointerEvents: 'none',
            }}
          />
        </div>

        {/* Zoom Slider Controls */}
        <Box
          flex
          alignItems="center"
          justifyContent="center"
          style={{ gap: 12, marginTop: 24, marginBottom: 16 }}
        >
          <ZoomOut size={18} color="#a0a0a0" />
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            style={{
              width: 180,
              accentColor: 'var(--leaf-500)',
              cursor: 'pointer',
            }}
          />
          <ZoomIn size={18} color="#a0a0a0" />
        </Box>

        {/* Action Buttons */}
        <Box flex style={{ gap: 12, marginTop: 8 }}>
          <Button
            fullWidth
            variant="secondary"
            onClick={() => {
              haptic('light');
              onClose();
            }}
            style={{ background: 'rgba(255,255,255,0.15)', color: '#ffffff' }}
          >
            <X size={16} style={{ marginRight: 6 }} /> Hủy chọn
          </Button>

          <Button
            fullWidth
            loading={processing}
            onClick={handleConfirm}
            style={{ background: 'var(--leaf-600)' }}
          >
            <Check size={16} style={{ marginRight: 6 }} /> Xác nhận dùng
          </Button>
        </Box>
      </Box>
    </Sheet>
  );
}
