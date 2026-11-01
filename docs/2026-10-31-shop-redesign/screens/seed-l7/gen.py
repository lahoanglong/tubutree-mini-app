# Sinh SQL dữ liệu shop cho lane 7: 2 danh mục mới, ~84 sản phẩm, biến thể, người đánh giá, đánh giá, số đã bán.
import json, random, datetime, re, unicodedata

random.seed(7)
NOW = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

BRANDS = {
    'Fuwa3e': '75ae0443eea88aa90f3c2bec9bc3ece1',
    'Visante': 'ca4b707a9ac34c7eb74d5af3a45a8a43',
    'Pơ Lang': 'a5aceb2cb9837795f0dccfec2013385f',
    'Cobote': '465f2461460249939490207ce8f9bd5b',
    'Le Plateau Coffee': 'c17179a6db7a834fb350fde178147af1',
    'BH.Nong': '820b8d831eb57ea2f9adaac2be6b65b7',
    'Sokfram': '01218481b64ed06ed245140fb478932e',
    'Hector': 'f7cb72400bd7fb19294e1f9692c48cd9',
    'Lá Xanh Home': 'cmvwjsoi9002nf7uc0bvlnql1',
    'Bé Na': 'cmvwjsoq3002of7ucuuwcazne',
    'Mộc An': 'cmvwjsozn002pf7ucgi2w0mwv',
    'Tre Việt': 'cmvwjsp9l002qf7uc0dw8h3ei',
}
SEG = {
    'cat-cleaning': ['home_clean'], 'cat-laundry': ['home_clean', 'mom_baby'], 'cat-baby': ['mom_baby'], 'cat-mom': ['mom_baby'],
    'cat-skincare': ['skincare', 'sensitive_skin'], 'cat-personal': ['skincare'], 'cat-coffee': ['eco'], 'cat-food': ['eco'],
    'cat-home': ['eco', 'home_clean'], 'cat-recycled': ['eco'],
}

