import { useState } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import { MapPin } from 'lucide-react';
import { haptic } from '../utils/haptic';
import { BRAND_ORIGINS, PIN_CIRCLE, PIN_GAP, type BrandOrigin } from '../utils/brand-origins';
import { brandBrowsePath } from '../utils/brands';
import { vi } from '../i18n/vi';
import { PageHeader } from '../components/ui/page-header';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { Icon } from '../components/ui/icon';
import { Text, Heading } from '../components/ui/text';
import '../css/brand-theme.css';

export default function BrandStoryPage() {
  const [selected, setSelected] = useState<BrandOrigin | null>(null);
  const pick = (loc: BrandOrigin) => {
    haptic('light');
    setSelected(loc);
  };

  return (
    <Page style={{ background: 'var(--color-bg-canvas)', paddingBottom: 32 }}>
      <PageHeader title={vi.home.brandStoryTitle} />
      <div style={{ padding: '16px 16px 8px' }}>
        <Text tone="secondary" as="p" style={{ lineHeight: 1.5 }}>
          Mỗi thương hiệu Tubu Tree đều gắn liền với một tỉnh thành Việt Nam. Chạm mốc trên bản đồ gỗ 3D để khám phá xuất xứ 🌿
        </Text>
      </div>

      {/* Bản đồ Gỗ 3D Đa khối Tỉnh thành Việt Nam có đèn LED hắt sáng + Hoàng Sa & Trường Sa */}
      <IngredientMap onPick={pick} />

      <div style={{ padding: '16px 16px 8px' }}>
        <Heading variant="title-sm" as="h2">
          {BRAND_ORIGINS.length} Thương hiệu & Tỉnh thành xuất xứ
        </Heading>
      </div>

      <div style={{ padding: '0 16px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {BRAND_ORIGINS.map((loc) => (
          <button
            key={loc.id}
            type="button"
            className="tubu-press"
            onClick={() => pick(loc)}
            style={{
              border: 'none',
              font: 'inherit',
              textAlign: 'left',
              cursor: 'pointer',
              borderRadius: 'var(--radius-card)',
              overflow: 'hidden',
              boxShadow: 'var(--elevation-1)',
              minHeight: 135,
              background: loc.gradient,
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <span aria-hidden style={{ fontSize: 34, lineHeight: 1.2 }}>{loc.emoji}</span>
            <span style={{ display: 'block' }}>
              <Text tone="inverse" style={{ display: 'block', fontWeight: 700 }}>{loc.brand}</Text>
              <Text variant="caption" tone="inverse" style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: 0.92 }}>
                <Icon icon={MapPin} size="sm" tone="inverse" />
                {loc.province}
              </Text>
            </span>
          </button>
        ))}
      </div>

      <BottomSheet open={selected != null} onClose={() => setSelected(null)} title={selected?.brand}>
        {selected && (
          <>
            <div style={{ background: selected.gradient, borderRadius: 'var(--radius-card)', padding: 24, textAlign: 'center' }}>
              <span aria-hidden style={{ display: 'block', fontSize: 56, lineHeight: 1.2 }}>{selected.emoji}</span>
              <Text
                variant="body-sm"
                tone="inverse"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 4, opacity: 0.92 }}
              >
                <Icon icon={MapPin} size="sm" tone="inverse" />
                {selected.province} · {selected.ingredient}
              </Text>
            </div>
            <Text as="p" style={{ lineHeight: 1.6, marginTop: 16 }}>
              {selected.story}
            </Text>
            <BrowseButton brand={selected.brand} catalogBrand={selected.catalogBrand} onGo={() => setSelected(null)} />
          </>
        )}
      </BottomSheet>
    </Page>
  );
}

