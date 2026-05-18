// Order Detail Page
import React, { useEffect, useState } from "react";
import { Box, Text, Button, Spinner, useSnackbar } from "zmp-ui";
import { useParams, useNavigate } from "react-router-dom";
import { orderApi } from "services/api";
import { formatDateTime, getOrderStatusText, getOrderStatusColor } from "utils/format";
import type { OrderDetail } from "types";

const OrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (id) loadOrder(id); }, [id]);

  const loadOrder = async (orderId: string) => {
    try {
      const data = await orderApi.getDetail(orderId);
      setOrder(data);
    } catch { }
    finally { setLoading(false); }
  };

  const handleCancel = async () => {
    if (!id) return;
    try {
      await orderApi.cancel(id, "Khách yêu cầu hủy");
      openSnackbar({ text: "Đã hủy đơn hàng", type: "success" });
      navigate("/orders");
    } catch (err: any) {
      openSnackbar({ text: err.response?.data?.error || "Không thể hủy", type: "error" });
    }
  };

  const handleReorder = async () => {
    if (!id) return;
    try {
      await orderApi.reorder(id);
      openSnackbar({ text: "Đã thêm vào giỏ hàng!", type: "success" });
      navigate("/cart");
    } catch {
      openSnackbar({ text: "Có lỗi xảy ra", type: "error" });
    }
  };

  if (loading) return <Box flex alignItems="center" justifyContent="center" style={{ padding: 60 }}><Spinner visible /></Box>;
  if (!order) return <div className="empty-state"><div className="empty-state__icon">😢</div><div className="empty-state__title">Không tìm thấy đơn hàng</div></div>;

  const { db_ref } = order;
  const canCancel = db_ref.payment_status === 'PENDING' || db_ref.payment_status === 'WAITING_PAYMENT';

  return (
    <Box>
      <Box p={4} style={{ background: "#fff", marginBottom: 8 }}>
        <Box flex justifyContent="space-between" alignItems="center">
          <Text size="large" bold>Đơn #{db_ref.pos_order_id}</Text>
          <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 12, color: "#fff", background: getOrderStatusColor(db_ref.payment_status) }}>
            {getOrderStatusText(db_ref.payment_status)}
          </span>
        </Box>
        <Text size="small" style={{ color: "#888", marginTop: 8 }}>📅 {formatDateTime(db_ref.created_at)}</Text>
        <Text size="small" style={{ color: "#888", marginTop: 4 }}>💳 {db_ref.payment_method}</Text>
      </Box>

      <Box p={4} style={{ background: "#fff", display: "flex", gap: 10 }}>
        {canCancel && (
          <Button size="medium" variant="secondary" style={{ flex: 1, color: "#F44336", borderColor: "#F44336" }} onClick={handleCancel}>
            Hủy đơn
          </Button>
        )}
        <Button size="medium" style={{ flex: 1, background: "#2E7D32" }} onClick={handleReorder}>
          🔄 Mua lại
        </Button>
      </Box>
    </Box>
  );
};

export default OrderDetailPage;