# (tên, nhãn, danh mục, [(tên biến thể, thuộc tính, giá lẻ)], % giảm hoặc 0)
P = [
    # Tẩy rửa
    ('Nước rửa chén hương chanh Lá Xanh', 'Lá Xanh Home', ['cat-cleaning'], [('Chai 500ml', {'size': '500ml'}, 59000), ('Can 3,8L', {'size': '3.8L'}, 289000)], 15),
    ('Nước rửa chén bồ hòn Lá Xanh', 'Lá Xanh Home', ['cat-cleaning'], [('Chai 750ml', {'size': '750ml'}, 79000)], 0),
    ('Nước tẩy bồn cầu sinh học Lá Xanh', 'Lá Xanh Home', ['cat-cleaning'], [('Chai 900ml', {'size': '900ml'}, 89000)], 10),
    ('Nước lau bếp đa năng Fuwa3e', 'Fuwa3e', ['cat-cleaning'], [('Bình xịt 500ml', {'size': '500ml'}, 99000)], 0),
    ('Bột tẩy cặn đa năng Lá Xanh', 'Lá Xanh Home', ['cat-cleaning'], [('Hộp 500g', {'weight': '500g'}, 69000)], 0),
    ('Viên tẩy lồng máy giặt Fuwa3e', 'Fuwa3e', ['cat-cleaning', 'cat-laundry'], [('Hộp 12 viên', {'count': '12'}, 119000)], 20),
    ('Nước rửa rau quả Fuwa3e', 'Fuwa3e', ['cat-cleaning', 'cat-food'], [('Chai 500ml', {'size': '500ml'}, 85000), ('Can 2L', {'size': '2L'}, 245000)], 0),
    ('Xịt khử mùi tủ giày Lá Xanh', 'Lá Xanh Home', ['cat-cleaning', 'cat-home'], [('Chai 250ml', {'size': '250ml'}, 65000)], 0),
    ('Nước lau đa năng vỏ bưởi Lá Xanh', 'Lá Xanh Home', ['cat-cleaning'], [('Chai 1L', {'size': '1L'}, 95000), ('Can 3,8L', {'size': '3.8L'}, 299000)], 12),
    ('Gel thông cống sinh học Fuwa3e', 'Fuwa3e', ['cat-cleaning'], [('Chai 1L', {'size': '1L'}, 129000)], 0),
    ('Nước rửa chén Fuwa3e túi refill 2L', 'Fuwa3e', ['cat-cleaning'], [('Túi 2L', {'size': '2L'}, 189000)], 18),
    ('Bọt vệ sinh nhà tắm Lá Xanh', 'Lá Xanh Home', ['cat-cleaning'], [('Chai 600ml', {'size': '600ml'}, 109000)], 0),
    ('Combo bếp xanh: rửa chén + lau sàn Fuwa3e', 'Fuwa3e', ['cat-cleaning'], [('Combo 2 chai', {'combo': '2'}, 259000)], 15),
    # Giặt xả
    ('Nước giặt hữu cơ oải hương Lá Xanh', 'Lá Xanh Home', ['cat-laundry'], [('Túi 2L', {'size': '2L'}, 165000), ('Can 3,8L', {'size': '3.8L'}, 279000)], 10),
    ('Nước xả vải hương lavender Fuwa3e', 'Fuwa3e', ['cat-laundry'], [('Túi 2L', {'size': '2L'}, 145000)], 0),
    ('Nước giặt đồ em bé Bé Na', 'Bé Na', ['cat-laundry', 'cat-baby'], [('Chai 1L', {'size': '1L'}, 139000), ('Túi refill 2L', {'size': '2L'}, 229000)], 15),
    ('Viên giặt sinh học Lá Xanh', 'Lá Xanh Home', ['cat-laundry'], [('Hộp 30 viên', {'count': '30'}, 199000)], 20),
    ('Bột giặt enzyme Fuwa3e', 'Fuwa3e', ['cat-laundry'], [('Túi 1,5kg', {'weight': '1.5kg'}, 149000)], 0),
    ('Nước giặt đồ lót Lá Xanh', 'Lá Xanh Home', ['cat-laundry'], [('Chai 300ml', {'size': '300ml'}, 79000)], 0),
    ('Xịt tẩy vết bẩn cổ áo Fuwa3e', 'Fuwa3e', ['cat-laundry'], [('Chai 300ml', {'size': '300ml'}, 89000)], 10),
    ('Nước giặt đồ len lụa Lá Xanh', 'Lá Xanh Home', ['cat-laundry'], [('Chai 500ml', {'size': '500ml'}, 115000)], 0),
    ('Nước xả vải đậm đặc hương nắng Lá Xanh', 'Lá Xanh Home', ['cat-laundry'], [('Túi 1,8L', {'size': '1.8L'}, 129000)], 0),
    ('Nước giặt sinh học Fuwa3e túi refill 2L', 'Fuwa3e', ['cat-laundry'], [('Túi 2L', {'size': '2L'}, 179000)], 12),
    # Cho bé
    ('Sữa tắm gội 2in1 cho bé Bé Na', 'Bé Na', ['cat-baby'], [('Chai 250ml', {'size': '250ml'}, 129000), ('Chai 500ml', {'size': '500ml'}, 219000)], 0),
    ('Khăn ướt không cồn Bé Na', 'Bé Na', ['cat-baby'], [('Gói 80 tờ', {'count': '80'}, 39000), ('Combo 3 gói', {'count': '240'}, 105000)], 10),
    ('Kem dưỡng ẩm cho bé Bé Na', 'Bé Na', ['cat-baby'], [('Tuýp 50g', {'size': '50g'}, 149000)], 0),
    ('Nước rửa bình sữa thảo mộc Bé Na', 'Bé Na', ['cat-baby', 'cat-cleaning'], [('Chai 500ml', {'size': '500ml'}, 119000)], 15),
    ('Xịt chống muỗi sả chanh cho bé Cobote', 'Cobote', ['cat-baby'], [('Chai 100ml', {'size': '100ml'}, 95000)], 0),
    ('Dầu gội thảo dược cho bé Cobote', 'Cobote', ['cat-baby'], [('Chai 200ml', {'size': '200ml'}, 99000)], 0),
    ('Gel bôi vết muỗi đốt Cobote', 'Cobote', ['cat-baby'], [('Tuýp 20g', {'size': '20g'}, 69000)], 0),
    ('Khăn sữa sợi tre Mộc An', 'Mộc An', ['cat-baby'], [('Gói 5 khăn', {'count': '5'}, 89000)], 0),
    ('Bàn chải đánh răng tre cho bé Mộc An', 'Mộc An', ['cat-baby', 'cat-recycled'], [('Vỉ 2 cây', {'count': '2'}, 49000)], 0),
    ('Kem đánh răng nuốt được cho bé Bé Na', 'Bé Na', ['cat-baby'], [('Tuýp 50g', {'size': '50g'}, 79000)], 0),
    # Mẹ bầu
    ('Dầu chống rạn da Visante', 'Visante', ['cat-mom', 'cat-skincare'], [('Chai 100ml', {'size': '100ml'}, 259000)], 10),
    ('Trà lợi sữa BH.Nong', 'BH.Nong', ['cat-mom', 'cat-food'], [('Hộp 30 gói', {'count': '30'}, 149000)], 0),
    ('Sữa tắm thảo dược sau sinh Cobote', 'Cobote', ['cat-mom'], [('Chai 300ml', {'size': '300ml'}, 169000)], 0),
    ('Xịt khoáng dịu da mẹ bầu Pơ Lang', 'Pơ Lang', ['cat-mom'], [('Chai 100ml', {'size': '100ml'}, 129000)], 0),
    ('Muối ngâm chân thảo dược Pơ Lang', 'Pơ Lang', ['cat-mom', 'cat-personal'], [('Hũ 500g', {'weight': '500g'}, 89000)], 15),
    ('Gối ôm bà bầu vỏ đậu xanh Mộc An', 'Mộc An', ['cat-mom', 'cat-home'], [('Size chữ U', {'size': 'U'}, 459000), ('Size chữ C', {'size': 'C'}, 389000)], 10),
    # Mỹ phẩm
    ('Sữa rửa mặt nghệ Visante', 'Visante', ['cat-skincare'], [('Tuýp 100ml', {'size': '100ml'}, 159000)], 0),
    ('Toner diếp cá Visante', 'Visante', ['cat-skincare'], [('Chai 150ml', {'size': '150ml'}, 189000)], 12),
    ('Mặt nạ bùn khoáng Pơ Lang', 'Pơ Lang', ['cat-skincare'], [('Hũ 100g', {'size': '100g'}, 139000)], 0),
    ('Tẩy da chết cà phê Đắk Lắk Le Plateau', 'Le Plateau Coffee', ['cat-skincare'], [('Hũ 200g', {'size': '200g'}, 119000)], 0),
    ('Kem dưỡng đêm sâm Visante', 'Visante', ['cat-skincare'], [('Hũ 50g', {'size': '50g'}, 399000)], 15),
    ('Serum tràm trà Visante', 'Visante', ['cat-skincare'], [('Chai 30ml', {'size': '30ml'}, 279000)], 0),
    ('Dầu tẩy trang olive Pơ Lang', 'Pơ Lang', ['cat-skincare'], [('Chai 150ml', {'size': '150ml'}, 159000)], 0),
    ('Xà bông nghệ mật ong Pơ Lang', 'Pơ Lang', ['cat-skincare', 'cat-personal'], [('Bánh 100g', {'weight': '100g'}, 55000), ('Hộp 3 bánh', {'count': '3'}, 149000)], 0),
    # Chăm sóc cá nhân
    ('Kem đánh răng than tre Hector', 'Hector', ['cat-personal'], [('Tuýp 150g', {'size': '150g'}, 69000)], 0),
    ('Bàn chải tre than hoạt tính Mộc An', 'Mộc An', ['cat-personal', 'cat-recycled'], [('Vỉ 4 cây', {'count': '4'}, 79000)], 10),
    ('Sữa tắm than tre Hector', 'Hector', ['cat-personal'], [('Chai 500ml', {'size': '500ml'}, 169000)], 0),
    ('Dầu xả bồ kết Pơ Lang', 'Pơ Lang', ['cat-personal'], [('Chai 300ml', {'size': '300ml'}, 135000)], 0),
    ('Xà bông sả chanh Pơ Lang', 'Pơ Lang', ['cat-personal'], [('Bánh 100g', {'weight': '100g'}, 49000)], 0),
    ('Nước súc miệng trà xanh Hector', 'Hector', ['cat-personal'], [('Chai 500ml', {'size': '500ml'}, 89000)], 12),
    ('Băng vệ sinh vải tái sử dụng Mộc An', 'Mộc An', ['cat-personal', 'cat-recycled'], [('Bộ 3 miếng', {'count': '3'}, 199000)], 0),
    ('Dao cạo râu thép không gỉ Hector', 'Hector', ['cat-personal'], [('Cán gỗ', {'color': 'gỗ'}, 349000), ('Cán đen', {'color': 'đen'}, 329000)], 0),
    # Cà phê & đồ uống
    ('Cà phê Culi rang mộc Le Plateau', 'Le Plateau Coffee', ['cat-coffee'], [('Gói 250g', {'weight': '250g'}, 125000), ('Gói 500g', {'weight': '500g'}, 235000)], 0),
    ('Cà phê Moka Cầu Đất Le Plateau', 'Le Plateau Coffee', ['cat-coffee'], [('Gói 250g', {'weight': '250g'}, 175000)], 10),
    ('Trà ô long Lâm Đồng BH.Nong', 'BH.Nong', ['cat-coffee'], [('Hộp 200g', {'weight': '200g'}, 189000)], 0),
    ('Ca cao nguyên chất Đắk Lắk Sokfram', 'Sokfram', ['cat-coffee', 'cat-food'], [('Hũ 250g', {'weight': '250g'}, 129000)], 0),
    ('Trà gạo lứt rang Sokfram', 'Sokfram', ['cat-coffee'], [('Túi 500g', {'weight': '500g'}, 69000)], 0),
    ('Cà phê muối hoà tan Le Plateau', 'Le Plateau Coffee', ['cat-coffee'], [('Hộp 10 gói', {'count': '10'}, 99000)], 15),
    # Nông sản & thực phẩm
    ('Mật ong hoa cà phê BH.Nong', 'BH.Nong', ['cat-food'], [('Chai 500ml', {'size': '500ml'}, 199000), ('Chai 1L', {'size': '1L'}, 369000)], 0),
    ('Bột ngũ cốc dinh dưỡng Sokfram', 'Sokfram', ['cat-food'], [('Hộp 500g', {'weight': '500g'}, 159000)], 10),
    ('Hạt mắc ca nứt vỏ BH.Nong', 'BH.Nong', ['cat-food'], [('Túi 500g', {'weight': '500g'}, 219000)], 0),
    ('Nấm linh chi đỏ thái lát BH.Nong', 'BH.Nong', ['cat-food'], [('Túi 250g', {'weight': '250g'}, 429000)], 0),
    ('Muối tôm Tây Ninh Sokfram', 'Sokfram', ['cat-food'], [('Hũ 200g', {'weight': '200g'}, 45000)], 0),
    ('Đường thốt nốt An Giang Sokfram', 'Sokfram', ['cat-food'], [('Túi 500g', {'weight': '500g'}, 65000)], 0),
    ('Yến mạch cán dẹt Sokfram', 'Sokfram', ['cat-food'], [('Túi 1kg', {'weight': '1kg'}, 109000)], 12),
    ('Tinh bột nghệ nguyên chất BH.Nong', 'BH.Nong', ['cat-food'], [('Hũ 100g', {'weight': '100g'}, 99000)], 0),
    # Nhà cửa & đời sống
    ('Hộp đựng thực phẩm sợi tre Mộc An', 'Mộc An', ['cat-home'], [('Bộ 3 hộp', {'count': '3'}, 189000)], 0),
    ('Khăn lau bếp sợi tre Mộc An', 'Mộc An', ['cat-home'], [('Cuộn 20 tờ', {'count': '20'}, 59000)], 10),
    ('Túi lưới đi chợ cotton Tre Việt', 'Tre Việt', ['cat-home', 'cat-recycled'], [('Bộ 3 túi', {'count': '3'}, 79000)], 0),
    ('Bình giữ nhiệt inox vỏ tre Tre Việt', 'Tre Việt', ['cat-home'], [('500ml', {'size': '500ml'}, 249000), ('750ml', {'size': '750ml'}, 289000)], 15),
    ('Nến thơm sáp đậu nành Pơ Lang', 'Pơ Lang', ['cat-home'], [('Hũ 150g', {'weight': '150g'}, 159000)], 0),
    ('Túi thơm quế hồi Tre Việt', 'Tre Việt', ['cat-home'], [('Bộ 3 túi', {'count': '3'}, 69000)], 0),
    ('Màng bọc thực phẩm sáp ong Mộc An', 'Mộc An', ['cat-home', 'cat-recycled'], [('Bộ 3 tấm', {'count': '3'}, 149000)], 10),
    ('Miếng rửa chén xơ mướp Tre Việt', 'Tre Việt', ['cat-home', 'cat-cleaning'], [('Gói 5 miếng', {'count': '5'}, 45000)], 0),
    # Đồ dùng tái chế
    ('Ống hút tre tái sử dụng Tre Việt', 'Tre Việt', ['cat-recycled'], [('Bộ 10 ống', {'count': '10'}, 59000)], 0),
    ('Túi tote vải bố tái chế Tre Việt', 'Tre Việt', ['cat-recycled'], [('Màu be', {'color': 'be'}, 99000), ('Màu xanh rêu', {'color': 'xanh rêu'}, 99000)], 0),
    ('Sổ tay giấy tái chế Mộc An', 'Mộc An', ['cat-recycled'], [('Khổ A5', {'size': 'A5'}, 55000)], 0),
    ('Chậu cây bã cà phê Tre Việt', 'Tre Việt', ['cat-recycled', 'cat-home'], [('Bộ 2 chậu', {'count': '2'}, 119000)], 10),
    ('Bộ dao muỗng nĩa tre du lịch Tre Việt', 'Tre Việt', ['cat-recycled'], [('Túi vải 4 món', {'count': '4'}, 89000)], 0),
    ('Hộp cơm lúa mạch Mộc An', 'Mộc An', ['cat-recycled', 'cat-home'], [('1 tầng', {'tier': '1'}, 129000), ('2 tầng', {'tier': '2'}, 169000)], 0),
    ('Thớt gỗ tái chế Mộc An', 'Mộc An', ['cat-recycled', 'cat-home'], [('Cỡ vừa', {'size': 'M'}, 159000)], 0),
    ('Cốc bã cà phê Tre Việt', 'Tre Việt', ['cat-recycled'], [('Cốc 350ml', {'size': '350ml'}, 129000)], 15),
]

