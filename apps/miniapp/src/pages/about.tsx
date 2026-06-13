import { useState } from 'react';
import { Box, Page, Text, Header, Button, useSnackbar } from 'zmp-ui';
import { useAuthStore } from '../store/auth';
import { haptic } from '../utils/haptic';

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Tubu Tree bán những gì?',
    a: 'Tubu Tree tuyển chọn sản phẩm sống xanh từ nhiều thương hiệu Việt: mỹ phẩm thiên nhiên, tẩy rửa sinh học, đồ cho mẹ & bé — ưu tiên thành phần lành tính, bao bì thân thiện môi trường.',
  },
  {
    q: 'Điểm Xanh là gì và dùng thế nào?',
    a: '10.000đ chi tiêu trên đơn đã giao = 1 Điểm Xanh. 1 Điểm Xanh đổi 1.000đ khi thanh toán, tối đa 20% giá trị đơn. Điểm có hạn 12 tháng.',
  },
  {
    q: 'Phí vận chuyển tính ra sao?',
    a: 'Đơn dưới 200.000đ phí ship 19.000đ; đơn từ 200.000đ được miễn phí. Hạng Lộc Biếc trở lên được freeship từ ngưỡng thấp hơn.',
  },
  {
    q: 'Chính sách đổi/trả thế nào?',
    a: 'Chỉ đổi/trả khi sản phẩm bị lỗi nhà sản xuất (hỏng bao bì, sai HSD, sai mã, không đúng mô tả) trong vòng 7 ngày từ khi nhận. Tubu chịu phí ship 2 chiều.',
  },
  {
    q: 'Vườn Xanh và trồng cây thật là gì?',
    a: 'Chăm cây ảo mỗi ngày (điểm danh, tưới nước, quiz) để cây lớn lên. Khi thu hoạch, Tubu góp 1 cây thật vào dự án "Rừng Xanh Lên" cùng PanNature.',
  },
];

