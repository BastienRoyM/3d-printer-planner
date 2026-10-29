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
            let names: Vec<String> = std::fs::read_dir(&dir)
                .map(|entries| {
                    entries
                        .filter_map(Result::ok)
                        .map(|e| e.file_name().to_string_lossy().into_owned())
                        .collect()
                })
                .unwrap_or_default();
            let found = pick_slicer_exe(&names).map(|n| dir.join(n));
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

#[cfg_attr(not(windows), allow(dead_code))]
/// Picks the slicer program among an install folder's file names, skipping uninstallers.
pub fn pick_slicer_exe<S: AsRef<str>>(names: &[S]) -> Option<&str> {
    names.iter().map(AsRef::as_ref).find(|n| {
        let lower = n.to_lowercase();
        lower.ends_with(".exe") && lower.contains("slicer") && !lower.starts_with("unins")
    })
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
        // Explorer needs the path quoted after "/select," rather than the whole argument quoted.
        use std::os::windows::process::CommandExt;
        spawn(Command::new("explorer").raw_arg(format!("/select,\"{}\"", file.display())))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_slicer_exe_skips_uninstaller() {
        let names = [
            "Uninstall ElegooSlicer.exe",
            "unins000.exe",
            "ElegooSlicer-app.exe",
            "readme.txt",
        ];
        assert_eq!(pick_slicer_exe(&names), Some("ElegooSlicer-app.exe"));
        assert_eq!(pick_slicer_exe(&["unins000.exe"]), None);
    }
}