def slugify(s):
    s = s.replace('đ', 'd').replace('Đ', 'D')
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = re.sub(r'[^a-zA-Z0-9]+', '-', s.lower()).strip('-')
    return s

def q(s):
    return "'" + str(s).replace("'", "''") + "'"

def arr(xs):
    return 'ARRAY[' + ','.join(q(x) for x in xs) + ']::text[]' if xs else "'{}'::text[]"

def ts(d):
    return q(d.strftime('%Y-%m-%d %H:%M:%S.000'))

def round_k(n):
    return int(round(n / 1000.0)) * 1000

def sold_dist():
    r = random.random()
    if r < 0.10: return random.randint(2000, 9800)
    if r < 0.30: return random.randint(500, 1999)
    if r < 0.65: return random.randint(50, 499)
    if r < 0.85: return random.randint(1, 49)
    return 0

REVIEWERS = ['Nguyễn Thu Hà', 'Trần Minh Anh', 'Lê Hoàng Nam', 'Phạm Ngọc Lan', 'Võ Thị Mai', 'Đặng Quốc Bảo', 'Bùi Thanh Tâm', 'Hồ Gia Hân',
             'Ngô Phương Thảo', 'Dương Khánh Linh', 'Huỳnh Đức Trí', 'Phan Thuỳ Dung', 'Trương Bảo Ngọc', 'Lý Minh Khoa', 'Đỗ Hải Yến',
             'Mai Anh Thư', 'Tạ Quang Huy', 'Châu Ngọc Trâm', 'Vũ Hồng Nhung', 'Lâm Tuấn Kiệt']
