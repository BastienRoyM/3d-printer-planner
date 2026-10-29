use std::path::{Path, PathBuf};
use std::process::Command;

use crate::error::{AppError, AppResult};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Looks for ElegooSlicer in its usual install locations.
pub fn detect() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let bases = ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"]
            .iter()
            .filter_map(|v| std::env::var_os(v).map(PathBuf::from))
            .chain(std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("Programs")));
        for base in bases {
            let dir = base.join("ElegooSlicer");
            for exe in ["elegoo-slicer.exe", "ElegooSlicer.exe"] {
                if dir.join(exe).is_file() {
                    return Some(dir.join(exe));
                }
            }
            let found = std::fs::read_dir(&dir).ok().and_then(|entries| {
                entries.filter_map(Result::ok).map(|e| e.path()).find(|p| {
                    let name = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                    name.ends_with(".exe") && name.contains("slicer")
                })
            });
            if found.is_some() {
                return found;
            }
        }
        None
    }
    #[cfg(target_os = "macos")]
    {
        let app = PathBuf::from("/Applications/ElegooSlicer.app");
        app.exists().then_some(app)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        None
    }
}

fn spawn(cmd: &mut Command) -> AppResult<()> {
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| AppError::Invalid(format!("could not start the slicer: {e}")))
}

/// Opens `file` in the slicer, or with the system default app when no slicer is set.
pub fn launch(slicer: Option<&Path>, file: &Path) -> AppResult<()> {
    if !file.exists() {
        return Err(AppError::NotFound(format!(
            "{} is missing from the library",
            file.display()
        )));
    }
    match slicer {
        Some(s) if s.extension().is_some_and(|e| e == "app") => {
            spawn(Command::new("open").arg("-a").arg(s).arg(file))
        }
        Some(s) => spawn(Command::new(s).arg(file)),
        None => open_default(file),
    }
}

fn open_default(file: &Path) -> AppResult<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        spawn(
            Command::new("cmd")
                .args(["/C", "start", ""])
                .arg(file)
                .creation_flags(CREATE_NO_WINDOW),
        )
    }
    #[cfg(target_os = "macos")]
    {
        spawn(Command::new("open").arg(file))
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        spawn(Command::new("xdg-open").arg(file))
    }
}

/// Shows the file selected in Explorer / Finder.
pub fn reveal(file: &Path) -> AppResult<()> {
    #[cfg(windows)]
    {
        let mut arg = std::ffi::OsString::from("/select,");
        arg.push(file);
        spawn(Command::new("explorer").arg(arg))
    }
    #[cfg(target_os = "macos")]
    {
        spawn(Command::new("open").arg("-R").arg(file))
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        spawn(Command::new("xdg-open").arg(file.parent().unwrap_or(file)))
    }
}
