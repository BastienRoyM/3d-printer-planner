import { useEffect, useState } from "react";
import { Box } from "lucide-react";
import { fileName, readModel, saveThumbnail, type Item } from "../api";
import { embeddedThumbnail } from "../lib/threemf";
import { modelExt, renderThumbnail } from "../lib/thumbnail";

// Renders one thumbnail at a time so a big drop does not freeze the UI.
let chain: Promise<unknown> = Promise.resolve();
// One render per item, shared by every mounted thumbnail of that item.
const renders = new Map<number, Promise<string | null>>();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = chain.then(job, job);
  chain = next.catch(() => undefined);
  return next;
}

export function Thumbnail({ item, size = "md" }: { item: Item; size?: "sm" | "md" | "lg" }) {
  const [src, setSrc] = useState(item.thumbnail);
  const original = item.files.find((f) => f.isOriginal) ?? item.files[0];
  const name = original ? fileName(original.relPath) : "";
  const ext = modelExt(name);
  // 3MF files (sliced ones too) usually carry the slicer's own preview: show it like Explorer does.
  const embedded = name.toLowerCase().endsWith(".3mf");

  useEffect(() => setSrc(item.thumbnail), [item.thumbnail]);

  useEffect(() => {
    if (src || !(ext || embedded)) return;
    let job = renders.get(item.id);
    if (!job) {
      job = enqueue(async () => {
        const bytes = await readModel(item.id);
        const url = (embedded ? await embeddedThumbnail(bytes) : null) ?? (ext ? await renderThumbnail(bytes, ext) : null);
        if (!url) return null;
        await saveThumbnail(item.id, url);
        return url;
      }).catch((e) => {
        console.warn("thumbnail failed", item.name, e);
        return null;
      });
      renders.set(item.id, job);
    }
    let alive = true;
    job.then((url) => alive && url && setSrc(url));
    return () => {
      alive = false;
    };
  }, [item.id, item.name, src, ext, embedded]);

  return (
    <div className={`thumb thumb-${size}`}>
      {src ? <img src={src} alt="" draggable={false} /> : <Box size={size === "lg" ? 40 : 22} />}
    </div>
  );
}