/** Bản đồ Gỗ 3D Đa khối Tỉnh/Thành Việt Nam có đèn LED hắt sáng + 8 Pin Thương hiệu + Hoàng Sa & Trường Sa */
function IngredientMap({ onPick }: { onPick: (loc: BrandOrigin) => void }) {
  return (
    <div style={{ padding: '0 16px' }}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 370,
          margin: '0 auto',
          aspectRatio: '3 / 4.6',
          background: 'var(--color-brandmap-frame-bg)',
          borderRadius: 'var(--radius-sheet)',
          border: '1px solid var(--color-brandmap-frame-border)',
          overflow: 'hidden',
          boxShadow: 'var(--elevation-2)',
        }}
      >
        <svg
          role="img"
          viewBox="0 0 450 700"
          aria-label="Bản đồ Gỗ 3D Việt Nam với đầy đủ tỉnh thành và Hoàng Sa, Trường Sa"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        >
          <defs>
            {/* Đèn LED Vàng hắt sáng phía sau viền Bản đồ Việt Nam */}
            <filter id="led-backlight" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="7" floodColor="var(--color-brandmap-led)" floodOpacity="0.85" />
            </filter>

            {/* Bóng đổ 3D khối gỗ nổi */}
            <filter id="wood-3d" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="2.5" dy="3.5" stdDeviation="2" floodColor="var(--color-brandmap-ink)" floodOpacity="0.45" />
            </filter>
          </defs>

          {/* Đường viền Dạ Quang LED Vàng Hắt Sáng (LED Glow Effect) */}
          <path
            d="
              M 175 35
              C 120 20, 80 40, 70 85
              C 65 110, 85 130, 125 145
              C 105 170, 115 210, 160 230
              C 170 250, 195 280, 240 300
              C 275 330, 290 375, 275 425
              C 250 460, 210 500, 140 560
              C 100 580, 95 620, 125 635
              C 165 650, 220 620, 260 560
              C 290 500, 305 430, 292 375
              C 285 330, 245 285, 220 245
              C 210 215, 215 175, 192 145
              C 230 115, 235 70, 205 45 Z
            "
            fill="none"
            stroke="var(--color-brandmap-led-edge)"
            strokeWidth="10"
            filter="url(#led-backlight)"
            opacity="0.9"
          />

          {/* Quốc kỳ Việt Nam & Chữ nổi VIỆT NAM ở góc trên bên phải */}
          <g id="vietnam-flag" transform="translate(325, 42)">
            <rect x="0" y="0" width="38" height="26" fill="var(--color-brandmap-flag)" rx="2" filter="url(#wood-3d)" />
            <polygon points="19,6 22,14 30,14 23,19 26,26 19,22 12,26 15,19 8,14 16,14" fill="var(--color-brandmap-star)" />
            <text x="19" y="44" fontSize="13" fontWeight="800" fill="var(--color-brandmap-title)" textAnchor="middle" letterSpacing="1.5">
              VIỆT NAM
            </text>
          </g>

          {/* Chữ nghiêng 3D BIỂN ĐÔNG dọc bờ biển */}
          <text
            x="290"
            y="410"
            fontSize="15"
            fontWeight="800"
            fill="var(--color-brandmap-sea)"
            opacity="0.6"
            letterSpacing="3"
            transform="rotate(-55 290 410)"
          >
            BIỂN ĐÔNG
          </text>

          {/* ══════════════════════════════════════════════════════════════ */}
          {/* CÁC MẢNH GHÉP TỈNH / THÀNH GỖ 3D (3D WOODEN PROVINCE PIECES) */}
          {/* ══════════════════════════════════════════════════════════════ */}

          {/* 1. Mảnh Tây Bắc (Lai Châu, Điện Biên, Lào Cai) */}
          <path
            d="M 125 35 L 75 60 L 95 95 L 138 78 Z"
            fill="var(--color-brandmap-wood-700)"
            stroke="var(--color-brandmap-ink)"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="98" y="65" fontSize="7" fontWeight="700" fill="var(--color-brandmap-wood-100)">Lai Châu</text>

          {/* 2. Mảnh Đông Bắc (Hà Giang, Cao Bằng, Lạng Sơn) */}
          <path
            d="M 138 78 L 125 35 L 175 35 L 215 55 L 195 92 Z"
            fill="var(--color-brandmap-wood-400)"
            stroke="var(--color-brandmap-ink)"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="162" y="52" fontSize="7" fontWeight="700" fill="var(--color-text-inverse)">Hà Giang</text>
          <text x="182" y="76" fontSize="7" fontWeight="700" fill="var(--color-text-inverse)">Lạng Sơn</text>

          {/* 3. Mảnh Sơn La & Phú Thọ */}
          <path
            d="M 95 95 L 138 78 L 160 115 L 120 128 Z"
            fill="var(--color-brandmap-wood-300)"
            stroke="var(--color-brandmap-ink)"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="118" y="108" fontSize="7" fontWeight="700" fill="var(--color-brandmap-wood-900)">Sơn La</text>

          {/* 4. Mảnh Hà Nội & ĐB Sông Hồng */}
          <path
            d="M 160 115 L 195 92 L 225 110 L 180 142 Z"
            fill="var(--color-brandmap-wood-tan)"
            stroke="var(--color-brandmap-ink)"
            strokeWidth="1.2"
            filter="url(#wood-3d)"
          />
          <circle cx="185" cy="118" r="2.5" fill="var(--color-brandmap-flag)" />
          <text x="185" y="128" fontSize="8" fontWeight="800" fill="var(--color-brandmap-ink)" textAnchor="middle">Hà Nội</text>

          {/* 5. Mảnh Thanh Hóa */}
          <path
            d="M 120 128 L 180 142 L 165 178 L 125 158 Z"
            fill="var(--color-brandmap-wood-900)"
            stroke="var(--color-brandmap-ink)"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="150" y="152" fontSize="7.5" fontWeight="700" fill="var(--color-brandmap-wood-100)" textAnchor="middle">Thanh Hóa</text>

          {/* 6. Mảnh Nghệ An & Hà Tĩnh */}
          <path
            d="M 125 158 L 165 178 L 192 195 L 145 215 Z"
            fill="var(--color-brandmap-wood-400)"
            stroke="var(--color-brandmap-ink)"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="155" y="186" fontSize="7.5" fontWeight="700" fill="var(--color-text-inverse)" textAnchor="middle">Nghệ An</text>

          {/* 7. Mảnh Quảng Bình & Thừa Thiên Huế */}
          <path
            d="M 145 215 L 192 195 L 215 240 L 175 252 Z"
            fill="var(--color-brandmap-wood-700)"
            stroke="var(--color-brandmap-ink)"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="178" y="234" fontSize="7.5" fontWeight="700" fill="var(--color-brandmap-wood-100)" textAnchor="middle">TP. Huế</text>

          {/* 8. Mảnh Quảng Nam & TP. Đà Nẵng */}
          <path
            d="M 175 252 L 215 240 L 255 275 L 208 290 Z"
            fill="var(--color-brandmap-wood-300)"
            stroke="var(--color-brandmap-ink)"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="218" y="268" fontSize="7.5" fontWeight="700" fill="var(--color-brandmap-ink)" textAnchor="middle">Quảng Nam</text>

          {/* 9. Mảnh Gia Lai & Kon Tum */}
          <path
            d="M 208 290 L 255 275 L 240 338 L 195 320 Z"
            fill="var(--color-brandmap-wood-600)"
            stroke="var(--color-brandmap-ink)"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="222" y="310" fontSize="7.5" fontWeight="700" fill="var(--color-text-inverse)" textAnchor="middle">Gia Lai</text>

          {/* 10. Mảnh Đắk Lắk */}
          <path
            d="M 195 320 L 240 338 L 268 382 L 212 375 Z"
            fill="var(--color-brandmap-wood-400)"
            stroke="var(--color-brandmap-ink)"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="232" y="354" fontSize="8" fontWeight="800" fill="var(--color-text-inverse)" textAnchor="middle">Đắk Lắk</text>

          {/* 11. Mảnh Khánh Hòa (Nha Trang) & Bình Thuận */}
          <path
            d="M 268 382 L 295 370 L 285 435 L 248 420 Z"
            fill="var(--color-brandmap-wood-900)"
            stroke="var(--color-brandmap-ink)"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="272" y="405" fontSize="7" fontWeight="700" fill="var(--color-brandmap-wood-100)" textAnchor="middle">Khánh Hòa</text>

          {/* 12. Mảnh Lâm Đồng (Đà Lạt / Cầu Đất) */}
          <path
            d="M 212 375 L 268 382 L 248 420 L 205 410 Z"
            fill="var(--color-brandmap-wood-800)"
            stroke="var(--color-brandmap-ink)"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="235" y="396" fontSize="7.5" fontWeight="700" fill="var(--color-brandmap-led)" textAnchor="middle">Lâm Đồng</text>

          {/* 13. Mảnh Đông Nam Bộ (Tây Ninh, Đồng Nai, TP.HCM) */}
          <path
            d="M 205 410 L 248 420 L 225 470 L 175 440 Z"
            fill="var(--color-brandmap-wood-700)"
            stroke="var(--color-brandmap-ink)"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="208" y="442" fontSize="8" fontWeight="800" fill="var(--color-text-inverse)" textAnchor="middle">TP.HCM</text>

          {/* 14. Mảnh Bến Tre, Trà Vinh & ĐBSCL */}
          <path
            d="
              M 175 440
              L 225 470
              L 190 535
              L 125 565
              L 95 585
              L 125 635
              L 165 640
              L 215 570
              L 245 500 Z
            "
            fill="var(--color-brandmap-wood-400)"
            stroke="var(--color-brandmap-ink)"
            strokeWidth="1.2"
            filter="url(#wood-3d)"
          />
          <text x="185" y="495" fontSize="7" fontWeight="700" fill="var(--color-text-inverse)" textAnchor="middle">Bến Tre</text>
          <text x="168" y="525" fontSize="7" fontWeight="700" fill="var(--color-text-inverse)" textAnchor="middle">Trà Vinh</text>
          <text x="145" y="555" fontSize="7" fontWeight="700" fill="var(--color-text-inverse)" textAnchor="middle">Cần Thơ</text>
          <text x="135" y="610" fontSize="7.5" fontWeight="800" fill="var(--color-brandmap-led)" textAnchor="middle">Cà Mau</text>

          {/* ══════════════════════════════════════════════════════════════ */}
          {/* 🇻🇳 CỤM QUẦN ĐẢO HÀNG SA & TRƯỜNG SA 3D WOODEN PIECES */}
          {/* ══════════════════════════════════════════════════════════════ */}

          {/* 🇻🇳 Quần đảo Hoàng Sa */}
          <g id="hoang-sa" transform="translate(330, 275)">
            <path d="M 5 18 L 18 4 L 32 14 L 45 6 L 55 22 Z" fill="var(--color-brandmap-wood-400)" stroke="var(--color-brandmap-ink)" strokeWidth="1" filter="url(#wood-3d)" />
            <circle cx="18" cy="12" r="2.5" fill="var(--color-brandmap-flag)" />
            <circle cx="32" cy="10" r="2" fill="var(--color-brandmap-flag)" />
            <rect x="-4" y="26" width="62" height="18" rx="3" fill="var(--color-brandmap-wood-900)" stroke="var(--color-brandmap-led)" strokeWidth="1" filter="url(#wood-3d)" />
            <text x="27" y="38" fontSize="9" fontWeight="800" fill="var(--color-brandmap-led)" textAnchor="middle">
              Hoàng Sa
            </text>
          </g>

          {/* 🇻🇳 Quần đảo Trường Sa */}
          <g id="truong-sa" transform="translate(335, 495)">
            <path d="M 5 22 L 20 6 L 35 16 L 48 8 L 58 24 Z" fill="var(--color-brandmap-wood-400)" stroke="var(--color-brandmap-ink)" strokeWidth="1" filter="url(#wood-3d)" />
            <circle cx="15" cy="14" r="2.5" fill="var(--color-brandmap-flag)" />
            <circle cx="30" cy="11" r="2" fill="var(--color-brandmap-flag)" />
            <circle cx="42" cy="15" r="2" fill="var(--color-brandmap-flag)" />
            <rect x="-4" y="28" width="64" height="18" rx="3" fill="var(--color-brandmap-wood-900)" stroke="var(--color-brandmap-led)" strokeWidth="1" filter="url(#wood-3d)" />
            <text x="28" y="40" fontSize="9" fontWeight="800" fill="var(--color-brandmap-led)" textAnchor="middle">
              Trường Sa
            </text>
          </g>

          {/* 🏝️ Đảo Phú Quốc & Côn Đảo */}
          <g id="phu-quoc" transform="translate(48, 565)">
            <ellipse cx="16" cy="14" rx="10" ry="16" fill="var(--color-brandmap-wood-600)" stroke="var(--color-brandmap-ink)" strokeWidth="1" filter="url(#wood-3d)" />
            <rect x="-8" y="32" width="48" height="16" rx="3" fill="var(--color-brandmap-wood-900)" stroke="var(--color-brandmap-wood-100)" strokeWidth="0.8" />
            <text x="16" y="43" fontSize="8" fontWeight="700" fill="var(--color-text-inverse)" textAnchor="middle">
              Phú Quốc
            </text>
          </g>
        </svg>

        {/* 8 ghim thương hiệu nổi trên bản đồ. Chỉ là lối tắt bằng hình trùng với 8 ô lưới bên dưới (cùng mở sheet), nên
            ẩn khỏi trình đọc màn hình và thứ tự Tab: ở cụm Lâm Đồng/Mekong các hộp 44px chồng lên nhau không thể tách
            (axe target-size, WCAG 2.5.8), còn chức năng vẫn đủ qua các ô lưới, là nút thật cao ≥135px. Chạm vẫn dùng được. */}
        {BRAND_ORIGINS.map((loc) => (
          <button
            key={loc.id}
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            data-testid={`brand-pin-${loc.id}`}
            className="tubu-press"
            onClick={() => onPick(loc)}
            style={{
              position: 'absolute',
              top: loc.pin.top,
              left: loc.pin.left,
              transform: 'translate(-50%, -50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              zIndex: 4,
              minWidth: 44,
              minHeight: 44,
              padding: 0,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <span
              aria-hidden
              className="tubu-pulse"
              style={{
                width: PIN_CIRCLE,
                height: PIN_CIRCLE,
                borderRadius: '50%',
                background: loc.gradient,
                display: 'grid',
                placeItems: 'center',
                fontSize: 15,
                boxShadow: 'var(--elevation-2)',
                border: '2px solid var(--color-bg-surface)',
              }}
            >
              {loc.emoji}
            </span>
            <Text
              variant="caption"
              style={{
                background: 'var(--color-brandmap-wood-900)',
                color: 'var(--color-brandmap-led)',
                padding: '2px 7px',
                borderRadius: 'var(--radius-pill)',
                fontSize: 9.5,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                boxShadow: 'var(--elevation-1)',
                border: '1px solid var(--color-brandmap-wood-400)',
                // Nhãn lệch sang bên để cụm ghim Lâm Đồng/Mekong không đè nhau (vị trí kiểm ở brand-origins.spec.ts).
                ...(loc.labelSide && {
                  position: 'absolute',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  ...(loc.labelSide === 'left' ? { right: `calc(50% + ${PIN_CIRCLE / 2 + PIN_GAP}px)` } : { left: `calc(50% + ${PIN_CIRCLE / 2 + PIN_GAP}px)` }),
                }),
              }}
            >
              {loc.brand}
            </Text>
          </button>
        ))}
      </div>
    </div>
  );
}

function BrowseButton({ brand, catalogBrand, onGo }: { brand: string; catalogBrand: string; onGo: () => void }) {
  const navigate = useNavigate();
  if (!brand) return null;
  return (
    <Button
      fullWidth
      onPress={() => {
        onGo();
        navigate(brandBrowsePath(catalogBrand));
      }}
      style={{ marginTop: 16 }}
    >
      Khám phá sản phẩm {brand}
    </Button>
  );
}