export default function AboutPage() {
  const { openSnackbar } = useSnackbar();
  const { logout } = useAuthStore();
  const [open, setOpen] = useState<number | null>(0);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
      <Header title="Về Tubu Tree & Hỗ trợ" />

      {/* Brand story */}
      <Box p={4}>
        <Box
          p={5}
          style={{
            background: 'linear-gradient(135deg, var(--leaf-600), var(--leaf-700))',
            borderRadius: 'var(--radius-xl)',
            color: '#fff',
          }}
        >
          <Text style={{ fontSize: 40 }}>🌳</Text>
          <Text bold size="xLarge" style={{ color: '#fff', marginTop: 4 }}>
            Sống Xanh An Lành
          </Text>
          <Text size="small" style={{ color: 'rgba(255,255,255,0.9)', marginTop: 8 }}>
            Tubu Tree tin rằng mỗi lựa chọn tiêu dùng nhỏ đều là một hạt mầm cho thiên nhiên. Chúng
            tôi kết nối bạn với những thương hiệu Việt tử tế — minh bạch nguồn gốc, lành cho da, nhẹ
            với đất.
          </Text>
        </Box>
      </Box>

      {/* FAQ */}
      <Section title="Câu hỏi thường gặp">
        {FAQ.map((item, i) => (
          <Box key={i} style={{ borderBottom: i < FAQ.length - 1 ? '1px solid var(--neutral-100)' : 'none' }}>
            <Box
              className="tubu-press"
              flex
              alignItems="center"
              justifyContent="space-between"
              py={3}
              onClick={() => {
                haptic('light');
                setOpen(open === i ? null : i);
              }}
              style={{ gap: 8 }}
            >
              <Text size="small" bold style={{ flex: 1 }}>
                {item.q}
              </Text>
              <Text style={{ color: 'var(--neutral-400)', transform: open === i ? 'rotate(180deg)' : 'none' }}>
                ⌄
              </Text>
            </Box>
            {open === i && (
              <Text size="small" style={{ color: 'var(--neutral-600)', paddingBottom: 12 }}>
                {item.a}
              </Text>
            )}
          </Box>
        ))}
      </Section>

      {/* Hỗ trợ */}
      <Section title="Hỗ trợ khách hàng">
        <Row label="Hotline" value="1900 1234 (8h–21h)" />
        <Row label="Zalo OA" value="Tubu Tree Official" />
        <Row label="Email" value="hotro@tubutree.com" />
      </Section>

      {/* Pháp lý */}
      <Section title="Điều khoản & Chính sách">
        <LinkRow label="Điều khoản sử dụng" onClick={() => openSnackbar({ text: 'Mở tại tubutree.com/dieu-khoan', type: 'info' })} />
        <LinkRow label="Chính sách bảo mật" onClick={() => openSnackbar({ text: 'Mở tại tubutree.com/bao-mat', type: 'info' })} />
        <LinkRow label="Chính sách đổi trả" onClick={() => openSnackbar({ text: 'Mở tại tubutree.com/doi-tra', type: 'info' })} />
      </Section>

      {/* Xóa tài khoản */}
      <Box mx={4} mb={3}>
        {!confirmDelete ? (
          <Text
            size="small"
            onClick={() => setConfirmDelete(true)}
            style={{ color: 'var(--danger)', textAlign: 'center', display: 'block', padding: '8px 0' }}
          >
            Xóa tài khoản
          </Text>
        ) : (
          <Box p={4} style={{ background: '#fbe9e9', borderRadius: 'var(--radius-lg)' }}>
            <Text size="small" bold style={{ color: 'var(--danger)' }}>
              Xóa tài khoản vĩnh viễn?
            </Text>
            <Text size="xSmall" style={{ color: 'var(--neutral-600)', marginTop: 4 }}>
              Toàn bộ điểm, ví, lịch sử đơn sẽ bị xóa và không khôi phục được. Vui lòng liên hệ hotline
              để hoàn tất yêu cầu xóa theo quy định.
            </Text>
            <Box flex style={{ gap: 8, marginTop: 12 }}>
              <Button size="small" variant="secondary" onClick={() => setConfirmDelete(false)} style={{ flex: 1 }}>
                Hủy
              </Button>
              <Button
                size="small"
                onClick={() => {
                  openSnackbar({ text: 'Đã ghi nhận. Hotline sẽ liên hệ xác minh trong 24h.', type: 'info' });
                  setConfirmDelete(false);
                }}
                style={{ flex: 1, background: 'var(--danger)' }}
              >
                Gửi yêu cầu xóa
              </Button>
            </Box>
          </Box>
        )}
      </Box>

      <Text size="xSmall" style={{ color: 'var(--neutral-400)', textAlign: 'center', display: 'block' }}>
        Tubu Tree Mini App · phiên bản 1.0.0
      </Text>

      <Box p={4}>
        <Button fullWidth variant="secondary" onClick={() => void logout()}>
          Đăng xuất
        </Button>
      </Box>
    </Page>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box mx={4} mb={3} p={4} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
      <Text bold style={{ marginBottom: 8 }}>
        {title}
      </Text>
      {children}
    </Box>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box flex justifyContent="space-between" py={2} style={{ borderBottom: '1px solid var(--neutral-100)' }}>
      <Text size="small" style={{ color: 'var(--neutral-600)' }}>
        {label}
      </Text>
      <Text size="small" bold>
        {value}
      </Text>
    </Box>
  );
}

function LinkRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Box
      className="tubu-press"
      flex
      alignItems="center"
      justifyContent="space-between"
      py={3}
      onClick={onClick}
      style={{ borderBottom: '1px solid var(--neutral-100)' }}
    >
      <Text size="small">{label}</Text>
      <Text style={{ color: 'var(--neutral-400)' }}>›</Text>
    </Box>
  );
}
