import { useState } from 'react';
import { Box, Page, Text, Sheet, Button, useNavigate } from 'zmp-ui';
import { haptic } from '../utils/haptic';

interface BrandLocation {
  id: string;
  brand: string;
  province: string;
  emoji: string;
  color: string;
  gradient: string;
  ingredient: string;
  story: string;
  /** Vị trí pin trên bản đồ (% so với khung bản đồ). */
  pin: { top: string; left: string };
}

const BRAND_LOCATIONS: BrandLocation[] = [
  {
    id: 'fuwa3e',
    brand: 'Fuwa3e',
    province: 'Thanh Hóa',
    emoji: '🍍',
    color: '#E8B72C',
    gradient: 'linear-gradient(135deg, #fbc02d, #f57f17)',
    ingredient: 'Enzyme vỏ dứa & bồ hòn',
    story: 'Fuwa3e tận dụng nguồn vỏ dứa hữu cơ Thanh Hóa lên men sinh học cùng quả bồ hòn, làm nên dòng sản phẩm nước rửa chén, nước giặt lành tính cho cả gia đình và dòng nước.',
    pin: { top: '30%', left: '44%' },
  },
  {
    id: 'bhnong',
    brand: 'BH.Nong',
    province: 'Quảng Nam',
    emoji: '🍯',
    color: '#7A5C3A',
    gradient: 'linear-gradient(135deg, #8d6e63, #4e342e)',
    ingredient: 'Mật ong rừng & trà thảo mộc',
    story: 'BH.Nong sinh ra từ núi rừng Quảng Nam, mang đến mật ong rừng nguyên chất và các dòng trà thảo mộc thanh nhiệt đậm vị thiên nhiên.',
    pin: { top: '48%', left: '62%' },
  },
  {
    id: 'polang',
    brand: 'Pơ Lang',
    province: 'Đắc Lắk',
    emoji: '🥑',
    color: '#D4843E',
    gradient: 'linear-gradient(135deg, #fb8c00, #ef6c00)',
    ingredient: 'Bơ ca cao & dầu gừng bazan',
    story: 'Pơ Lang khai thác nông sản bazan Đắk Lắk — bơ ca cao ép lạnh, dầu gừng, bồ kết — làm nên sản phẩm chăm sóc da và tóc thuần thực vật.',
    pin: { top: '61%', left: '55%' },
  },
  {
    id: 'visante',
    brand: 'Visante',
    province: 'Khánh Hòa (Nha Trang)',
    emoji: '🌊',
    color: '#8B3A3A',
    gradient: 'linear-gradient(135deg, #26c6da, #00838f)',
    ingredient: 'Muối khoáng & rong biển',
    story: 'Visante tận dụng tinh chất muối khoáng & rong biển Nha Trang (Khánh Hòa) phục hồi dịu nhẹ cho làn da nhạy cảm.',
    pin: { top: '67%', left: '68%' },
  },
  {
    id: 'hector',
    brand: 'Hector',
    province: 'Lâm Đồng',
    emoji: '🍄',
    color: '#6B6B6B',
    gradient: 'linear-gradient(135deg, #78909c, #37474f)',
    ingredient: 'Đông trùng hạ thảo',
    story: 'Hector nghiên cứu và nuôi trồng đông trùng hạ thảo tại khí hậu ôn hòa Lâm Đồng, cung cấp dòng nước uống bổ dưỡng và chăm sóc sức khỏe toàn diện.',
    pin: { top: '73%', left: '58%' },
  },
  {
    id: 'leplateau',
    brand: 'Le Plateau',
    province: 'Lâm Đồng (Cầu Đất)',
    emoji: '☕',
    color: '#4A2C20',
    gradient: 'linear-gradient(135deg, #6d4c41, #3e2723)',
    ingredient: 'Cà phê đặc sản Cầu Đất',
    story: 'Le Plateau Coffee tuyển chọn từng hạt cà phê Arabica Cầu Đất & Robusta Honey chưng cất hương vị đậm đà từ vùng cao nguyên mây phủ.',
    pin: { top: '77%', left: '51%' },
  },
  {
    id: 'cobote',
    brand: 'Cobote',
    province: 'Bến Tre',
    emoji: '🥥',
    color: '#C9B280',
    gradient: 'linear-gradient(135deg, #a1887f, #5d4037)',
    ingredient: 'Dầu dừa hữu cơ Bến Tre',
    story: 'Cobote tận dụng vương quốc dừa Bến Tre cho dòng dầu dừa ép lạnh và sản phẩm dưỡng da, dưỡng tóc lành tính cho mẹ và bé.',
    pin: { top: '83%', left: '46%' },
  },
  {
    id: 'sokfarm',
    brand: 'Sokfarm',
    province: 'Trà Vinh',
    emoji: '🌴',
    color: '#DCA84A',
    gradient: 'linear-gradient(135deg, #42a5f5, #1565c0)',
    ingredient: 'Mật hoa dừa hữu cơ',
    story: 'Sokfarm Trà Vinh tiên phong thu hoạch mật hoa dừa thủ công từ hoa dừa, cô đặc thành mật hoa dừa chỉ số đường huyết thấp, giàu khoáng chất.',
    pin: { top: '86%', left: '40%' },
  },
];

