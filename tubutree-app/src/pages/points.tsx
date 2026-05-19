// Points — Tích điểm
import React, { useEffect, useState } from "react";
import { Box, Text } from "zmp-ui";
import { pointsApi } from "services/api";
import type { PointsBalance, PointsLedgerItem } from "types";

const TYPE_LABEL: Record<string, string> = {
  EARN: "Tích từ đơn",
  REDEEM: "Đã dùng",
  REVERSE_EARN: "Hoàn (huỷ đơn)",
  REVERSE_REDEEM: "Hoàn dùng (huỷ đơn)",
  ADJUST: "Điều chỉnh",
};

const PointsPage: React.FC = () => {
  const [bal, setBal] = useState<PointsBalance | null>(null);
  const [history, setHistory] = useState<PointsLedgerItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([pointsApi.getBalance(), pointsApi.getHistory(1, 50)])
      .then(([b, h]) => { setBal(b); setHistory(h.data); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Box p={4}><Text>Đang tải…</Text></Box>;
  if (!bal) return <Box p={4}><Text>Không tải được</Text></Box>;

  return (
    <Box p={3}>
      <Text.Title>⭐ Điểm thưởng</Text.Title>

      <div style={{
        background: "linear-gradient(135deg,#2E7D32,#4CAF50)",
        borderRadius: 16, padding: 20, marginTop: 12, color: "#fff",
      }}>
        <Text size="small" style={{ color: "#d1fae5" }}>Số dư hiện tại</Text>
        <div style={{ fontSize: 36, fontWeight: 800, lineHeight: "44px" }}>{bal.balance.toLocaleString()}</div>
        <Text size="xSmall" style={{ color: "#d1fae5" }}>
          Đã tích: {bal.lifetime.earned.toLocaleString()} · Đã dùng: {bal.lifetime.redeemed.toLocaleString()}
        </Text>
      </div>

      <Box mt={2}>
        <Text size="xSmall" style={{ color: "#666" }}>
          Quy đổi: <b>1 điểm = {bal.config.vnd_per_point.toLocaleString()} VND</b>{" · "}
          tối thiểu {bal.config.min_redeem} điểm{" · "}
          tối đa {bal.config.max_redeem_pct}% giá trị đơn.
          Tích {(bal.config.earn_per_vnd * 1000)} điểm cho mỗi 1.000 VND.
        </Text>
      </Box>

      <Box mt={3}>
        <Text bold style={{ marginBottom: 8 }}>Lịch sử</Text>
        {history.length === 0 && <Text size="small" style={{ color: "#999" }}>Chưa có giao dịch.</Text>}
        {history.map(item => (
          <div key={item.id} style={{ background: "#fff", padding: 12, borderRadius: 10, marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
            <div>
              <Text size="small" bold>{TYPE_LABEL[item.type] || item.type}</Text>
              <Text size="xSmall" style={{ color: "#666" }}>{new Date(item.created_at).toLocaleString()}</Text>
              {item.note && <Text size="xSmall" style={{ color: "#999" }}>{item.note}</Text>}
            </div>
            <div style={{ color: item.amount > 0 ? "#065f46" : "#991b1b", fontWeight: 700 }}>
              {item.amount > 0 ? "+" : ""}{item.amount.toLocaleString()}
            </div>
          </div>
        ))}
      </Box>
    </Box>
  );
};

export default PointsPage;
