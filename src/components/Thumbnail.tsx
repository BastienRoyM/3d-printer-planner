import { useEffect, useState } from "react";
import { Box } from "lucide-react";
import { fileName, readModel, saveThumbnail, type Item } from "../api";
import { renderThumbnail, thumbExt } from "../lib/thumbnail";

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
  const ext = original ? thumbExt(fileName(original.relPath)) : null;

  useEffect(() => setSrc(item.thumbnail), [item.thumbnail]);

  useEffect(() => {
    if (src || !ext) return;
    let job = renders.get(item.id);
    if (!job) {
      job = enqueue(async () => {
        const url = await renderThumbnail(await readModel(item.id), ext);
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
  }, [item.id, item.name, src, ext]);

  return (
    <div className={`thumb thumb-${size}`}>
      {src ? <img src={src} alt="" draggable={false} /> : <Box size={size === "lg" ? 40 : 22} />}
    </div>
  );
}
