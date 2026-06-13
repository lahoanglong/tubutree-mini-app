import { useState } from 'react';
import { Box, Page, Text, Header, Sheet, Button, useNavigate } from 'zmp-ui';
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
  },
];

export default function BrandStoryPage() {
  const [selected, setSelected] = useState<Region | null>(null);

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
      <Header title="Hành trình nguyên liệu" />

      <Box p={4}>
        <Text style={{ color: 'var(--neutral-600)' }}>
          Mỗi sản phẩm Tubu Tree bắt đầu từ một vùng đất. Chạm để nghe câu chuyện 🌿
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
