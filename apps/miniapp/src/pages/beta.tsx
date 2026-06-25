import { useState } from 'react';
import { Box, Page, Text, Button, Input, Spinner, useSnackbar } from 'zmp-ui';
import { FlaskConical, MessageSquare, Sparkles } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getBetaStatus, joinBeta, leaveBeta, sendBetaFeedback } from '../services/beta-api';
import { useAuthStore } from '../store/auth';

function msg(e: unknown): string {
  const ax = e as { response?: { data?: { message?: string } }; message?: string };
  return ax?.response?.data?.message ?? ax?.message ?? 'Có lỗi xảy ra';
}

export default function BetaPage() {
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const authed = useAuthStore((s) => s.status) === 'authenticated';
  const [feedback, setFeedback] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['beta'], queryFn: getBetaStatus, enabled: authed });

  const joinM = useMutation({
    mutationFn: joinBeta,
    onSuccess: () => {
      openSnackbar({ text: '🎉 Chào mừng bạn vào đội Beta Tester!', type: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['beta'] });
    },
    onError: (e: unknown) => openSnackbar({ text: msg(e), type: 'error' }),
  });

  const leaveM = useMutation({
    mutationFn: leaveBeta,
    onSuccess: () => {
      openSnackbar({ text: 'Bạn đã rời chương trình Beta.', type: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['beta'] });
    },
    onError: (e: unknown) => openSnackbar({ text: msg(e), type: 'error' }),
  });

  const feedbackM = useMutation({
    mutationFn: () => sendBetaFeedback(feedback.trim()),
    onSuccess: () => {
      openSnackbar({ text: '🙏 Cảm ơn góp ý của bạn!', type: 'success' });
      setFeedback('');
    },
    onError: (e: unknown) => openSnackbar({ text: msg(e), type: 'error' }),
  });

  const enrolled = data?.enrolled ?? false;

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 80 }}>
      <Box p={3} style={{ background: 'var(--neutral-0)' }}>
        <Box flex alignItems="center" style={{ gap: 8 }}>
          <FlaskConical size={22} color="var(--leaf-600)" />
          <Text bold size="large">Chương trình Beta Tester</Text>
        </Box>
        <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
          Trải nghiệm sớm các tính năng mới & góp ý trực tiếp để Tubu Tree tốt hơn 🌱
        </Text>
      </Box>

      {isLoading ? (
        <Box flex justifyContent="center" p={6}><Spinner /></Box>
      ) : (
        <Box p={2}>
          {/* Trạng thái tham gia */}
          <Box p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
            {enrolled ? (
              <>
                <Box flex alignItems="center" style={{ gap: 8 }}>
                  <Sparkles size={18} color="var(--leaf-600)" />
                  <Text size="small" bold style={{ color: 'var(--leaf-700)' }}>Bạn đang là Beta Tester</Text>
                </Box>
                <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
                  Cảm ơn bạn đã đồng hành! Bạn sẽ thấy các tính năng thử nghiệm sớm nhất.
                </Text>
                <Button
                  size="small"
                  variant="secondary"
                  loading={leaveM.isPending}
                  onClick={() => leaveM.mutate()}
                  style={{ marginTop: 10 }}
                >
                  Rời chương trình
                </Button>
              </>
            ) : (
              <>
                <Text size="small" style={{ color: 'var(--neutral-600)' }}>
                  Tham gia để được dùng thử tính năng mới trước mọi người và gửi góp ý cho đội ngũ.
                </Text>
                <Button
                  fullWidth
                  loading={joinM.isPending}
                  disabled={!authed}
                  onClick={() => joinM.mutate()}
                  style={{ marginTop: 12, background: 'var(--leaf-600)' }}
                >
                  Tham gia Beta Tester
                </Button>
                {!authed && (
                  <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 8, textAlign: 'center' }}>
                    Đăng nhập để tham gia.
                  </Text>
                )}
              </>
            )}
          </Box>

          {/* Tính năng beta hiện có */}
          {enrolled && (
            <Box mt={2} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
              <Text size="small" bold style={{ marginBottom: 8 }}>Tính năng thử nghiệm</Text>
              {data && data.features.length > 0 ? (
                data.features.map((f) => (
                  <Box key={f.key} style={{ padding: '8px 0', borderTop: '1px solid var(--neutral-100)' }}>
                    <Text size="small" bold>🧪 {f.title}</Text>
                    <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>{f.desc}</Text>
                  </Box>
                ))
              ) : (
                <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                  Hiện chưa có tính năng beta nào. Chúng tôi sẽ thông báo khi có tính năng mới để bạn thử!
                </Text>
              )}
            </Box>
          )}

          {/* Góp ý (chỉ khi đã tham gia) */}
          {enrolled && (
            <Box mt={2} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
              <Box flex alignItems="center" style={{ gap: 6, marginBottom: 8 }}>
                <MessageSquare size={16} color="var(--leaf-600)" />
                <Text size="small" bold>Gửi góp ý</Text>
              </Box>
              <Input.TextArea
                placeholder="Bạn thấy app cần cải thiện điều gì? Tính năng nào bạn mong muốn?"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={4}
              />
              <Button
                fullWidth
                loading={feedbackM.isPending}
                disabled={!feedback.trim()}
                onClick={() => feedbackM.mutate()}
                style={{ marginTop: 10, background: feedback.trim() ? 'var(--leaf-600)' : 'var(--neutral-300)' }}
              >
                Gửi góp ý
              </Button>
            </Box>
          )}
        </Box>
      )}
    </Page>
  );
}
