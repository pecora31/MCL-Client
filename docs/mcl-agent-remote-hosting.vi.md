# MCL Agent: Host Từ Xa

Nếu bạn chạy server trên một VPS thật thay vì máy tính của mình, MCL Agent cho phép bạn quản lý server đó ngay trong cùng tab Host Server, bắt đầu, dừng, chỉnh cấu hình, đồng bộ mod, và xem console, mà không cần dùng SSH.

Agent là một chương trình nhỏ độc lập (`mcl-agent`), tách biệt khỏi ứng dụng desktop, chạy trên máy chủ từ xa. Nó dùng lại chính xác cùng một logic server mà ứng dụng desktop dùng khi host tại chỗ, được expose qua một API HTTPS.

## Mô hình bảo mật

Mỗi request cần một bearer token, được sinh ra ngay lần đầu agent chạy. API được phục vụ qua HTTPS bằng một chứng chỉ do agent tự sinh ra, vì không có domain hay bên cấp chứng chỉ (CA) nào tham gia. Vì chứng chỉ đó không có CA đứng sau, MCL không dùng theo mô hình tin cậy kiểu trình duyệt thông thường, thay vào đó bạn dán đúng chứng chỉ đó vào MCL một lần, giống như cách bạn dán token, và MCL chỉ tin đúng chứng chỉ cụ thể đó cho host đó. Đây gọi là ghim chứng chỉ (certificate pinning), và nó thay thế cho việc phải dùng SSH tunnel hay reverse proxy thủ công.

Hãy coi token và chứng chỉ cùng nhau tương đương với một SSH key, ai có cả hai đều có toàn quyền điều khiển server đó.

## Thiết lập agent trên VPS

Build trực tiếp trên VPS, hầu hết các nhà cung cấp VPS đều chạy Linux:

```bash
curl https://sh.rustup.rs -sSf | sh
sudo apt install -y build-essential cmake
git clone https://github.com/pecora31/MCL-Client.git
cd MCL-Client/src-tauri
cargo build --release --bin mcl-agent --features agent
./target/release/mcl-agent
```

Lần đầu chạy sẽ in ra ba thứ bạn cần:

* Địa chỉ đang lắng nghe
* Một bearer token
* Đường dẫn đến file chứng chỉ (`agent-cert.pem`)

Mở port mà nó in ra (`8642` mặc định) trong firewall của VPS và trong security group của nhà cung cấp nếu có, tách biệt với port của server Minecraft (`25565` mặc định, cũng cần mở để người chơi thực sự vào được). Java cũng cần được cài sẵn trên VPS, agent chỉ dùng bản Java có sẵn ở đó, nó không tự tải Java giống như ứng dụng desktop.

Để giữ agent chạy sau khi bạn đóng phiên SSH, và tự khởi động lại khi VPS reboot, hãy chạy agent như một systemd service thay vì chạy trực tiếp trong terminal. Hỏi trong issue hoặc discussion nếu bạn muốn có sẵn file unit mẫu.

## Thêm host trong MCL

Trong tab Host Server, đặt **Vị Trí** thành **Thêm host từ xa**, rồi điền vào:

* Tên cho host
* URL của nó, dạng `https://<địa-chỉ-vps>:8642`
* Bearer token mà nó in ra
* Toàn bộ nội dung file `agent-cert.pem`, mở file bằng lệnh như `cat agent-cert.pem` rồi copy toàn bộ, kể cả dòng `BEGIN CERTIFICATE` và `END CERTIFICATE`

Từ đó, việc thiết lập, bắt đầu, dừng, chỉnh cấu hình và xem console đều hoạt động giống hệt như [host tại chỗ](hosting-a-server-locally.md), chỉ là trỏ vào máy từ xa thay vì máy của bạn.

## Đồng bộ mod

Sau khi thiết lập server trên một host từ xa, MCL sẽ tải lên những mod jar mà profile đang chọn có nhưng agent chưa có. Dùng nút **Đồng Bộ Mod Lên Host Này** bất cứ khi nào bạn thêm mod vào profile sau này và muốn đưa chúng lên server. Việc này chỉ thêm file, không xoá mod trên server mà bạn đã gỡ khỏi profile, hãy tự xoá bằng tay nếu muốn server khớp chính xác.

## Nếu chứng chỉ thay đổi

Chứng chỉ của agent gắn liền với thư mục dữ liệu nơi nó được tạo ra. Nếu thư mục đó bị xoá, hoặc agent được trỏ sang một thư mục mới, nó sẽ tạo chứng chỉ mới, và chứng chỉ đã lưu trong MCL cho host đó sẽ không còn khớp nữa. Hãy xoá mục host cũ và thêm lại với chứng chỉ mới.