COMMENTS5 = ['Dùng rất thích, mùi dễ chịu, sẽ mua lại.', 'Giao nhanh, đóng gói cẩn thận. Sản phẩm đúng mô tả.', 'Lần thứ ba mua rồi, cả nhà đều ưng.',
             'Dịu nhẹ, không bị khô tay như loại cũ.', 'Giá hợp lý so với chất lượng, shop tư vấn nhiệt tình.', 'Hàng chuẩn, date mới, tặng kèm quà nhỏ dễ thương.']
COMMENTS4 = ['Sản phẩm tốt, chỉ là chai hơi nhỏ so với giá.', 'Ổn, mùi hơi nhẹ hơn mình nghĩ.', 'Dùng được, giao hàng hơi chậm một ngày.',
             'Chất lượng ổn, mong shop có thêm size lớn.']
COMMENTS3 = ['Tạm được, chưa thấy khác biệt nhiều.', 'Bao bì bị móp một chút khi nhận.']

out = []
out.append("BEGIN;")
out.append("INSERT INTO categories (id, \"parentId\", name, slug, image, \"sortOrder\") VALUES "
           "('cat-laundry', NULL, 'Giặt xả', 'giat-xa', NULL, 3), "
           "('cat-home', NULL, 'Nhà cửa & Đời sống', 'nha-cua-doi-song', NULL, 8), "
           "('cat-recycled', NULL, 'Đồ dùng tái chế', 'do-dung-tai-che', NULL, 9) ON CONFLICT (id) DO NOTHING;")