export default function BrandStoryPage() {
  const [selected, setSelected] = useState<BrandLocation | null>(null);

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 32 }}>
      <Box p={4} pb={2}>
        <Text style={{ color: 'var(--neutral-700)', lineHeight: 1.5 }}>
          Mỗi thương hiệu Tubu Tree đều gắn liền với một tỉnh thành Việt Nam. Chạm mốc trên bản đồ gỗ 3D để khám phá xuất xứ 🌿
        </Text>
      </Box>

      {/* Bản đồ Gỗ 3D Đa khối Tỉnh thành Việt Nam có đèn LED hắt sáng + Hoàng Sa & Trường Sa */}
      <IngredientMap
        onPick={(loc) => {
          haptic('light');
          setSelected(loc);
        }}
      />

      <Box px={4} pt={4} pb={2}>
        <Text size="small" bold style={{ color: 'var(--neutral-700)' }}>
          8 Thương hiệu & Tỉnh thành xuất xứ
        </Text>
      </Box>

      <Box px={4} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, paddingBottom: 24 }}>
        {BRAND_LOCATIONS.map((loc) => (
          <Box
            key={loc.id}
            className="tubu-press"
            onClick={() => {
              haptic('light');
              setSelected(loc);
            }}
            style={{
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              boxShadow: 'var(--shadow-sm)',
              minHeight: 135,
              background: loc.gradient,
              color: 'var(--neutral-0)',
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ fontSize: 34 }}>{loc.emoji}</Text>
            <Box>
              <Text bold style={{ color: 'var(--neutral-0)' }}>
                {loc.brand}
              </Text>
              <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.92)' }}>
                📍 {loc.province}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>

      <Sheet visible={selected != null} onClose={() => setSelected(null)} autoHeight>
        {selected && (
          <Box style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
            <Box style={{ background: selected.gradient, padding: 24, color: 'var(--neutral-0)', textAlign: 'center' }}>
              <Text style={{ fontSize: 56 }}>{selected.emoji}</Text>
              <Text bold size="xLarge" style={{ color: 'var(--neutral-0)', marginTop: 4 }}>
                {selected.brand}
              </Text>
              <Text size="small" style={{ color: 'rgba(255,255,255,0.92)' }}>
                📍 {selected.province} · {selected.ingredient}
              </Text>
            </Box>
            <Box p={4}>
              <Text style={{ color: 'var(--neutral-800)', lineHeight: 1.6 }}>
                {selected.story}
              </Text>
              <BrowseButton brand={selected.brand} onGo={() => setSelected(null)} />
            </Box>
          </Box>
        )}
      </Sheet>
    </Page>
  );
}

