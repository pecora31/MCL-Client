# Bắt Đầu

## Đối với người chơi

**Yêu cầu:** Windows 10 hoặc 11 (64 bit). Không cần cài gì thêm, launcher tự tải phiên bản Java mà mỗi profile cần.

1. Vào [trang Releases](https://github.com/pecora31/MCL-Client/releases) và tải bản `.msi` hoặc `.exe` mới nhất.
2. Chạy trình cài đặt. Không cần tài khoản, không cần đăng nhập, không cần cấu hình thêm.
3. Mở MCL Client và làm theo hướng dẫn ban đầu ngắn gọn để chọn ngôn ngữ và tạo profile người chơi.
4. Xem [Tạo Profile](creating-a-profile.md) để thiết lập bản cài Minecraft đầu tiên.

Launcher tự kiểm tra cập nhật và không thu thập dữ liệu phân tích nào. Xem [PRIVACY.md](https://github.com/pecora31/MCL-Client/blob/main/PRIVACY.md) để biết chính xác những request mạng mà launcher thực hiện.

## Đối với lập trình viên

**Yêu cầu**

| Công cụ | Phiên bản |
|------|---------|
| Node.js | 18 trở lên |
| Rust và Cargo | 1.77 trở lên |
| Java (tuỳ chọn, để test) | 21 LTS |

Cài Rust qua [rustup.rs](https://rustup.rs/) nếu bạn chưa có.

**Clone và chạy**

```bash
git clone https://github.com/pecora31/MCL-Client.git
cd MCL-Client
npm install
npm run tauri dev
```

Nếu chỉ muốn làm việc với giao diện, không cần build phần Rust:

```bash
npm run dev
```

Sau đó mở `http://localhost:5173`. Ở chế độ này, các Tauri command được giả lập sẵn để app vẫn dùng được, xem `src/services/api.ts` để biết mỗi lệnh giả lập trả về gì.

**Build bản cài đặt**

```bash
npm run tauri build
```

File `.msi` và `.exe` sẽ nằm trong `src-tauri/target/release/bundle/`.

**Cấu trúc dự án**

```
MCL/
├── src/                  # Giao diện React
│   ├── components/       # Thành phần UI, chia theo tính năng
│   ├── locales/          # Chuỗi dịch cho cả 8 ngôn ngữ
│   ├── services/         # Wrapper gọi Tauri command
│   └── types/            # Kiểu TypeScript dùng chung
├── src-tauri/            # Backend Rust
│   ├── src/
│   │   ├── lib.rs        # Đăng ký Tauri command
│   │   ├── bin/          # Binary MCL Agent độc lập
│   │   └── minecraft_core/  # Logic phiên bản, loader và khởi chạy game
│   └── tauri.conf.json
└── public/
```

Xem [Tech stack](https://github.com/pecora31/MCL-Client#tech-stack) trong README để biết đầy đủ danh sách thư viện sử dụng.
