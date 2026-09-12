# MCL Cloudflare Backend Architecture (Scenario B: D1 + R2)

Hướng dẫn thiết lập và tài liệu kỹ thuật cho hệ thống tài khoản định danh, đồng bộ skin và danh bạ phòng P2P của **MCL Client** sử dụng Cloudflare Serverless stack:
- **Cloudflare D1**: Cơ sở dữ liệu SQLite phân tán tại Edge (quản lý người dùng, mật khẩu đã mã hóa, quan hệ thiết bị, phiên đăng nhập).
- **Cloudflare R2**: Lưu trữ Object Storage tương thích S3 (lưu trữ file PNG Skin, không mất phí băng thông tải về - $0 Egress Fees).
- **Cloudflare Workers**: REST API siêu nhẹ xử lý xác thực, đăng nhập, tải skin và heartbeat phòng chơi.

---

## 1. Phân tích Chi Phí & Dung Lượng Thực Tế

### Gói Miễn Phí (Free Tier) Hàng Tháng:
- **Cloudflare D1**:
  - **Dung lượng lưu trữ**: 5 GB (hoàn toàn miễn phí).
  - **Lượt đọc (Reads)**: 5,000,000 lượt / ngày.
  - **Lượt ghi (Writes)**: 100,000 lượt / ngày.
  - *Đánh giá*: 1 tài khoản người dùng chỉ chiếm ~350 bytes trong D1. Với 5 GB, D1 có thể chứa tới hơn **10,000,000 tài khoản** mà không tốn 1 xu.
- **Cloudflare R2 (Lưu trữ Skin)**:
  - **Dung lượng lưu trữ**: 10 GB miễn phí mỗi tháng.
  - **Class A Operations (Upload/Write)**: 1,000,000 lượt / tháng miễn phí.
  - **Class B Operations (Download/Read)**: 10,000,000 lượt / tháng miễn phí.
  - **Egress Bandwidth (Lưu lượng tải ra ngoài)**: **$0.00 / GB (MIỄN PHÍ VĨNH VIỄN)**.
  - *Đánh giá*: 1 file Skin Minecraft 64x64 pixel có dung lượng trung bình chỉ **3 KB**.
    - 10 GB lưu trữ miễn phí = **~3,300,000 files skin độc lập** (có deduplication SHA-256 hash).

### Thiết Lập Hạn Mức Cảnh Báo 1$ (Billing Notification):
Vì bạn đã add thẻ thanh toán vào Cloudflare, để đảm bảo tuyệt đối không phát sinh chi phí bất ngờ:
1. Truy cập **Cloudflare Dashboard** -> **Manage Account** -> **Billing**.
2. Chọn **Notifications** -> **Add Notification**.
3. Chọn loại cảnh báo: **Billing Usage Alert** hoặc **Budget Alert**.
4. Đặt ngưỡng (Threshold): `$1.00 USD`.
5. Điền Email nhận thông báo ngay khi vượt quá ngưỡng.

---

## 2. Cấu Trúc Bảng D1 Database (`d1-schema.sql`)

Schema đã được khởi tạo tại file [`d1-schema.sql`](./d1-schema.sql) gồm 5 bảng:
1. `users`: Lưu trữ thông tin tài khoản (UUID, username chữ hoa/thường không phân biệt, email khôi phục, mật khẩu mã hóa salt + hash, skin hash hiện tại).
2. `user_nodes`: Lưu trữ các định danh phần cứng/thiết bị (Ed25519 public key từ `AppData` của iroh) liên kết với tài khoản.
3. `skins`: Quản lý kho skin R2 (deduplication theo mã băm SHA-256, model classic/slim).
4. `auth_sessions`: Quản lý token phiên đăng nhập (Bearer Token, thời hạn hết hạn).
5. `p2p_rooms`: Bảng danh bạ phòng trực tuyến hỗ trợ người chơi tìm thấy phòng bạn bè nhanh chóng (tự động xóa sau 60s không có heartbeat).

---

## 3. Các Bước Triển Khai Cloudflare Worker & D1

### Bước 1: Khởi tạo Database D1 qua CLI Wrangler
```bash
npm install -g wrangler
wrangler login

# Tạo database D1 tên "mcl-auth-db"
wrangler d1 create mcl-auth-db
```
Wrangler sẽ in ra thông tin `database_id`, bạn sao chép vào file `wrangler.toml`:
```toml
name = "mcl-auth-worker"
main = "src/index.ts"
compatibility_date = "2024-09-01"

[[d1_databases]]
binding = "DB"
database_name = "mcl-auth-db"
database_id = "<DATABASE_ID_CUA_BAN>"

[[r2_buckets]]
binding = "SKIN_BUCKET"
bucket_name = "mcl-skins"
```

### Bước 2: Tạo Bucket R2
```bash
wrangler r2 bucket create mcl-skins
```

### Bước 3: Nạp Schema SQL vào D1
```bash
wrangler d1 execute mcl-auth-db --file=tools/worker-schemas/d1-schema.sql --remote
```

### Bước 4: Deploy Worker
```bash
wrangler deploy
```

---

## 4. Đặc tả API Endpoints

### 1. `POST /api/auth/register`
- **Body**: `{ "username": "Steve_Pro", "password": "FreestylePassword123", "nodeId": "0c8da..." }`
- **Xử lý**: Kiểm tra username hợp lệ (3-16 ký tự Minecraft), băm mật khẩu bằng PBKDF2/Argon2 + random salt, lưu vào D1.

### 2. `POST /api/auth/login`
- **Body**: `{ "username": "Steve_Pro", "password": "FreestylePassword123" }`
- **Trả về**: `{ "token": "mcl_bearer_...", "user": { "id": "...", "username": "Steve_Pro", "skinUrl": "..." } }`

### 3. `PUT /api/user/skin`
- **Header**: `Authorization: Bearer <token>`
- **Body**: File nhị phân PNG hoặc Base64.
- **Xử lý**: Kiểm tra kích thước (64x64 hoặc 64x32), tính SHA-256 hash, lưu vào R2 bucket `mcl-skins/skins/{hash}.png`, cập nhật `skin_hash` của user trong D1.

### 4. `GET /api/user/:username/skin.png`
- **Trả về**: Ảnh PNG skin trực tiếp từ Cloudflare Cache / R2 với tốc độ CDN toàn cầu.
