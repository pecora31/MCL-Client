# Khắc Phục Sự Cố và FAQ

## "Failed to log in: Invalid session" khi tham gia server

Server đang bật **online mode**, yêu cầu tài khoản Microsoft thật. Tài khoản MCL mặc định là offline, nên nếu cả nhóm đều dùng tài khoản offline, hãy tắt online mode trên server, qua [Cấu Hình Server](server-hub-and-server-config.md) nếu đó là server đã có sẵn, hoặc bảng cài đặt trong [Host Server](hosting-a-server-locally.md) nếu MCL đang tự chạy server đó.

## Skin của tôi không hiện cho người khác thấy

Kiểm tra xem profile đang dùng loader nào. Skin tuỳ chỉnh chỉ đồng bộ trên profile Fabric, Forge, NeoForge và Quilt, profile Vanilla hoàn toàn không có cách nào tra hay đăng skin tuỳ chỉnh, xem [Skin Studio](skin-studio.md) để biết lý do. Nếu profile đã dùng một trong các loader trên, hãy chắc chắn **Chia Sẻ Skin Của Tôi** đang bật trong Cài Đặt.

## Tôi ping được server trong MCL nhưng không vào được

Ping chỉ cần server phản hồi, còn vào game cần xác thực thành công, nên trường hợp này thường quay lại vấn đề online mode ở trên chứ không phải do kết nối mạng.

## Bạn bè trong cùng mạng không kết nối được server tôi đang host

Kiểm tra xem port hiển thị trong tab Host Server, mặc định `25565`, có bị Windows Firewall hoặc router chặn không. Nếu kết nối qua một công cụ như Radmin VPN, dùng địa chỉ hiển thị trong adapter Radmin, không phải địa chỉ MCL hiển thị cho việc host tại chỗ.

## Tôi có thể host server với những loader nào?

Vanilla, Fabric, Quilt, Forge và NeoForge, cả khi [host tại chỗ](hosting-a-server-locally.md) lẫn qua [MCL Agent](mcl-agent-remote-hosting.md).

## MCL Agent không khởi động được, báo lỗi về crypto provider

Nghĩa là bản build đang thiếu phần TLS backend. Build lại bằng `cargo build --release --bin mcl-agent --features agent`, feature `agent` sẽ kéo theo mọi thứ mà phần chứng chỉ và TLS cần.

## Tôi làm mất chứng chỉ hoặc token của một host từ xa

Đọc lại output console của agent sẽ không hiện lại token hay chứng chỉ lần thứ hai trong một số cách thiết lập, nhưng cả hai đều được lưu vào file trong thư mục dữ liệu của agent (`agent-token.txt` và `agent-cert.pem`), mở trực tiếp các file đó trên VPS nếu cần xem lại.

## Tôi báo lỗi hoặc hỏi thêm điều gì đó chưa có ở đây thì ở đâu?

Mở một [issue](https://github.com/pecora31/MCL-Client/issues) trên repository.
