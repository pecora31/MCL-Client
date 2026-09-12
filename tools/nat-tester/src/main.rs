use anyhow::{Context, Result};
use base64::prelude::*;
use iroh::{
    endpoint::Connection,
    Endpoint, NodeAddr,
};
use std::{env, time::{Duration, Instant}};

const ALPN: &[u8] = b"mcl/nat-test/v1";

#[tokio::main]
async fn main() -> Result<()> {
    println!("============================================================");
    println!("   MCL NAT Traversal Diagnostic Tool (PoC)");
    println!("   Hà Nội <---> TP. Hồ Chí Minh P2P Direct Connectivity Test");
    println!("============================================================\n");

    let args: Vec<String> = env::args().collect();
    let mode = if args.len() >= 2 {
        args[1].as_str()
    } else {
        ""
    };

    match mode {
        "host" => run_host().await?,
        "join" => {
            let ticket = if args.len() >= 3 && !args[2].trim().is_empty() {
                args[2].clone()
            } else {
                println!("Nhap hoac Dan (Paste) ma Ticket cua Host vao day:");
                let mut input = String::new();
                std::io::stdin().read_line(&mut input)?;
                input.trim().to_string()
            };

            if ticket.trim().is_empty() {
                println!("❌ Loi: Ma Ticket bi trong!");
                print_usage();
                return Ok(());
            }
            run_client(&ticket).await?;
        }
        _ => {
            println!("Chon che do chay:");
            println!("  [1] Lam Host");
            println!("  [2] Lam Client (Join bang Ticket)");
            println!();
            print!("Lua chon cua ban (1 hoac 2): ");
            use std::io::Write;
            std::io::stdout().flush().ok();

            let mut choice = String::new();
            std::io::stdin().read_line(&mut choice)?;
            match choice.trim() {
                "1" => run_host().await?,
                "2" => {
                    println!("\nDan (Paste) ma Ticket cua Host vao day roi an Enter:");
                    let mut ticket = String::new();
                    std::io::stdin().read_line(&mut ticket)?;
                    if ticket.trim().is_empty() {
                        println!("❌ Loi: Ma Ticket bi trong!");
                        return Ok(());
                    }
                    run_client(ticket.trim()).await?;
                }
                _ => {
                    print_usage();
                }
            }
        }
    }

    println!("\nNhan Enter de thoat...");
    let mut exit_buf = String::new();
    std::io::stdin().read_line(&mut exit_buf).ok();

    Ok(())
}

fn print_usage() {
    println!("Cách sử dụng:");
    println!("  1. Máy làm Host (ví dụ: Hà Nội):");
    println!("     nat-tester.exe host\n");
    println!("  2. Máy tham gia (ví dụ: TP.HCM):");
    println!("     nat-tester.exe join <CHUOIX_TICKET_HOAC_NODE_ADDR>\n");
}

async fn run_host() -> Result<()> {
    println!("⏳ Đang khởi tạo iroh Endpoint và phân tích NAT router cục bộ...");
    let endpoint = Endpoint::builder()
        .alpns(vec![ALPN.to_vec()])
        .bind()
        .await
        .context("Không thể khởi tạo P2P Endpoint")?;

    // Đợi endpoint hoàn tất discovery STUN / DERP
    println!("📡 Đang liên lạc STUN servers để giải mã IP WAN & loại NAT...");
    tokio::time::sleep(Duration::from_millis(1200)).await;

    let node_addr = endpoint.node_addr().await?;
    let ticket_json = serde_json::to_string(&node_addr)?;
    let ticket_b64 = BASE64_URL_SAFE_NO_PAD.encode(ticket_json.as_bytes());

    println!("\n============================================================");
    println!("🎉 HOST ĐÃ SẴN SÀNG! HÃY GỬI MÃ NÀY CHO BẠN Ở TP.HCM:");
    println!("============================================================");
    println!("\n{}\n", ticket_b64);
    println!("============================================================");
    println!("Địa chỉ Node ID: {}", node_addr.node_id);
    println!("Direct IP socket phát hiện được: {:?}", node_addr.direct_addresses);
    println!("Đang lắng nghe kết nối từ bạn của bạn...\n");

    while let Some(incoming) = endpoint.accept().await {
        let connecting = match incoming.accept() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("⚠️ Lỗi bắt tay: {:?}", e);
                continue;
            }
        };

        println!("⚡ Đang có kết nối gửi tới... Bắt đầu đục lỗ NAT (UDP Hole Punching)!");
        let connection = match connecting.await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("❌ Kết nối thất bại: {:?}", e);
                continue;
            }
        };

        let remote_node = connection.remote_node_id()?;
        println!("✅ BẮT TAY THÀNH CÔNG VỚI NODE: {}", remote_node);

        // Chạy task phân tích đường truyền
        let conn_clone = connection.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_diagnostics(conn_clone, true).await {
                eprintln!("❌ Lỗi phiên chẩn đoán: {:?}", e);
            }
        });
    }

    Ok(())
}

