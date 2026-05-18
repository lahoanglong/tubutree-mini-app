// Wishlist Page — Sản phẩm yêu thích
import React, { useEffect, useState } from "react";
import { Box, Spinner, useSnackbar } from "zmp-ui";
import { wishlistApi } from "services/api";
import type { WishlistItem } from "types";

const WishlistPage: React.FC = () => {
  const { openSnackbar } = useSnackbar();
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadWishlist(); }, []);

  const loadWishlist = async () => {
    try { setItems(await wishlistApi.getAll()); } catch { }
    finally { setLoading(false); }
  };

  const handleRemove = async (id: number) => {
    try {
      await wishlistApi.remove(id);
      openSnackbar({ text: "Đã bỏ yêu thích", type: "success" });
      loadWishlist();
    } catch {
      openSnackbar({ text: "Có lỗi xảy ra", type: "error" });
    }
  };

  if (loading) return <Box flex alignItems="center" justifyContent="center" style={{ padding: 60 }}><Spinner visible /></Box>;

  return (
    <Box>
      <div className="section-header">
        <span className="section-header__title">Yêu thích ({items.length})</span>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">❤️</div>
          <div className="empty-state__title">Chưa có sản phẩm yêu thích</div>
          <div className="empty-state__desc">Nhấn ❤️ trên sản phẩm để lưu lại</div>
        </div>
      ) : (
        items.map(item => (
          <Box key={item.id} p={4} flex justifyContent="space-between" alignItems="center" style={{ background: "#fff", borderBottom: "1px solid #f0f0f0" }}>
            <span>Sản phẩm #{item.pos_product_id}</span>
            <span onClick={() => handleRemove(item.id)} style={{ color: "#F44336", fontSize: 13, cursor: "pointer" }}>Bỏ thích</span>
          </Box>
        ))
      )}
    </Box>
  );
};

export default WishlistPage;
