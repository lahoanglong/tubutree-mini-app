import { useEffect, useState } from 'react';
import { Box, Page, Text, Header, Button, Input, useSnackbar, useNavigate } from 'zmp-ui';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getMe, updateMe } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { haptic } from '../utils/haptic';
import { Skeleton } from '../components/ui/skeleton';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EditProfilePage() {
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const meQ = useQuery({ queryKey: ['me'], queryFn: getMe });

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (meQ.data) {
      setFullName(meQ.data.fullName ?? '');
      setEmail(meQ.data.email ?? '');
      setDob(meQ.data.dob ?? '');
    }
  }, [meQ.data]);

  const emailInvalid = touched && email.trim() !== '' && !EMAIL.test(email.trim());

  const save = useMutation({
    mutationFn: () =>
      updateMe({
        fullName: fullName.trim() || undefined,
        email: email.trim() || undefined,
        dob: dob || undefined,
      }),
    onSuccess: () => {
      haptic('medium');
      // Đồng bộ tên hiển thị vào auth store (header/profile).
      const cur = useAuthStore.getState().user;
      if (cur) useAuthStore.setState({ user: { ...cur, fullName: fullName.trim() || cur.fullName } });
      openSnackbar({ text: 'Đã cập nhật hồ sơ 🌿', type: 'success' });
      navigate(-1);
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
      <Header title="Chỉnh sửa hồ sơ" />

      {meQ.isLoading ? (
        <Box p={4} flex flexDirection="column" style={{ gap: 12 }}>
          <Skeleton style={{ height: 56 }} />
          <Skeleton style={{ height: 56 }} />
          <Skeleton style={{ height: 56 }} />
        </Box>
      ) : (
        <Box p={4} flex flexDirection="column" style={{ gap: 14 }}>
          <Input label="Họ và tên" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} />
          <Box>
            <Input
              label="Email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              status={emailInvalid ? 'error' : undefined}
            />
            {emailInvalid && (
              <Text size="xSmall" style={{ color: 'var(--danger)', marginTop: 2 }}>
                ⚠ Email không hợp lệ
              </Text>
            )}
          </Box>
          <Box>
            <Text size="xSmall" bold style={{ marginBottom: 4 }}>
              Ngày sinh
            </Text>
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--neutral-200)',
                fontFamily: 'inherit',
                fontSize: 14,
                background: 'var(--neutral-0)',
              }}
            />
            <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
              🎁 Nhận voucher quà tặng vào tháng sinh nhật.
            </Text>
          </Box>

          <Button
            fullWidth
            loading={save.isPending}
            disabled={emailInvalid}
            onClick={() => {
              setTouched(true);
              if (!(email.trim() !== '' && !EMAIL.test(email.trim()))) save.mutate();
            }}
            style={{ background: 'var(--primary-600)', marginTop: 4 }}
          >
            Lưu thay đổi
          </Button>
        </Box>
      )}
    </Page>
  );
}
