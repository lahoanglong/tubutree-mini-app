import { useState } from 'react';
import { Box, Page, Text, Sheet, Button, useNavigate } from 'zmp-ui';
import { haptic } from '../utils/haptic';

interface Region {
  id: string;
  name: string;
  area: string;
  emoji: string;
  gradient: string;
  ingredient: string;
  brands: string[];
  story: string;
  /** Vị trí pin trên bản đồ (% so với khung bản đồ). */
  pin: { top: string; left: string };
}

const REGIONS: Region[] = [
  {
    id: 'taybac',
    name: 'Tây Bắc',
    area: 'Hà Giang · Lào Cai',
    emoji: '⛰️',
    gradient: 'linear-gradient(135deg,#7fae5a,#3c6d12)',
    ingredient: 'Thảo dược núi rừng',
    brands: ['Pơ Lang'],
    story: 'Giữa mây ngàn Tây Bắc, bà con người Dao thu hái thảo dược theo mùa — gừng gió, sả chanh, ngải cứu — phơi nắng tự nhiên, giữ trọn tinh dầu cho dòng dầu gội thảo mộc.',
    pin: { top: '9%', left: '40%' },
  },
  {
    id: 'taynguyen',
    name: 'Tây Nguyên',
    area: 'Đắk Lắk · Gia Lai',
    emoji: '🌋',
    gradient: 'linear-gradient(135deg,#e0a64f,#b86a10)',
    ingredient: 'Bơ ca cao & cà phê',
    brands: ['Pơ Lang'],
    story: 'Đất bazan đỏ Tây Nguyên nuôi những vườn ca cao và cà phê. Bơ ca cao ép lạnh trở thành dưỡng chất khóa ẩm cho làn da, thay cho dầu khoáng công nghiệp.',
    pin: { top: '56%', left: '62%' },
  },
  {
    id: 'bentre',
    name: 'Bến Tre',
    area: 'Xứ Dừa',
    emoji: '🥥',
    gradient: 'linear-gradient(135deg,#5fa376,#235f3d)',
    ingredient: 'Dừa hữu cơ',
    brands: ['Fuwa3e'],
    story: 'Vương quốc dừa Bến Tre cho dầu dừa ép lạnh và enzyme lên men tự nhiên — nền tảng cho nước rửa chén sinh học Fuwa3e, an toàn cho da tay và dòng nước.',
    pin: { top: '83%', left: '52%' },
  },
  {
    id: 'dalat',
    name: 'Đà Lạt',
    area: 'Lâm Đồng',
    emoji: '🌸',
    gradient: 'linear-gradient(135deg,#c97b4a,#8c4f2a)',
    ingredient: 'Hoa & tinh dầu',
    brands: ['Visante'],
    story: 'Khí hậu ôn hòa Đà Lạt là quê hương của hoa hồng, oải hương và trà xanh — chưng cất thành nước hoa hồng và tinh dầu dịu nhẹ cho da nhạy cảm.',
    pin: { top: '68%', left: '66%' },
  },
  {
    id: 'mekong',
    name: 'ĐBSCL',
    area: 'Đồng Tháp · An Giang',
    emoji: '🌾',
    gradient: 'linear-gradient(135deg,#95d222,#3c6d12)',
    ingredient: 'Sả & bồ hòn',
    brands: ['Fuwa3e'],
    story: 'Miền Tây sông nước cho cây sả và trái bồ hòn — chất tẩy rửa tự nhiên ngàn đời của ông bà, nay thành nước lau sàn hương sả thanh khiết.',
    pin: { top: '86%', left: '38%' },
  },
  {
    id: 'phuquoc',
    name: 'Phú Quốc',
    area: 'Kiên Giang',
    emoji: '🌊',
    gradient: 'linear-gradient(135deg,#3d7bb8,#235f3d)',
    ingredient: 'Rong biển & muối',
    brands: ['Visante'],
    story: 'Biển Phú Quốc cho rong biển giàu khoáng và muối tinh khiết — thành phần tẩy tế bào chết dịu nhẹ, trả lại làn da mịn màng theo cách của thiên nhiên.',
    pin: { top: '90%', left: '20%' },
  },
];

