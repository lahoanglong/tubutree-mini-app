import { Box, Page, Text, Button, useNavigate } from 'zmp-ui';

/** Trang 404 — "trang lạc đường" (design batch 5 #24), tông brand nhẹ nhàng. */
export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
      <Box
        flex
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        style={{ minHeight: '80vh', textAlign: 'center', padding: '0 32px', gap: 12 }}
      >
        <Text style={{ fontSize: 72 }}>🐦‍⬛🍃</Text>
        <Text className="t-h2" style={{ color: 'var(--leaf-700)' }}>
          Trang này lạc vào vườn rồi
        </Text>
        <Text size="small" style={{ color: 'var(--neutral-600)' }}>
          Có thể liên kết đã cũ hoặc trang không tồn tại. Quay về trang chủ để tiếp tục dạo vườn nhé.
        </Text>
        <Button
          onClick={() => navigate('/', { replace: true })}
          style={{ marginTop: 12, background: 'var(--leaf-600)', minWidth: 200 }}
        >
          Về trang chủ
        </Button>
      </Box>
    </Page>
  );
}