/** Bản đồ Gỗ 3D Đa khối Tỉnh/Thành Việt Nam có đèn LED hắt sáng + 8 Pin Thương hiệu + Hoàng Sa & Trường Sa */
function IngredientMap({ onPick }: { onPick: (loc: BrandLocation) => void }) {
  return (
    <Box px={4}>
      <Box
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 370,
          margin: '0 auto',
          aspectRatio: '3 / 4.6',
          background: 'var(--neutral-200)',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid #d4ceb8',
          overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
        }}
      >
        <svg
          viewBox="0 0 450 700"
          aria-label="Bản đồ Gỗ 3D Việt Nam với đầy đủ tỉnh thành và Hoàng Sa, Trường Sa"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        >
          <defs>
            {/* Đèn LED Vàng hắt sáng phía sau viền Bản đồ Việt Nam */}
            <filter id="led-backlight" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="7" floodColor="#ffd54f" floodOpacity="0.85" />
            </filter>

            {/* Bóng đổ 3D khối gỗ nổi */}
            <filter id="wood-3d" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="2.5" dy="3.5" stdDeviation="2" floodColor="#211003" floodOpacity="0.45" />
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
            stroke="#ffca28"
            strokeWidth="10"
            filter="url(#led-backlight)"
            opacity="0.9"
          />

          {/* Quốc kỳ Việt Nam & Chữ nổi VIỆT NAM ở góc trên bên phải */}
          <g id="vietnam-flag" transform="translate(325, 42)">
            <rect x="0" y="0" width="38" height="26" fill="#da251d" rx="2" filter="url(#wood-3d)" />
            <polygon points="19,6 22,14 30,14 23,19 26,26 19,22 12,26 15,19 8,14 16,14" fill="#ffff00" />
            <text x="19" y="44" fontSize="13" fontWeight="800" fill="#4a2c20" textAnchor="middle" letterSpacing="1.5">
              VIỆT NAM
            </text>
          </g>

          {/* Chữ nghiêng 3D BIỂN ĐÔNG dọc bờ biển */}
          <text
            x="290"
            y="410"
            fontSize="15"
            fontWeight="800"
            fill="#7a5c3a"
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
            fill="#5d4037"
            stroke="#211003"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="98" y="65" fontSize="7" fontWeight="700" fill="#d7ccc8">Lai Châu</text>

          {/* 2. Mảnh Đông Bắc (Hà Giang, Cao Bằng, Lạng Sơn) */}
          <path
            d="M 138 78 L 125 35 L 175 35 L 215 55 L 195 92 Z"
            fill="#8d6e63"
            stroke="#211003"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="162" y="52" fontSize="7" fontWeight="700" fill="#ffffff">Hà Giang</text>
          <text x="182" y="76" fontSize="7" fontWeight="700" fill="#ffffff">Lạng Sơn</text>

          {/* 3. Mảnh Sơn La & Phú Thọ */}
          <path
            d="M 95 95 L 138 78 L 160 115 L 120 128 Z"
            fill="#a1887f"
            stroke="#211003"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="118" y="108" fontSize="7" fontWeight="700" fill="#3e2723">Sơn La</text>

          {/* 4. Mảnh Hà Nội & ĐB Sông Hồng */}
          <path
            d="M 160 115 L 195 92 L 225 110 L 180 142 Z"
            fill="#c19a6b"
            stroke="#211003"
            strokeWidth="1.2"
            filter="url(#wood-3d)"
          />
          <circle cx="185" cy="118" r="2.5" fill="#da251d" />
          <text x="185" y="128" fontSize="8" fontWeight="800" fill="#211003" textAnchor="middle">Hà Nội</text>

          {/* 5. Mảnh Thanh Hóa */}
          <path
            d="M 120 128 L 180 142 L 165 178 L 125 158 Z"
            fill="#3e2723"
            stroke="#211003"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="150" y="152" fontSize="7.5" fontWeight="700" fill="#d7ccc8" textAnchor="middle">Thanh Hóa</text>

          {/* 6. Mảnh Nghệ An & Hà Tĩnh */}
          <path
            d="M 125 158 L 165 178 L 192 195 L 145 215 Z"
            fill="#8d6e63"
            stroke="#211003"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="155" y="186" fontSize="7.5" fontWeight="700" fill="#ffffff" textAnchor="middle">Nghệ An</text>

          {/* 7. Mảnh Quảng Bình & Thừa Thiên Huế */}
          <path
            d="M 145 215 L 192 195 L 215 240 L 175 252 Z"
            fill="#5d4037"
            stroke="#211003"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="178" y="234" fontSize="7.5" fontWeight="700" fill="#d7ccc8" textAnchor="middle">TP. Huế</text>

          {/* 8. Mảnh Quảng Nam & TP. Đà Nẵng */}
          <path
            d="M 175 252 L 215 240 L 255 275 L 208 290 Z"
            fill="#a1887f"
            stroke="#211003"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="218" y="268" fontSize="7.5" fontWeight="700" fill="#211003" textAnchor="middle">Quảng Nam</text>

          {/* 9. Mảnh Gia Lai & Kon Tum */}
          <path
            d="M 208 290 L 255 275 L 240 338 L 195 320 Z"
            fill="#6d4c41"
            stroke="#211003"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="222" y="310" fontSize="7.5" fontWeight="700" fill="#ffffff" textAnchor="middle">Gia Lai</text>

          {/* 10. Mảnh Đắk Lắk */}
          <path
            d="M 195 320 L 240 338 L 268 382 L 212 375 Z"
            fill="#8d6e63"
            stroke="#211003"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="232" y="354" fontSize="8" fontWeight="800" fill="#ffffff" textAnchor="middle">Đắk Lắk</text>

          {/* 11. Mảnh Khánh Hòa (Nha Trang) & Bình Thuận */}
          <path
            d="M 268 382 L 295 370 L 285 435 L 248 420 Z"
            fill="#3e2723"
            stroke="#211003"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="272" y="405" fontSize="7" fontWeight="700" fill="#d7ccc8" textAnchor="middle">Khánh Hòa</text>

          {/* 12. Mảnh Lâm Đồng (Đà Lạt / Cầu Đất) */}
          <path
            d="M 212 375 L 268 382 L 248 420 L 205 410 Z"
            fill="#4e342e"
            stroke="#211003"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="235" y="396" fontSize="7.5" fontWeight="700" fill="#ffd54f" textAnchor="middle">Lâm Đồng</text>

          {/* 13. Mảnh Đông Nam Bộ (Tây Ninh, Đồng Nai, TP.HCM) */}
          <path
            d="M 205 410 L 248 420 L 225 470 L 175 440 Z"
            fill="#5d4037"
            stroke="#211003"
            strokeWidth="1"
            filter="url(#wood-3d)"
          />
          <text x="208" y="442" fontSize="8" fontWeight="800" fill="#ffffff" textAnchor="middle">TP.HCM</text>

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
            fill="#8d6e63"
            stroke="#211003"
            strokeWidth="1.2"
            filter="url(#wood-3d)"
          />
          <text x="185" y="495" fontSize="7" fontWeight="700" fill="#ffffff" textAnchor="middle">Bến Tre</text>
          <text x="168" y="525" fontSize="7" fontWeight="700" fill="#ffffff" textAnchor="middle">Trà Vinh</text>
          <text x="145" y="555" fontSize="7" fontWeight="700" fill="#ffffff" textAnchor="middle">Cần Thơ</text>
          <text x="135" y="610" fontSize="7.5" fontWeight="800" fill="#ffd54f" textAnchor="middle">Cà Mau</text>

          {/* ══════════════════════════════════════════════════════════════ */}
          {/* 🇻🇳 CỤM QUẦN ĐẢO HÀNG SA & TRƯỜNG SA 3D WOODEN PIECES */}
          {/* ══════════════════════════════════════════════════════════════ */}

          {/* 🇻🇳 Quần đảo Hoàng Sa */}
          <g id="hoang-sa" transform="translate(330, 275)">
            <path d="M 5 18 L 18 4 L 32 14 L 45 6 L 55 22 Z" fill="#8d6e63" stroke="#211003" strokeWidth="1" filter="url(#wood-3d)" />
            <circle cx="18" cy="12" r="2.5" fill="#da251d" />
            <circle cx="32" cy="10" r="2" fill="#da251d" />
            <rect x="-4" y="26" width="62" height="18" rx="3" fill="#3e2723" stroke="#ffd54f" strokeWidth="1" filter="url(#wood-3d)" />
            <text x="27" y="38" fontSize="9" fontWeight="800" fill="#ffd54f" textAnchor="middle">
              Hoàng Sa
            </text>
          </g>

          {/* 🇻🇳 Quần đảo Trường Sa */}
          <g id="truong-sa" transform="translate(335, 495)">
            <path d="M 5 22 L 20 6 L 35 16 L 48 8 L 58 24 Z" fill="#8d6e63" stroke="#211003" strokeWidth="1" filter="url(#wood-3d)" />
            <circle cx="15" cy="14" r="2.5" fill="#da251d" />
            <circle cx="30" cy="11" r="2" fill="#da251d" />
            <circle cx="42" cy="15" r="2" fill="#da251d" />
            <rect x="-4" y="28" width="64" height="18" rx="3" fill="#3e2723" stroke="#ffd54f" strokeWidth="1" filter="url(#wood-3d)" />
            <text x="28" y="40" fontSize="9" fontWeight="800" fill="#ffd54f" textAnchor="middle">
              Trường Sa
            </text>
          </g>

          {/* 🏝️ Đảo Phú Quốc & Côn Đảo */}
          <g id="phu-quoc" transform="translate(48, 565)">
            <ellipse cx="16" cy="14" rx="10" ry="16" fill="#6d4c41" stroke="#211003" strokeWidth="1" filter="url(#wood-3d)" />
            <rect x="-8" y="32" width="48" height="16" rx="3" fill="#3e2723" stroke="#d7ccc8" strokeWidth="0.8" />
            <text x="16" y="43" fontSize="8" fontWeight="700" fill="#ffffff" textAnchor="middle">
              Phú Quốc
            </text>
          </g>
        </svg>

        {/* 8 Interactive Floating Sleek Brand Pins Overlaid on the 3D Map */}
        {BRAND_LOCATIONS.map((loc) => (
          <Box
            key={loc.id}
            role="button"
            aria-label={`${loc.brand} — ${loc.province}`}
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
            }}
          >
            <Box
              className="tubu-pulse"
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: loc.gradient,
                display: 'grid',
                placeItems: 'center',
                fontSize: 15,
                boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                border: '2px solid var(--neutral-0)',
              }}
            >
              {loc.emoji}
            </Box>
            <Text
              size="xSmall"
              bold
              style={{
                background: '#3e2723',
                color: '#ffd54f',
                padding: '2px 7px',
                borderRadius: 'var(--radius-full)',
                fontSize: 9.5,
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                border: '1px solid #8d6e63',
              }}
            >
              {loc.brand}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function BrowseButton({ brand, onGo }: { brand: string; onGo: () => void }) {
  const navigate = useNavigate();
  if (!brand) return null;
  return (
    <Button
      fullWidth
      onClick={() => {
        onGo();
        navigate(`/browse?brand=${encodeURIComponent(brand)}`);
      }}
      style={{ marginTop: 16, background: 'var(--leaf-600)' }}
    >
      Khám phá sản phẩm {brand}
    </Button>
  );
}
