// Wallet + Payout — Ví hoa hồng + Rút tiền
import React, { useEffect, useState } from "react";
import { Box, Text, Button, Input, useSnackbar, Modal } from "zmp-ui";
import { walletApi, payoutApi } from "services/api";
import type { Payout, WalletItem } from "types";

const formatVnd = (s: string | number) => Number(s).toLocaleString() + " ₫";

const STATUS_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  PENDING:   { text: "Chờ duyệt",  color: "#92400e", bg: "#fef3c7" },
  APPROVED:  { text: "Đang chuyển", color: "#1e40af", bg: "#dbeafe" },
  COMPLETED: { text: "Đã chuyển",  color: "#065f46", bg: "#d1fae5" },
  REJECTED:  { text: "Từ chối",    color: "#991b1b", bg: "#fee2e2" },
};

const WalletPayoutPage: React.FC = () => {
  const { openSnackbar } = useSnackbar();
  const [balance, setBalance] = useState("0");
  const [history, setHistory] = useState<WalletItem[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setLoading(true);
    return Promise.all([
      walletApi.getBalance(),
      walletApi.getHistory(1, 30),
      payoutApi.listMine(1, 10),
    ]).then(([b, h, p]) => {
      setBalance(b.balance); setHistory(h.data); setPayouts(p.data);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleRequest = async () => {
    const n = Number(amount);
    if (!n || n < 100000) { openSnackbar({ text: "Tối thiểu 100,000 VND", type: "error" }); return; }
    setSubmitting(true);
    try {
      await payoutApi.request(n);
      openSnackbar({ text: "Đã gửi lệnh rút — chờ admin duyệt", type: "success" });
      setModal(false); setAmount("");
      await load();
    } catch (err: any) {
      const m = err.response?.data?.message || err.response?.data?.error || err.message;
      openSnackbar({ text: m, type: "error" });
    } finally { setSubmitting(false); }
  };

  if (loading) return <Box p={4}><Text>Đang tải…</Text></Box>;

  return (
    <Box p={3}>
      <Text.Title>💰 Ví & Rút tiền</Text.Title>

      <div style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)", borderRadius: 16, padding: 20, marginTop: 12, color: "#fff" }}>
        <Text size="small" style={{ color: "#ede9fe" }}>Số dư ví</Text>
        <div style={{ fontSize: 36, fontWeight: 800 }}>{formatVnd(balance)}</div>
        <Button size="small" variant="secondary" onClick={() => setModal(true)} style={{ marginTop: 8 }}>
          Tạo lệnh rút tiền
        </Button>
      </div>

      {/* Payout list */}
      <Box mt={3}>
        <Text bold style={{ marginBottom: 6 }}>Lệnh rút gần đây</Text>
        {payouts.length === 0 && <Text size="small" style={{ color: "#999" }}>Chưa có lệnh nào.</Text>}
        {payouts.map(p => {
          const s = STATUS_LABEL[p.status] || { text: p.status, color: "#444", bg: "#eee" };
          return (
            <div key={p.id} style={{ background: "#fff", padding: 12, borderRadius: 10, marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Text size="small" bold>{formatVnd(p.amount_vnd)}</Text>
                <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, color: s.color, background: s.bg }}>{s.text}</span>
              </div>
              <Text size="xSmall" style={{ color: "#666" }}>
                {p.bank_name} · {p.bank_account_no} · {new Date(p.requested_at).toLocaleDateString()}
              </Text>
              {p.reject_reason && <Text size="xSmall" style={{ color: "#991b1b" }}>Lý do: {p.reject_reason}</Text>}
            </div>
          );
        })}
      </Box>

      {/* Wallet history */}
      <Box mt={3}>
        <Text bold style={{ marginBottom: 6 }}>Lịch sử ví</Text>
        {history.map(h => (
          <div key={h.id} style={{ background: "#fff", padding: 10, borderRadius: 8, marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
            <div>
              <Text size="xSmall" bold>{h.type}</Text>
              <Text size="xSmall" style={{ color: "#666" }}>{new Date(h.created_at).toLocaleString()}</Text>
              {h.note && <Text size="xSmall" style={{ color: "#999" }}>{h.note}</Text>}
            </div>
            <div style={{ color: Number(h.amount) > 0 ? "#065f46" : "#991b1b", fontWeight: 700 }}>
              {Number(h.amount) > 0 ? "+" : ""}{formatVnd(h.amount)}
            </div>
          </div>
        ))}
      </Box>

      <Modal visible={modal} onClose={() => setModal(false)} title="Tạo lệnh rút tiền">
        <Box p={2}>
          <Text size="small" style={{ marginBottom: 8, color: "#666" }}>
            Tối thiểu 100,000 VND. Số dư hiện tại: <b>{formatVnd(balance)}</b>.
          </Text>
          <Input
            label="Số tiền muốn rút (VND)"
            value={amount}
            onChange={e => setAmount(e.target.value.replace(/\D/g, ""))}
            placeholder="100000"
          />
          <Box mt={2}>
            <Button fullWidth loading={submitting} onClick={handleRequest}>Gửi lệnh rút</Button>
          </Box>
          <Text size="xSmall" style={{ color: "#999", marginTop: 8 }}>
            Số tiền sẽ được tạm giữ đến khi admin duyệt & chuyển khoản. Nếu bị từ chối, tiền sẽ hoàn lại ví.
          </Text>
        </Box>
      </Modal>
    </Box>
  );
};

export default WalletPayoutPage;
