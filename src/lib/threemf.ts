import { strFromU8, unzipSync } from "three/examples/jsm/libs/fflate.module.js";

const IMAGE = /\.(png|jpe?g)$/i;
const THUMB_REL = /\/metadata\/thumbnail$/i;

// Where slicers put the preview when the package relationships do not say.
const KNOWN = [
  "metadata/thumbnail.png",
  "metadata/plate_1.png",
  "auxiliaries/.thumbnails/thumbnail_middle.png",
  "auxiliaries/.thumbnails/thumbnail_3mf.png",
];

/**
 * Picks the preview image of a 3MF package the way Windows Explorer does: the thumbnail named in
 * `_rels/.rels`, else a well-known slicer path, else any full-size image under Metadata/.
 */
export function pickThumbnail(names: string[], rels: string | null): string | null {
  const byLower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const find = (path: string) => byLower.get(path.replace(/^\//, "").toLowerCase()) ?? null;

  for (const tag of rels?.match(/<Relationship\b[^>]*>/g) ?? []) {
    const type = tag.match(/\bType="([^"]*)"/)?.[1] ?? "";
    const target = tag.match(/\bTarget="([^"]*)"/)?.[1];
    if (target && THUMB_REL.test(type)) {
      const hit = find(target);
      if (hit) return hit;
    }
  }
  for (const path of KNOWN) {
    const hit = find(path);
    if (hit) return hit;
  }
  return (
    names.find((n) => /^metadata\//i.test(n) && IMAGE.test(n) && !/(small|pick|top|no_light)/i.test(n)) ?? null
  );
}

/** The preview image embedded in a 3MF file, as a PNG data URL no wider than `max`, or null. */
export async function embeddedThumbnail(bytes: ArrayBuffer, max = 384): Promise<string | null> {
  let files: Record<string, Uint8Array>;
  try {
    // Only unpack images and the relationships: the model XML can be huge.
    files = unzipSync(new Uint8Array(bytes), {
      filter: (f) => IMAGE.test(f.name) || f.name.toLowerCase() === "_rels/.rels",
    });
  } catch {
    return null;
  }
  const relsName = Object.keys(files).find((n) => n.toLowerCase() === "_rels/.rels");
  const name = pickThumbnail(Object.keys(files), relsName ? strFromU8(files[relsName]) : null);
  if (!name) return null;

  const type = /\.png$/i.test(name) ? "image/png" : "image/jpeg";
  const bitmap = await createImageBitmap(new Blob([files[name] as BlobPart], { type }));
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/png");
}
