# Skin Studio

Skin Studio cho bạn xem trước skin dạng 3D bằng WebGL, hỗ trợ cả hai dạng mô hình Classic và Slim, để bạn thấy trước skin trông thế nào trước khi vào thế giới.

## Đồng bộ skin cho đồng đội

Việc đồng bộ skin nhiều người chơi hoạt động thông qua CustomSkinLoader, một mod mà MCL tự cài trên mọi profile không phải Vanilla, cùng một dịch vụ tra cứu skin nhỏ do MCL vận hành. Khi bạn đặt một skin:

1. MCL lưu skin đó vào bộ nhớ đệm riêng của CustomSkinLoader, để áp dụng ngay cho bạn.
2. Nếu tuỳ chọn **Chia Sẻ Skin Của Tôi** đang bật, MCL tải skin đó lên dịch vụ tra cứu, gắn theo tên người chơi trong game của bạn.
3. Bất kỳ ai khác đang dùng MCL (hoặc CustomSkinLoader thuần được cấu hình tương tự) sẽ tra ra skin của bạn bằng chính tên người chơi đó, nên họ thấy được skin mà bạn không cần làm gì thêm.

Tắt **Chia Sẻ Skin Của Tôi** trong [Cài Đặt](settings.md) sẽ xoá mọi bản đã đăng trước đó, giữ skin chỉ hiển thị trên máy bạn từ lúc đó trở đi.

## Giới hạn với profile Vanilla

Skin tuỳ chỉnh không đồng bộ trên profile Vanilla. CustomSkinLoader chỉ được cài trên profile Fabric, Forge, NeoForge và Quilt, vì bản thân nó là một mod, nên profile Vanilla không có cách nào tra được skin tuỳ chỉnh của người khác, cũng như đăng skin của mình cho người khác thấy. Đây là giới hạn của bản thân Minecraft, không phải lỗi, hãy đổi profile sang một mod loader nếu bạn quan tâm đến việc đồng bộ skin với đồng đội.

## Tên người chơi và việc tra skin

Vì dịch vụ tra cứu dựa theo tên người chơi, và tài khoản MCL là tài khoản offline (không cần đăng nhập Microsoft), về lý thuyết hai người chơi khác nhau có thể trùng tên hiển thị. MCL kiểm tra xem tên có đang bị người khác dùng hay không ngay khi bạn gõ đổi tên, và cảnh báo nếu trùng, cho phép bạn vẫn lưu hoặc chọn tên khác. Đây chỉ là cảnh báo nhẹ chứ không chặn hẳn, vì trùng tên chỉ ảnh hưởng đến việc đồng bộ skin đối với những người dùng tên đó, không ảnh hưởng gì khác.
