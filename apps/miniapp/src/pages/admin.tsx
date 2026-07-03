import { useState } from 'react';
import { Box, Page, Text, Button, Input, Sheet, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, ShieldCheck, Trash2 } from 'lucide-react';
import { listStaff, grantStaff, revokeStaff, type StaffRole } from '../services/staff-api';
import { getErrorMessage } from '../services/api';
import { useAuthStore } from '../store/auth';
import { Skeleton } from '../components/ui/skeleton';

export default function AdminPage() {
  const role = useAuthStore((s) => s.user?.role);
  if (role !== 'ADMIN') {
    return (
      <Page className="page">
        <Box p={6} style={{ textAlign: 'center' }}>
          <Text style={{ color: 'var(--neutral-600)' }}>
            Chỉ quản trị viên mới truy cập được trang này.
          </Text>
        </Box>
      </Page>
    );
  }
  return <AdminHub />;
}

const PHONE_RE = /^0\d{8,10}$/;

function AdminHub() {
  const qc = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const staffQ = useQuery({ queryKey: ['admin-staff'], queryFn: listStaff });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('STAFF');

  const grantM = useMutation({
    mutationFn: () => grantStaff(phone.trim(), role),
    onSuccess: (r) => {
      openSnackbar({
        text: r.applied ? 'Đã cấp quyền & áp ngay.' : 'Đã lưu quyền (sẽ áp khi họ mở app).',
        type: 'success',
      });
      setSheetOpen(false);
      setPhone('');
      qc.invalidateQueries({ queryKey: ['admin-staff'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const revokeM = useMutation({
    mutationFn: (p: string) => revokeStaff(p),
    onSuccess: () => {
      openSnackbar({ text: 'Đã thu hồi quyền.', type: 'success' });
      qc.invalidateQueries({ queryKey: ['admin-staff'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 96 }}>
      <Box p={4} flex flexDirection="column" style={{ gap: 16 }}>
        <Box flex justifyContent="space-between" alignItems="center">
          <Text.Title size="small">Nhân sự</Text.Title>
          <Button size="small" prefixIcon={<UserPlus size={16} />} onClick={() => setSheetOpen(true)}>
            Thêm
          </Button>
        </Box>

        {staffQ.isLoading && <Skeleton style={{ height: 80, borderRadius: 12 }} />}
        {staffQ.isError && (
          <Text style={{ color: 'var(--danger, #d64545)' }}>{getErrorMessage(staffQ.error)}</Text>
        )}

        {staffQ.data && (
          <>
            {staffQ.data.members.map((m) => (
              <Box
                key={m.id}
                flex
                justifyContent="space-between"
                alignItems="center"
                style={{ padding: 12, background: 'var(--neutral-0)', borderRadius: 12, gap: 8 }}
              >
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text bold>{m.fullName ?? 'Chưa có tên'}</Text>
                  <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
                    {m.phone ?? '—'} · {m.role === 'ADMIN' ? 'Quản trị' : 'Nhân viên'}
                  </Text>
                </Box>
                {m.phone && (
                  <Button
                    size="small"
                    variant="tertiary"
                    prefixIcon={<Trash2 size={15} />}
                    style={{ color: 'var(--danger, #d64545)' }}
                    onClick={() => revokeM.mutate(m.phone as string)}
                  >
                    Thu hồi
                  </Button>
                )}
              </Box>
            ))}

            {staffQ.data.members.length === 0 && (
              <Text size="small" style={{ color: 'var(--neutral-500)' }}>
                Chưa có nhân sự. Bấm “Thêm” để cấp quyền theo số điện thoại.
              </Text>
            )}

            {staffQ.data.pendingInvites.length > 0 && (
              <>
                <Text bold style={{ marginTop: 8 }}>
                  Chờ mở app
                </Text>
                {staffQ.data.pendingInvites.map((p) => (
                  <Box
                    key={p.phone}
                    flex
                    justifyContent="space-between"
                    alignItems="center"
                    style={{ padding: 12, background: 'var(--neutral-100)', borderRadius: 12, gap: 8 }}
                  >
                    <Text size="small">
                      {p.phone} · {p.role === 'ADMIN' ? 'Quản trị' : 'Nhân viên'}
                    </Text>
                    <Button size="small" variant="tertiary" onClick={() => revokeM.mutate(p.phone)}>
                      Huỷ
                    </Button>
                  </Box>
                ))}
              </>
            )}
          </>
        )}
      </Box>

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} autoHeight>
        <Box p={4} flex flexDirection="column" style={{ gap: 12 }}>
          <Text.Title size="small">Thêm nhân sự theo SĐT</Text.Title>
          <Input
            type="number"
            placeholder="Số điện thoại (VD 09xxxxxxxx)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Box flex style={{ gap: 8 }}>
            <Button
              variant={role === 'STAFF' ? undefined : 'secondary'}
              prefixIcon={<UserPlus size={16} />}
              style={{ flex: 1 }}
              onClick={() => setRole('STAFF')}
            >
              Nhân viên
            </Button>
            <Button
              variant={role === 'ADMIN' ? undefined : 'secondary'}
              prefixIcon={<ShieldCheck size={16} />}
              style={{ flex: 1 }}
              onClick={() => setRole('ADMIN')}
            >
              Quản trị
            </Button>
          </Box>
          <Button
            fullWidth
            loading={grantM.isPending}
            disabled={!PHONE_RE.test(phone.trim())}
            onClick={() => grantM.mutate()}
          >
            Lưu quyền
          </Button>
        </Box>
      </Sheet>
    </Page>
  );
}