async fn run_client(ticket_str: &str) -> Result<()> {
    println!("⏳ Đang giải mã Ticket kết nối...");
    let json_bytes = BASE64_URL_SAFE_NO_PAD.decode(ticket_str.trim().as_bytes())
        .context("Mã Ticket không hợp lệ! Hãy kiểm tra xem có copy thiếu ký tự nào không.")?;
    let remote_addr: NodeAddr = serde_json::from_slice(&json_bytes)
        .context("Không thể phân tích dữ liệu NodeAddr từ Ticket")?;

    println!("🎯 Tìm thấy máy chủ Host:");
    println!("   Node ID: {}", remote_addr.node_id);
    println!("   Direct IPs: {:?}", remote_addr.direct_addresses);

    println!("⏳ Đang khởi tạo P2P Endpoint trên máy này...");
    let endpoint = Endpoint::builder()
        .alpns(vec![ALPN.to_vec()])
        .bind()
        .await
        .context("Không thể khởi tạo P2P Endpoint")?;

    println!("🚀 Đang thực hiện kết nối & đục lỗ NAT P2P tới Host...");
    let start_conn = Instant::now();
    let connection = endpoint.connect(remote_addr, ALPN).await
        .context("Kết nối tới Host thất bại")?;

    println!("✅ ĐÃ KẾT NỐI THÀNH CÔNG sau {:?}", start_conn.elapsed());

    handle_diagnostics(connection, false).await?;

    Ok(())
}

async fn handle_diagnostics(connection: Connection, is_host: bool) -> Result<()> {
    println!("\n------------------------------------------------------------");
    println!("📊 BẮT ĐẦU ĐO ĐẠC & KIỂM TRA ĐƯỜNG TRUYỀN P2P (NAT TRAVERSAL)");
    println!("------------------------------------------------------------");

    if !is_host {
        // Client mở bidirectional stream để test echo RTT
        let (mut send, mut recv) = connection.open_bi().await?;
        println!("🚀 Đang gửi 10 gói tin ping RTT liên tiếp...");

        let mut rtts = Vec::new();
        for i in 1..=10 {
            let start = Instant::now();
            let msg = format!("PING_{}", i);
            send.write_all(msg.as_bytes()).await?;

            let mut buf = [0u8; 64];
            let n = recv.read(&mut buf).await?.unwrap_or(0);
            let rtt = start.elapsed();
            rtts.push(rtt.as_secs_f64() * 1000.0);

            let resp = String::from_utf8_lossy(&buf[..n]);
            println!("   Gói #{:02}: Phản hồi '{}' -> RTT (Ping): {:.2} ms", i, resp, rtt.as_secs_f64() * 1000.0);
            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        let avg_rtt: f64 = rtts.iter().sum::<f64>() / (rtts.len() as f64);
        let min_rtt = rtts.iter().cloned().fold(f64::INFINITY, f64::min);
        let max_rtt = rtts.iter().cloned().fold(0.0, f64::max);

        println!("\n📈 KẾT QUẢ PING (RTT) GIỮA HÀ NỘI & TP.HCM:");
        println!("   - Ping trung bình : {:.2} ms", avg_rtt);
        println!("   - Ping thấp nhất  : {:.2} ms", min_rtt);
        println!("   - Ping cao nhất   : {:.2} ms", max_rtt);

        if avg_rtt < 45.0 {
            println!("   🌟 ĐÁNH GIÁ: ĐƯỜNG TRUYỀN P2P TRỰC TIẾP SIÊU TỐT! (Hà Nội - Sài Gòn quang chuẩn ~25-35ms)");
            println!("   -> Chơi Minecraft sẽ cực kỳ mượt, không hề có cảm giác delay!");
        } else if avg_rtt < 90.0 {
            println!("   ⚡ ĐÁNH GIÁ: ĐƯỜNG TRUYỀN KHÁ TỐT (P2P hoặc Relay nội địa tốc độ cao).");
        } else {
            println!("   ℹ️ ĐÁNH GIÁ: Ping hơi cao (>90ms), có thể đang đi qua relay trung gian hoặc mạng Wi-Fi chập chờn.");
        }

        println!("\nThử nghiệm hoàn tất! Nhấn Ctrl+C để thoát.");
    } else {
        // Host lắng nghe và Echo ngược lại
        println!("👂 Host đang nhận luồng Stream và Echo phản hồi cho Client...");
        let (mut send, mut recv) = connection.accept_bi().await?;
        let mut count = 0;
        let mut buf = [0u8; 64];
        while let Ok(Some(n)) = recv.read(&mut buf).await {
            if n == 0 { break; }
            count += 1;
            let req = String::from_utf8_lossy(&buf[..n]);
            let reply = format!("PONG_{}", count);
            send.write_all(reply.as_bytes()).await?;
            println!("   [Echo] Nhận '{}' -> Đã gửi lại '{}'", req, reply);
            if count >= 10 {
                break;
            }
        }
        println!("\n✅ Host đã phục vụ xong 10 lượt ping từ bạn ở TP.HCM!");
        println!("Đang duy trì kết nối... Nhấn Ctrl+C để đóng.");
    }

    // Giữ kết nối sống
    loop {
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}
