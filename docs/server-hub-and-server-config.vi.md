# Quản Lý Server và Cấu Hình

## Server Hub

Tab Tổng Quan lưu lại danh sách server. Mỗi server được ping ngầm định kỳ, mỗi 60 giây cho toàn bộ danh sách, mỗi 30 giây cho server đang được chọn, hiển thị ping và số người chơi trực tiếp mà không cần mở game.

Bật **Tự Động Kết Nối Khi Chơi** cho một server sẽ khiến lần khởi chạy tiếp theo tự vào thẳng địa chỉ server đó, thay vì dừng ở màn hình chính.

## Cấu Hình Server

Cấu Hình Server, mở từ tab Thông Tin và Quản Lý Server, dùng để chỉnh file `server.properties` của một server đã tồn tại sẵn ở đâu đó trên máy. Tính năng này dành cho server bạn hoặc bạn bè đang chạy hoàn toàn bên ngoài MCL, chẳng hạn một máy chủ riêng hay máy tính của bạn bè, không phải server do MCL tự host. Dùng nút chọn thư mục để trỏ vào thư mục server đó một lần, sau đó MCL nhớ sẵn vài tuỳ chọn mà hầu hết các nhóm thực sự cần:

* **Online mode**, server có yêu cầu tài khoản Microsoft thật hay không. Tắt tuỳ chọn này nếu mọi người kết nối đều dùng tài khoản offline của MCL, nếu không sẽ không ai vào được và bạn sẽ thấy lỗi "Invalid session".
* **PvP**, người chơi có thể đánh nhau hay không.
* **Whitelist**, chỉ cho phép người chơi trong danh sách tham gia.
* **Difficulty**
* **Số người chơi tối đa**
* **MOTD**

Chỉ những dòng cụ thể này được ghi đè, mọi dòng và comment khác trong `server.properties` được giữ nguyên như cũ.

Nếu bạn muốn MCL tự tải, tự chạy và tự quản lý server thay vì chỉ chỉnh sửa một server đã có sẵn, xem [Host Trên Máy Của Bạn](hosting-a-server-locally.md) hoặc [MCL Agent: Host Từ Xa](mcl-agent-remote-hosting.md).
