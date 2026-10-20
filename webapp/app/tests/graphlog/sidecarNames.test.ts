/**
 * Two files that differ only by extension get their own sidecars
 * (2026-10-20: Hot box's `run-1.md` / `run-1.csv` overwrote each other's
 * every run, so both were described and filed again every night).
 */
import { describe, expect, it } from "vitest";
import { resolveSidecar, sidecarNameToRead, sidecarNames, sidecarSource } from "robustness-core/data/sidecarNames";

const sidecar = (source: string, body = "A description.") => `---\nsource: ${source}\nsourceHash: h\n---\n\n${body}`;

/** Plays a folder: write each source's sidecar where `resolveSidecar` says. */
async function writeAll(sources: { id: string; name: string }[], folder = new Map<string, string>()) {
  for (const s of sources) {
    const { name } = await resolveSidecar(s.name, s.id, ".knowledge.md", (n) => folder.get(n));
    folder.set(name, sidecar(s.id, `about ${s.name}`));
  }
  return folder;
}

describe("sidecar names", () => {
  it("the plain name drops the extension; the other keeps it", () => {
    expect(sidecarNames("run-1.csv", ".knowledge.md")).toEqual(["run-1.knowledge.md", "run-1.csv.knowledge.md"]);
    expect(sidecarNames("receipt", ".filing.md")).toEqual(["receipt.filing.md", "receipt.filing.md"]);
    expect(sidecarSource(sidecar("abc"))).toBe("abc");
    expect(sidecarSource("no front matter")).toBeNull();
  });

  it("a run's .md and .csv each keep their own sidecar, run after run", async () => {
    const files = [
      { id: "md1", name: "run-1.md" },
      { id: "csv1", name: "run-1.csv" },
    ];
    const folder = await writeAll(files);
    expect([...folder.keys()].sort()).toEqual(["run-1.csv.knowledge.md", "run-1.knowledge.md"]);

    // The next run finds each file's own sidecar where it left it.
    for (const f of files) {
      const { existing } = await resolveSidecar(f.name, f.id, ".knowledge.md", (n) => folder.get(n));
      expect(sidecarSource(existing)).toBe(f.id);
    }
    await writeAll(files, folder);
    expect(folder.size).toBe(2);
  });

  it("a Live Photo's still and video read their own descriptions", async () => {
    const folder = await writeAll([
      { id: "heic", name: "IMG_1523.HEIC" },
      { id: "mov", name: "IMG_1523.MOV" },
    ]);
    const has = (n: string) => folder.has(n);
    expect(folder.get(sidecarNameToRead("IMG_1523.HEIC", ".knowledge.md", has))).toContain("about IMG_1523.HEIC");
    expect(folder.get(sidecarNameToRead("IMG_1523.MOV", ".knowledge.md", has))).toContain("about IMG_1523.MOV");
  });

  it("a file alone in its folder keeps today's name, so nothing is described again", async () => {
    const folder = new Map([["IMG_1.knowledge.md", sidecar("photo")]]);
    const { name, existing } = await resolveSidecar("IMG_1.jpeg", "photo", ".knowledge.md", (n) => folder.get(n));
    expect(name).toBe("IMG_1.knowledge.md");
    expect(existing).not.toBeNull();
    expect(sidecarNameToRead("IMG_1.jpeg", ".knowledge.md", (n) => folder.has(n))).toBe("IMG_1.knowledge.md");
  });

  it("a collided plain sidecar stays with whoever wrote it last; the other file moves out once", async () => {
    // Hot box today: one plain sidecar, last written by the csv.
    const folder = new Map([["run-1.knowledge.md", sidecar("csv1")]]);
    const md = await resolveSidecar("run-1.md", "md1", ".knowledge.md", (n) => folder.get(n));
    expect(md).toEqual({ name: "run-1.md.knowledge.md", existing: null });
    const csv = await resolveSidecar("run-1.csv", "csv1", ".knowledge.md", (n) => folder.get(n));
    expect(csv.name).toBe("run-1.knowledge.md");
  });
});