# Đẩy thứ tự danh mục cũ để Giặt xả nằm sau Tẩy rửa
out.append("UPDATE categories SET \"sortOrder\" = \"sortOrder\" + 1 WHERE id IN ('cat-baby','cat-mom','cat-personal','cat-coffee','cat-food');")
out.append("UPDATE categories SET \"sortOrder\" = 9 WHERE id = 'cat-home'; UPDATE categories SET \"sortOrder\" = 10 WHERE id = 'cat-recycled';")

# người đánh giá
for i, nm in enumerate(REVIEWERS):
    uid = f'seed7_rv_{i+1:02d}'
    out.append(f"INSERT INTO users (id, \"fullName\", role, \"referralCode\", \"createdAt\", \"updatedAt\") VALUES ({q(uid)}, {q(nm)}, 'CUSTOMER', {q('RV7' + str(i+1).zfill(3))}, {ts(NOW - datetime.timedelta(days=200))}, {ts(NOW)}) ON CONFLICT (id) DO NOTHING;")

products = []
featured_idx = set(random.sample(range(len(P)), 10))
new_idx = set(random.sample(range(len(P)), 16))
for i, (name, brand, cats, vars_, disc) in enumerate(P):
    slug = slugify(name)
    pid = f'p7-{slug}'[:60]
    created = NOW - (datetime.timedelta(days=random.randint(1, 26), hours=random.randint(0, 20)) if i in new_idx else datetime.timedelta(days=random.randint(40, 160)))
    vrows = []
    for j, (vn, attrs, price) in enumerate(vars_):
        sale = round_k(price * (100 - disc) / 100) if disc else None
        if sale is not None and sale >= price: sale = None
        sku = f'L7-{slug[:24].upper()}-{j+1}'
        vid = f'v7-{slug[:40]}-{j+1}'
        stock = random.choice([0, 8, 25, 60, 120, 200, 350]) if random.random() < 0.08 else random.randint(40, 400)
        vrows.append((vid, sku, vn, attrs, price, sale, stock))
    base = min(v[4] for v in vrows)
    sale_min = min((v[5] for v in vrows if v[5]), default=None)
    sold = sold_dist()
    products.append(dict(pid=pid, slug=slug, name=name, brand=brand, cats=cats, created=created, vrows=vrows, base=base, sale=sale_min, sold=sold,
                         featured=i in featured_idx, combo=name.startswith('Combo')))