export default function BrandStoryPage() {
  const [selected, setSelected] = useState<Region | null>(null);

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>

      <Box p={4} pb={2}>
        <Text style={{ color: 'var(--neutral-600)' }}>
          Mỗi sản phẩm Tubu Tree bắt đầu từ một vùng đất. Chạm điểm trên bản đồ để nghe câu chuyện 🌿
        </Text>
      </Box>

      {/* Bản đồ nguyên liệu — VN cách điệu, 6 điểm chạm (design §6.7.7 / §7.14.2) */}
      <IngredientMap
        onPick={(r) => {
          haptic('light');
          setSelected(r);
        }}
      />

      <Box px={4} pt={2} pb={1}>
        <Text size="small" bold style={{ color: 'var(--neutral-600)' }}>
          Tất cả vùng nguyên liệu
        </Text>
      </Box>

      <Box px={4} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, paddingBottom: 24 }}>
        {REGIONS.map((r) => (
          <Box
            key={r.id}
            className="tubu-press"
            onClick={() => {
              haptic('light');
              setSelected(r);
            }}
            style={{
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              boxShadow: 'var(--shadow-sm)',
              minHeight: 130,
              background: r.gradient,
              color: '#fff',
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ fontSize: 34 }}>{r.emoji}</Text>
            <Box>
              <Text bold style={{ color: '#fff' }}>
                {r.name}
              </Text>
              <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.85)' }}>
                {r.ingredient}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>

      <Sheet visible={selected != null} onClose={() => setSelected(null)} autoHeight>
        {selected && (
          <Box style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
            <Box style={{ background: selected.gradient, padding: 24, color: '#fff', textAlign: 'center' }}>
              <Text style={{ fontSize: 56 }}>{selected.emoji}</Text>
              <Text bold size="xLarge" style={{ color: '#fff', marginTop: 4 }}>
                {selected.name}
              </Text>
              <Text size="small" style={{ color: 'rgba(255,255,255,0.9)' }}>
                {selected.area} · {selected.ingredient}
              </Text>
            </Box>
            <Box p={4}>
              <Text style={{ color: 'var(--neutral-700, var(--neutral-900))', lineHeight: 1.6 }}>
                {selected.story}
              </Text>
              <Box flex style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                {selected.brands.map((b) => (
                  <Text
                    key={b}
                    size="xSmall"
                    bold
                    style={{ background: 'var(--leaf-50)', color: 'var(--leaf-700)', padding: '3px 10px', borderRadius: 'var(--radius-full)' }}
                  >
                    {b}
                  </Text>
                ))}
              </Box>
              <BrowseButton brand={selected.brands[0]} onGo={() => setSelected(null)} />
            </Box>
          </Box>
        )}
      </Sheet>
    </Page>
  );
}

/** Bản đồ Việt Nam cách điệu + 6 pin vùng nguyên liệu (lightweight, không cần lib map). */
function IngredientMap({ onPick }: { onPick: (r: Region) => void }) {
  return (
    <Box px={4}>
      <Box
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 320,
          margin: '0 auto',
          aspectRatio: '3 / 4',
          background: 'linear-gradient(160deg, #eaf5dd, #f3f9ec)',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--leaf-100)',
          overflow: 'hidden',
        }}
      >
        {/* Dải đất VN cách điệu (S-curve), tông lá */}
        <svg
          viewBox="0 0 100 150"
          aria-hidden
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        >
          <path
            d="M52 8 C46 22 45 33 50 45 C55 57 60 64 57 77 C55 90 47 97 45 110 C43 122 39 130 35 140 C33 146 27 148 24 145 C30 139 31 131 33 122 C35 110 41 103 43 90 C45 77 50 70 47 58 C44 44 43 32 47 20 C49 13 50 10 52 8 Z"
            fill="rgba(80,144,24,0.18)"
            stroke="var(--leaf-400)"
            strokeWidth="1.2"
          />
        </svg>

        {REGIONS.map((r) => (
          <Box
            key={r.id}
            role="button"
            aria-label={`${r.name} — ${r.ingredient}`}
            className="tubu-press"
            onClick={() => onPick(r)}
            style={{
              position: 'absolute',
              top: r.pin.top,
              left: r.pin.left,
              transform: 'translate(-50%, -50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <Box
              className="tubu-pulse"
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: r.gradient,
                display: 'grid',
                placeItems: 'center',
                fontSize: 16,
                boxShadow: 'var(--shadow-sm)',
                border: '2px solid #fff',
              }}
            >
              {r.emoji}
            </Box>
            <Text
              size="xSmall"
              bold
              style={{
                background: 'rgba(255,255,255,0.9)',
                color: 'var(--leaf-700)',
                padding: '0 5px',
                borderRadius: 'var(--radius-full)',
                fontSize: 9.5,
                whiteSpace: 'nowrap',
              }}
            >
              {r.name}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function BrowseButton({ brand, onGo }: { brand?: string; onGo: () => void }) {
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
      Xem sản phẩm {brand}
    </Button>
  );
}
