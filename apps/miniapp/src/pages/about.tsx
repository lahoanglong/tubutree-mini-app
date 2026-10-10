import { useState } from 'react';
import { Box, Page, Text, Sheet, useSnackbar } from 'zmp-ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { haptic } from '../utils/haptic';
import { requestAccountDeletion } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { openOAChat, hasOA } from '../services/zmp-bridge';
import { Button } from '../components/ui/button';
import { FALLBACK_FAQ, fetchFaqs, fetchSupportContact } from './about-data';

const ALL_CATS = 'Tất cả';

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
  const [faqCat, setFaqCat] = useState<string>(ALL_CATS);
  // FAQ do admin nhập (tab Câu hỏi thường gặp); chưa có dòng nào hoặc lỗi mạng thì dùng bản dự phòng.
  const faqQ = useQuery({ queryKey: ['faqs'], queryFn: fetchFaqs, staleTime: 10 * 60_000 });
  const supportQ = useQuery({ queryKey: ['support-contact'], queryFn: fetchSupportContact, staleTime: 10 * 60_000 });
  const faq = faqQ.data && faqQ.data.length > 0 ? faqQ.data : faqQ.isLoading ? [] : FALLBACK_FAQ;
  const faqCats = [ALL_CATS, ...new Set(faq.map((f) => f.cat))];
  const support = supportQ.data;

  // A1-03: nút này trước đây chỉ hiện snackbar giả, không gọi API nào. Giờ ghi nhận yêu cầu THẬT
  // (KHÔNG xoá ngay — CSKH xử lý thủ công) + mở sẵn Zalo OA để khách có thể trao đổi trực tiếp
  // luôn, thay vì chỉ chờ hotline gọi lại.
  const deleteM = useMutation({
    mutationFn: () => requestAccountDeletion(),
    onSuccess: (res) => {
      openSnackbar({ text: res.message, type: 'info' });
      if (hasOA) void openOAChat('Tôi muốn xoá tài khoản Tubu Tree');
      setConfirmDelete(false);
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });
  const [policy, setPolicy] = useState<keyof typeof POLICIES | null>(null);
  const shownFaq = faq.filter((f) => faqCat === ALL_CATS || f.cat === faqCat);

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>

      {/* Brand story */}
      <Box p={4}>
        <Box
          p={5}
          style={{
            background: 'linear-gradient(135deg, var(--leaf-600), var(--leaf-700))',
            borderRadius: 'var(--radius-xl)',
            color: 'var(--neutral-0)',
          }}
        >
          <Text style={{ fontSize: 40 }}>🌳</Text>
          <Text bold size="xLarge" style={{ color: 'var(--neutral-0)', marginTop: 4 }}>
            Sống Xanh An Lành
          </Text>
          <Text size="small" style={{ color: 'var(--neutral-0)', opacity: 0.9, marginTop: 8 }}>
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
          {faqCats.map((c) => {
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
                  color: active ? 'var(--neutral-0)' : 'var(--neutral-600)',
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
              <ChevronDown
                size={16}
                style={{
                  color: 'var(--neutral-400)',
                  transform: open === i ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                  flexShrink: 0,
                }}
              />
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
      {support && (support.hotline || support.email || support.zaloOaName) && (
        <Section title="Hỗ trợ khách hàng">
          {support.hotline && <Row label="Hotline" value={support.hotline} />}
          {support.zaloOaName && <Row label="Zalo OA" value={support.zaloOaName} />}
          {support.email && <Row label="Email" value={support.email} />}
        </Section>
      )}

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
            <Button fullWidth style={{ marginTop: 16 }} onPress={() => setPolicy(null)}>
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
          <Box p={4} style={{ background: 'var(--danger-bg)', borderRadius: 'var(--radius-lg)' }}>
            <Text size="small" bold style={{ color: 'var(--danger)' }}>
              Xóa tài khoản vĩnh viễn?
            </Text>
            <Text size="xSmall" style={{ color: 'var(--neutral-600)', marginTop: 4 }}>
              Gửi yêu cầu để CSKH liên hệ xác minh và xử lý xóa tài khoản theo quy định — tài khoản
              CHƯA bị xóa ngay khi bạn bấm nút này.
            </Text>
            <Box flex style={{ gap: 8, marginTop: 12 }}>
              <Button variant="secondary" onPress={() => setConfirmDelete(false)} style={{ flex: 1 }}>
                Hủy
              </Button>
              <Button variant="danger" loading={deleteM.isPending} onPress={() => deleteM.mutate()} style={{ flex: 1 }}>
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
        <Button fullWidth variant="secondary" onPress={() => void logout()}>
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
      <ChevronRight size={16} style={{ color: 'var(--neutral-400)', flexShrink: 0 }} />
    </Box>
  );
}