for p in products:
    seg = sorted({s for c in p['cats'] for s in SEG[c]})
    desc = f"{p['name']} thuộc dòng sản phẩm xanh của {p['brand']}. Thành phần có nguồn gốc thiên nhiên, bao bì có thể tái chế. Bảo quản nơi khô ráo, tránh ánh nắng trực tiếp."
    short = f"Sản phẩm xanh của {p['brand']}, an toàn cho cả gia đình."
    out.append(
        "INSERT INTO products (id, \"pancakeId\", fulfilment, brand, \"brandId\", slug, name, description, \"shortDesc\", images, \"categoryIds\", tags, \"isActive\", \"isFeatured\", \"isCombo\", "
        "\"soldExternal\", \"basePrice\", \"salePrice\", \"forSegment\", certifications, \"approvalStatus\", \"createdAt\", \"updatedAt\") VALUES ("
        f"{q(p['pid'])}, {q('seed7-' + p['pid'])}, 'TUBU', {q(p['brand'])}, {q(BRANDS[p['brand']])}, {q(p['slug'])}, {q(p['name'])}, {q(desc)}, {q(short)}, '{{}}'::text[], {arr(p['cats'])}, {arr([p['brand'].lower()])}, true, "
        f"{'true' if p['featured'] else 'false'}, {'true' if p['combo'] else 'false'}, {p['sold']}, {p['base']}, {p['sale'] if p['sale'] else 'NULL'}, {arr(seg)}, '{{}}'::text[], 'APPROVED', {ts(p['created'])}, {ts(NOW)}) ON CONFLICT (id) DO NOTHING;")
    for (vid, sku, vn, attrs, price, sale, stock) in p['vrows']:
        out.append(
            "INSERT INTO variations (id, \"pancakeId\", \"productId\", sku, name, attributes, \"retailPrice\", \"salePrice\", stock, \"isActive\", weight) VALUES ("
            f"{q(vid)}, {q('seed7-' + sku)}, {q(p['pid'])}, {q(sku)}, {q(vn)}, {q(json.dumps(attrs, ensure_ascii=False))}::jsonb, {price}, {sale if sale else 'NULL'}, {stock}, true, 500) ON CONFLICT (id) DO NOTHING;")

