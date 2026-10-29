import { useEffect, useState } from "react";
import { Box } from "lucide-react";
import { fileName, readModel, saveThumbnail, type Item } from "../api";
import { renderThumbnail, thumbExt } from "../lib/thumbnail";

// Renders one thumbnail at a time so a big drop does not freeze the UI.
let chain: Promise<unknown> = Promise.resolve();
const attempted = new Set<number>();

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
    if (src || !ext || attempted.has(item.id)) return;
    attempted.add(item.id);
    let alive = true;
    enqueue(async () => {
      const bytes = await readModel(item.id);
      const url = await renderThumbnail(bytes, ext);
      await saveThumbnail(item.id, url);
      if (alive) setSrc(url);
    }).catch((e) => console.warn("thumbnail failed", item.name, e));
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
