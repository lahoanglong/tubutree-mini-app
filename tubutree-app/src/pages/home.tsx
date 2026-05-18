// Home Page — Trang chủ (với UI cải thiện)
import React, { useEffect, useState, useCallback } from "react";
import { Box, Text, Spinner } from "zmp-ui";
import { useNavigate } from "react-router-dom";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import { productApi, bannerApi } from "services/api";
import { formatPrice, getMinPrice } from "utils/format";
import type { Product, Banner, Category } from "types";

// Ảnh placeholder SVG inline (tránh lỗi broken image)
const PLACEHOLDER_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 300'%3E%3Crect fill='%23f0f0f0' width='300' height='300'/%3E%3Ctext x='50%25' y='45%25' text-anchor='middle' fill='%23ccc' font-size='40'%3E🌳%3C/text%3E%3Ctext x='50%25' y='58%25' text-anchor='middle' fill='%23bbb' font-size='14' font-family='sans-serif'%3ETubu Tree%3C/text%3E%3C/svg%3E";

// Lấy ảnh sản phẩm an toàn
function safeProductImage(product: Product): string {
  if (product.image) return product.image;
  const firstVar = product.variations?.[0];
  if (firstVar?.images?.[0]) return firstVar.images[0];
  return PLACEHOLDER_IMG;
}

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [prodRes, catRes, bannerRes] = await Promise.all([
        productApi.getAll(1, 50),
        productApi.getCategories().catch(() => ({ data: [] })),
        bannerApi.getActive().catch(() => []),
      ]);
      setProducts(prodRes.data || []);
      setCategories(catRes.data || []);
      setBanners(Array.isArray(bannerRes) ? bannerRes : []);
    } catch (err) {
      console.error("Lỗi tải dữ liệu:", err);
    } finally {
      setLoading(false);
    }
  };

  // Filter: search + category (match by product tag or name)
  const filteredProducts = products.filter(p => {
    // Search filter
    if (searchText) {
      const q = searchText.toLowerCase();
      if (!p.name.toLowerCase().includes(q)) return false;
    }
    // Category filter: match by tag name or category text
    if (activeCategory) {
      const cat = categories.find(c => c.id === activeCategory);
      if (!cat) return false;
      const catText = cat.text.toLowerCase();
      // Check if product name or tags contain category text
      const nameMatch = p.name.toLowerCase().includes(catText);
      const tagMatch = p.tags?.some(t => t.toLowerCase().includes(catText));
      const catMatch = p.categories?.some(c => c.id === activeCategory);
      return nameMatch || tagMatch || catMatch;
    }
    return true;
  });

  // Xử lý lỗi ảnh
  const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    (e.target as HTMLImageElement).src = PLACEHOLDER_IMG;
  }, []);

  if (loading) {
    return (
      <Box flex flexDirection="column" alignItems="center" justifyContent="center" style={{ padding: 60 }}>
        <Spinner visible />
        <Text style={{ marginTop: 12, color: "#888" }}>Đang tải...</Text>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header Logo */}
      <div className="app-header">
        <span className="app-header__logo">🌳</span>
        <span className="app-header__title">Tubu Tree</span>
      </div>

      {/* Search Bar */}
      <div className="search-bar">
        <input
          placeholder="Tìm sản phẩm..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        {searchText && (
          <span className="search-bar__clear" onClick={() => setSearchText("")}>✕</span>
        )}
      </div>

      {/* Banner Slider */}
      {banners.length > 0 && (
        <div className="banner-slider">
          <Swiper spaceBetween={10} slidesPerView={1.05} centeredSlides>
            {banners.map(b => (
              <SwiperSlide key={b.id} className="banner-slider__slide">
                <img src={b.image_url} alt="Banner" onError={handleImageError} />
              </SwiperSlide>
            ))}
          </Swiper>
        </div>
      )}

      {/* Categories */}
      {categories.length > 0 && (
        <div className="category-tabs">
          <div
            className={`category-tabs__item ${!activeCategory ? 'category-tabs__item--active' : ''}`}
            onClick={() => setActiveCategory(null)}
          >
            Tất cả
          </div>
          {categories.map(cat => (
            <div
              key={cat.id}
              className={`category-tabs__item ${activeCategory === cat.id ? 'category-tabs__item--active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
            >
              {cat.text}
            </div>
          ))}
        </div>
      )}

      {/* Products Header */}
      <div className="section-header">
        <span className="section-header__title">
          {activeCategory ? categories.find(c => c.id === activeCategory)?.text : "Sản phẩm"}
        </span>
        <span className="section-header__more">{filteredProducts.length} sản phẩm</span>
      </div>

      {/* Products Grid */}
      {filteredProducts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">📦</div>
          <div className="empty-state__title">Không tìm thấy sản phẩm</div>
          <div className="empty-state__desc">
            {searchText ? `Không có kết quả cho "${searchText}"` : "Danh mục này chưa có sản phẩm nào"}
          </div>
        </div>
      ) : (
        <div className="product-grid">
          {filteredProducts.map(product => (
            <div
              key={product.id}
              className="product-card"
              onClick={() => navigate(`/product/${product.id}`)}
            >
              <div className="product-card__image-wrap">
                <img
                  className="product-card__image"
                  src={safeProductImage(product)}
                  alt={product.name}
                  loading="lazy"
                  onError={handleImageError}
                />
              </div>
              <div className="product-card__info">
                <div className="product-card__name">{product.name}</div>
                <div className="product-card__price">
                  {formatPrice(getMinPrice(product.variations))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bottom spacing */}
      <div style={{ height: 20 }} />
    </Box>
  );
};

export default HomePage;
