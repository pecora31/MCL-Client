use std::ffi::OsStr;
use std::process::Command;

/// A `Command` that never opens a console window.
///
/// Every tool this launcher runs — `java -version`, `where.exe`, `taskkill`, the game itself —
/// is a console program. A release build is a GUI app with no console of its own, so on Windows
/// each of those calls would otherwise flash a terminal window on screen; the Java scan alone
/// runs one per installed Java, both at startup and when a game is launched.
pub fn hidden_command(program: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}
