import { useState } from 'react';
import { Box, Page, Text, Header, Button, Sheet, useSnackbar } from 'zmp-ui';
import { useAuthStore } from '../store/auth';
import { haptic } from '../utils/haptic';

const FAQ_CATS = ['Tất cả', 'Chung', 'Mua sắm', 'Điểm & Vườn', 'Đổi trả'] as const;
type FaqCat = (typeof FAQ_CATS)[number];

const FAQ: { q: string; a: string; cat: Exclude<FaqCat, 'Tất cả'> }[] = [
  {
    cat: 'Chung',
    q: 'Tubu Tree bán những gì?',
    a: 'Tubu Tree tuyển chọn sản phẩm sống xanh từ nhiều thương hiệu Việt: mỹ phẩm thiên nhiên, tẩy rửa sinh học, đồ cho mẹ & bé — ưu tiên thành phần lành tính, bao bì thân thiện môi trường.',
  },
  {
    cat: 'Điểm & Vườn',
    q: 'Điểm Xanh là gì và dùng thế nào?',
    a: '10.000đ chi tiêu trên đơn đã giao = 1 Điểm Xanh. 1 Điểm Xanh đổi 1.000đ khi thanh toán, tối đa 20% giá trị đơn. Điểm có hạn 12 tháng.',
  },
  {
    cat: 'Mua sắm',
    q: 'Phí vận chuyển tính ra sao?',
    a: 'Đơn dưới 200.000đ phí ship 19.000đ; đơn từ 200.000đ được miễn phí. Hạng Lộc Biếc trở lên được freeship từ ngưỡng thấp hơn.',
  },
  {
    cat: 'Mua sắm',
    q: 'Tôi thanh toán bằng cách nào?',
    a: 'Bạn có thể chọn COD (thanh toán khi nhận), Ví Tubu, hoặc ZaloPay. Đơn từ đại lý hỗ trợ thêm chuyển khoản / công nợ.',
  },
  {
    cat: 'Đổi trả',
    q: 'Chính sách đổi/trả thế nào?',
    a: 'Chỉ đổi/trả khi sản phẩm bị lỗi nhà sản xuất (hỏng bao bì, sai HSD, sai mã, không đúng mô tả) trong vòng 7 ngày từ khi nhận. Tubu chịu phí ship 2 chiều.',
  },
  {
    cat: 'Điểm & Vườn',
    q: 'Vườn Xanh và trồng cây thật là gì?',
    a: 'Chăm cây ảo mỗi ngày (điểm danh, tưới nước, quiz) để cây lớn lên. Khi thu hoạch, Tubu góp 1 cây thật vào dự án "Rừng Xanh Lên" cùng PanNature.',
  },
];

const POLICIES: Record<string, { title: string; body: string }> = {
  terms: {
    title: 'Điều khoản sử dụng',
    body: 'Khi sử dụng Tubu Tree, bạn đồng ý mua sắm đúng mục đích cá nhân, cung cấp thông tin chính xác và không lạm dụng ưu đãi/điểm thưởng. Tubu Tree có quyền tạm khoá tài khoản có dấu hiệu gian lận. Giá và khuyến mãi có thể thay đổi theo thời điểm; đơn hàng chỉ được xác nhận sau khi thanh toán/được duyệt.',
  },
  privacy: {
    title: 'Chính sách bảo mật',
    body: 'Tubu Tree thu thập tên, số điện thoại và địa chỉ nhận hàng để xử lý đơn và chăm sóc khách hàng. Chúng tôi KHÔNG bán hay chia sẻ dữ liệu cho bên thứ ba ngoài đối tác vận chuyển/thanh toán cần thiết. Bạn có thể yêu cầu xoá tài khoản & dữ liệu bất kỳ lúc nào trong mục Tài khoản.',
  },
  returns: {
    title: 'Chính sách đổi trả',
    body: 'Đổi/trả áp dụng trong 7 ngày kể từ khi nhận, với sản phẩm lỗi nhà sản xuất (hỏng bao bì, sai HSD, sai mã, không đúng mô tả). Gửi yêu cầu kèm ảnh minh chứng trong chi tiết đơn hàng. Tubu chịu phí ship 2 chiều cho lỗi từ nhà sản xuất; hoàn tiền vào Ví Tubu sau khi duyệt.',
  },
};

export default function AboutPage() {
  const { openSnackbar } = useSnackbar();
  const { logout } = useAuthStore();
  const [open, setOpen] = useState<number | null>(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [faqCat, setFaqCat] = useState<FaqCat>('Tất cả');
  const [policy, setPolicy] = useState<keyof typeof POLICIES | null>(null);
  const shownFaq = FAQ.filter((f) => faqCat === 'Tất cả' || f.cat === faqCat);

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
        {/* Lọc theo nhóm */}
        <Box style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 10, marginBottom: 4 }}>
          {FAQ_CATS.map((c) => {
            const active = faqCat === c;
            return (
              <Box
                key={c}
                role="button"
                aria-pressed={active}
                className="tubu-press"
                onClick={() => {
                  haptic('light');
                  setFaqCat(c);
                  setOpen(null);
                }}
                style={{
                  whiteSpace: 'nowrap',
                  padding: '7px 12px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: 12.5,
                  fontWeight: active ? 600 : 400,
                  background: active ? 'var(--leaf-600)' : 'var(--neutral-0)',
                  border: `1px solid ${active ? 'var(--leaf-600)' : 'var(--neutral-200)'}`,
                  color: active ? '#fff' : 'var(--neutral-600)',
                  flex: '0 0 auto',
                }}
              >
                {c}
              </Box>
            );
          })}
        </Box>
        {shownFaq.map((item, i) => (
          <Box key={item.q} style={{ borderBottom: i < shownFaq.length - 1 ? '1px solid var(--neutral-100)' : 'none' }}>
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
        <LinkRow label="Điều khoản sử dụng" onClick={() => setPolicy('terms')} />
        <LinkRow label="Chính sách bảo mật" onClick={() => setPolicy('privacy')} />
        <LinkRow label="Chính sách đổi trả" onClick={() => setPolicy('returns')} />
      </Section>

      {/* Nội dung điều khoản hiển thị ngay trong app (không rời mini app) */}
      <Sheet visible={policy != null} onClose={() => setPolicy(null)} autoHeight>
        {policy != null && (
          <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
            <Text className="t-h3" style={{ marginBottom: 10 }}>
              {POLICIES[policy]!.title}
            </Text>
            <Text className="t-body" size="small" style={{ color: 'var(--neutral-600)', lineHeight: 1.6 }}>
              {POLICIES[policy]!.body}
            </Text>
            <Button fullWidth style={{ marginTop: 16 }} onClick={() => setPolicy(null)}>
              Đã hiểu
            </Button>
          </Box>
        )}
      </Sheet>

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