# đánh giá: ~60% sản phẩm mới + một số sản phẩm cũ (theo slug)
OLD_RATED = ['nuoc-rua-chen-fuwa3e', 'nuoc-giat-fuwa3e', 'serum-duong-am-visante', 'dau-goi-buoi-po-lang', 'arabica-cau-dat-le-plateau', 'mat-ong-rung-bhnong',
             'dau-tram-be-cobote', 'nuoc-lau-san-fuwa3e', 'sua-tam-sa-po-lang', 'tinh-chat-vitamin-c-visante', 'gao-lut-huyet-rong-sokfram', 'nuoc-tay-trang-rau-ma-visante']
OLD_SOLD = {'nuoc-rua-chen-fuwa3e': 8650, 'nuoc-giat-fuwa3e': 5230, 'serum-duong-am-visante': 1840, 'dau-goi-buoi-po-lang': 2310, 'arabica-cau-dat-le-plateau': 960,
            'mat-ong-rung-bhnong': 1205, 'dau-tram-be-cobote': 3120, 'nuoc-lau-san-fuwa3e': 2780, 'sua-tam-sa-po-lang': 640, 'tinh-chat-vitamin-c-visante': 415,
            'gao-lut-huyet-rong-sokfram': 1530, 'nuoc-tay-trang-rau-ma-visante': 870, 'kem-chong-ham-cobote': 312, 'robusta-honey-le-plateau': 288,
            'hat-dieu-rang-moc-bhnong': 190, 'nuoc-rua-tay-fuwa3e': 1460, 'nuoc-rua-binh-sua-fuwa3e': 2045, 'sap-vuot-toc-hector': 77, 'son-duong-gac-visante': 530}
