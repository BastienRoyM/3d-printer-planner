import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Moon, Sun } from "lucide-react";
import { errorText, moveLibrary, setSetting, type AppInfo } from "../api";
import { Modal } from "./Modal";
import { useToast } from "./Toast";

const isWindows = navigator.userAgent.includes("Windows");

export function SettingsDialog({ info, onChanged, onClose }: {
  info: AppInfo;
  onChanged: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [moving, setMoving] = useState(false);

  const pickSlicer = async () => {
    const path = await open({
      multiple: false,
      directory: false,
      title: "Choose your slicer",
      filters: isWindows ? [{ name: "Programs", extensions: ["exe"] }] : undefined,
    });
    if (typeof path === "string") {
      await setSetting("slicer_path", path);
      onChanged();
    }
  };

  const resetSlicer = async () => {
    await setSetting("slicer_path", "");
    onChanged();
  };

  const pickLibrary = async () => {
    const dir = await open({ directory: true, multiple: false, title: "Choose an empty folder for the library" });
    if (typeof dir !== "string") return;
    setMoving(true);
    try {
      const res = await moveLibrary(dir);
      toast(`Library moved to ${res.libraryPath}`);
      if (res.warning) toast(res.warning, "error");
      onChanged();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setMoving(false);
    }
  };

  const setTheme = async (theme: "dark" | "light") => {
    await setSetting("theme", theme);
    onChanged();
  };

  const slicer = info.slicerPath ?? info.detectedSlicer;

  return (
    <Modal title="Settings" onClose={onClose}>
      <section className="setting">
        <div>
          <h3>Slicer</h3>
          <p className="muted path">
            {slicer ?? "None found. Files will open in their default app."}
            {!info.slicerPath && info.detectedSlicer && <span className="tag">Detected</span>}
          </p>
        </div>
        <div className="row">
          {info.slicerPath && <button className="btn ghost" onClick={resetSlicer}>Use detected</button>}
          <button className="btn" onClick={pickSlicer}>Choose slicer…</button>
        </div>
      </section>

      <section className="setting">
        <div>
          <h3>Library folder</h3>
          <p className="muted path">{info.libraryPath}</p>
          <p className="hint">Moving it takes all your files and progress along. Pick an empty folder, for example inside OneDrive for backup.</p>
        </div>
        <button className="btn" onClick={pickLibrary} disabled={moving}>
          <FolderOpen size={16} /> {moving ? "Moving…" : "Move library…"}
        </button>
      </section>

      <section className="setting">
        <div><h3>Theme</h3></div>
        <div className="segmented" role="radiogroup" aria-label="Theme">
          <button role="radio" aria-checked={info.theme === "dark"} onClick={() => setTheme("dark")}>
            <Moon size={14} /> Dark
          </button>
          <button role="radio" aria-checked={info.theme === "light"} onClick={() => setTheme("light")}>
            <Sun size={14} /> Light
          </button>
        </div>
      </section>
    </Modal>
  );
}
