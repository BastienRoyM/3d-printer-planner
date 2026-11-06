import { describe, expect, it } from "vitest";
import { pickThumbnail } from "./threemf";

const rels = (target: string) => `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
  <Relationship Target="${target}" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>
</Relationships>`;

describe("pickThumbnail", () => {
  it("follows the package thumbnail relationship", () => {
    const names = ["Metadata/thumbnail.png", "Metadata/plate_2.png"];
    expect(pickThumbnail(names, rels("/Metadata/plate_2.png"))).toBe("Metadata/plate_2.png");
  });

  it("matches the relationship target case-insensitively", () => {
    expect(pickThumbnail(["metadata/Thumbnail.PNG"], rels("/Metadata/thumbnail.png"))).toBe("metadata/Thumbnail.PNG");
  });

  it("falls back to well-known slicer paths", () => {
    const names = ["Metadata/plate_1_small.png", "Metadata/plate_1.png", "Metadata/top_1.png"];
    expect(pickThumbnail(names, null)).toBe("Metadata/plate_1.png");
  });

  it("skips small and pick images when guessing", () => {
    expect(pickThumbnail(["Metadata/pick_1.png", "Metadata/preview.jpg"], null)).toBe("Metadata/preview.jpg");
  });

  it("returns null when there is no image", () => {
    expect(pickThumbnail(["3D/3dmodel.model"], rels("/Metadata/missing.png"))).toBeNull();
  });
});