for slug, sold in OLD_SOLD.items():
    out.append(f"UPDATE products SET \"soldExternal\" = {sold} WHERE slug = {q(slug)};")

rated = [(p['pid'], None) for p in products if random.random() < 0.6] + [(None, s) for s in OLD_RATED]
rv_n = 0
for pid, slug in rated:
    n = random.randint(3, 28) if slug is None else random.randint(12, 45)
    target = pid if pid else f"(SELECT id FROM products WHERE slug = {q(slug)})"
    for k in range(n):
        r = random.random()
        rating = 5 if r < 0.68 else 4 if r < 0.92 else 3 if r < 0.98 else 2
        cm = random.choice(COMMENTS5 if rating == 5 else COMMENTS4 if rating == 4 else COMMENTS3) if random.random() < 0.75 else None
        uid = f'seed7_rv_{random.randint(1, 20):02d}'
        rv_n += 1
        created = NOW - datetime.timedelta(days=random.randint(1, 90), hours=random.randint(0, 23))
        tgt = q(pid) if pid else target
        out.append("INSERT INTO reviews (id, \"userId\", \"productId\", \"orderId\", rating, comment, images, \"isVerified\", \"isVisible\", \"createdAt\") VALUES ("
                   f"{q(f'rv7-{rv_n:05d}')}, {q(uid)}, {tgt}, {q(f'seed7-order-{rv_n:05d}')}, {rating}, {q(cm) if cm else 'NULL'}, '{{}}'::text[], true, true, {ts(created)}) ON CONFLICT DO NOTHING;")
out.append("UPDATE products p SET \"ratingAvg\" = s.avg, \"reviewCount\" = s.n FROM (SELECT \"productId\", AVG(rating)::float avg, COUNT(*)::int n FROM reviews WHERE \"isVisible\" GROUP BY 1) s WHERE s.\"productId\" = p.id;")
out.append("COMMIT;")
open('shop.sql', 'w').write('\n'.join(out) + '\n')
print('products', len(products), 'reviews', rv_n, 'variations', sum(len(p['vrows']) for p in products))
json.dump([{'pid': p['pid'], 'slug': p['slug'], 'vars': [(v[0], v[4], v[5], v[6]) for v in p['vrows']]} for p in products], open('products.json', 'w'), ensure_ascii=False, indent=0)
