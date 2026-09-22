/**
 * The Janitor's tests (ADR-018). The Janitor catches drift: two places
 * that state one fact and stop agreeing. Where the right answer is
 * confirmable it is a test here, green until it is wrong; what needs a
 * person's judgment is the report in `webapp/scripts/janitor/run.ts`.
 *
 * A failure here never means "make the test pass". It means two
 * statements of one fact disagree and a person picks which one is right:
 * the skill's prose, or the code. If a skill was reworded and still says
 * the same thing, update the pattern in the pair below.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILING_SKILL,
  DEFAULT_GRAPH_SKILL,
  DEFAULT_GRAPH_STRUCTURE_SKILL,
  DEFAULT_PROJECT_VIEW_SKILL,
} from "robustness-core/data/graphLogDefaults.server";
import { FILING_KINDS } from "robustness-core/data/syncFiling.server";
import { MAX_LINKS_PER_NODE } from "robustness-core/data/syncGraph.server";
import { MAX_NODES_PER_THREAD } from "robustness-core/data/graphStructure.server";
import { EFFORT_QUOTE_LIMIT, LABEL_ITEM_LIMIT } from "robustness-core/data/effortReadings.server";
import { extractRuntimeSkills, watchedFilesChanged } from "../../scripts/janitor/checks/watchedFiles";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DATA_DIR = path.join(REPO_ROOT, "packages/robustness-core/src/data");
const source = (file: string) => readFileSync(path.join(DATA_DIR, file), "utf8");

const NUMBER_WORDS: Record<number, string> = { 2: "two", 3: "three", 4: "four", 5: "five", 15: "fifteen", 20: "twenty" };

/** The number a skill states, read out of its prose by a pattern with one capture group. */
function stated(skill: string, pattern: RegExp): number | null {
  const word = skill.match(pattern)?.[1]?.toLowerCase();
  if (!word) return null;
  const n = Object.entries(NUMBER_WORDS).find(([, w]) => w === word)?.[0];
  return n ? Number(n) : Number(word);
}

describe("agreement: a number a skill states is the number code enforces", () => {
  // Only pairs the skill text states today. A limit code holds and no
  // skill mentions (the section word budgets, the bullet word limit) has
  // nothing to disagree with, so it is not here.
  const pairs: { skill: string; text: string; says: RegExp; code: string; holds: number }[] = [
    {
      skill: "GRAPH.md",
      text: DEFAULT_GRAPH_SKILL,
      says: /may link to at most (\w+) other nodes/i,
      code: "MAX_LINKS_PER_NODE (syncGraph.server.ts)",
      holds: MAX_LINKS_PER_NODE,
    },
    {
      skill: "GRAPH.md",
      text: DEFAULT_GRAPH_SKILL,
      says: /first time you add a list of (\w+) or more items/i,
      code: "LIST_BOUNCE_MIN_ITEMS (syncGraph.server.ts)",
      // Not exported, so read from the source.
      holds: Number(source("syncGraph.server.ts").match(/const LIST_BOUNCE_MIN_ITEMS = (\d+);/)?.[1]),
    },
    {
      skill: "GRAPH_STRUCTURE.md",
      text: DEFAULT_GRAPH_STRUCTURE_SKILL,
      says: /never holds more than (\w+) nodes/i,
      code: "MAX_NODES_PER_THREAD (graphStructure.server.ts)",
      holds: MAX_NODES_PER_THREAD,
    },
    {
      skill: "EFFORTS.md",
      text: DEFAULT_PROJECT_VIEW_SKILL,
      says: /Two or (\w+) quoted phrases in an effort is normal/i,
      code: "EFFORT_QUOTE_LIMIT (effortReadings.server.ts)",
      holds: EFFORT_QUOTE_LIMIT,
    },
    {
      skill: "EFFORTS.md",
      text: DEFAULT_PROJECT_VIEW_SKILL,
      says: /up to (\w+) items nested under it/i,
      code: "LABEL_ITEM_LIMIT (effortReadings.server.ts)",
      holds: LABEL_ITEM_LIMIT,
    },
  ];

  for (const pair of pairs) {
    it(`${pair.skill} and ${pair.code}`, () => {
      const says = stated(pair.text, pair.says);
      expect(says, `${pair.skill} no longer states this in words matching ${pair.says}; ${pair.code} still holds ${pair.holds}`).not.toBeNull();
      expect(says, `${pair.skill} states ${says}, ${pair.code} holds ${pair.holds}`).toBe(pair.holds);
    });
  }

  it("FILING.md's list of kinds is the list code accepts, less the one code assigns itself", () => {
    // `video` is filed by code from the content type and the skill says
    // so in prose; every other kind is a line the model reads.
    const costFields = ["vendor", "amount", "currency", "date", "readFrom"];
    const stated = [...DEFAULT_FILING_SKILL.matchAll(/^- `([A-Za-z-]+)`:/gm)].map((m) => m[1]).filter((k) => !costFields.includes(k));
    const accepted = FILING_KINDS.filter((k) => k !== "video");
    expect(stated.sort()).toEqual([...accepted].sort());
  });

  it("EFFORTS.md's size scale is the letters code accepts on a heading", () => {
    const template = DEFAULT_PROJECT_VIEW_SKILL.match(/### <Person> · <Effort> · <([A-Z|]+)>/)?.[1];
    const accepted = source("effortReadings.server.ts").match(/const SIZE_LETTER_ONLY_RE = \/\^\(\?:([A-Z|]+)\)\$\/i;/)?.[1];
    expect(template, "EFFORTS.md's heading template no longer lists the size letters").toBeTruthy();
    expect(template, `EFFORTS.md offers ${template}, SIZE_LETTER_ONLY_RE accepts ${accepted}`).toBe(accepted);
  });
});

describe("agreement: a tool or field a skill names exists on that stage", () => {
  // The model is told these names in prose and answers to them in a tool
  // schema. Renaming one side only is silent: the model keeps calling the
  // old name, or never learns the new one.
  const named: { skill: string; text: string; file: string; tools: string[]; fields: string[] }[] = [
    {
      skill: "GRAPH.md",
      text: DEFAULT_GRAPH_SKILL,
      file: "syncGraph.server.ts",
      tools: ["add_node"],
      fields: ["sourceIndex", "setup", "blocks", "sameDayLinks", "backwardLinks"],
    },
    {
      skill: "GRAPH_STRUCTURE.md",
      text: DEFAULT_GRAPH_STRUCTURE_SKILL,
      file: "graphStructure.server.ts",
      tools: ["update_cluster", "remove_cluster", "get_node"],
      fields: [],
    },
    {
      skill: "EFFORTS.md",
      text: DEFAULT_PROJECT_VIEW_SKILL,
      file: "graphProjectView.server.ts",
      tools: ["describe_effort", "get_node"],
      fields: ["size", "posture", "direction"],
    },
  ];

  for (const stage of named) {
    it(`${stage.skill} and ${stage.file}`, () => {
      const code = source(stage.file);
      for (const tool of stage.tools) {
        expect(stage.text.includes(tool), `${stage.skill} no longer names the tool ${tool}`).toBe(true);
        expect(code.includes(`name: "${tool}"`), `${stage.skill} names ${tool}, ${stage.file} defines no such tool`).toBe(true);
      }
      for (const field of stage.fields) {
        expect(stage.text.includes(field), `${stage.skill} no longer names the field ${field}`).toBe(true);
        expect(new RegExp(`\\b${field}: \\{`).test(code), `${stage.skill} names ${field}, ${stage.file} has no such tool field`).toBe(true);
      }
    });
  }
});

describe("agreement: what code owns, the skill tells the model to leave alone", () => {
  // ADR-005, and the 2026-09-11 grid's finding that a model asked for
  // something writes it. Code overwrites each of these whatever the model
  // does; the skill saying so is what stops the model spending output on
  // it, or fighting it.
  const owned: { skill: string; text: string; what: string; says: RegExp }[] = [
    { skill: "GRAPH.md", text: DEFAULT_GRAPH_SKILL, what: "citations and node headings", says: /never write a citation, or a node heading/i },
    { skill: "GRAPH.md", text: DEFAULT_GRAPH_SKILL, what: "highlight marks", says: /never write `==\.\.\.==` yourself/i },
    { skill: "GRAPH_STRUCTURE.md", text: DEFAULT_GRAPH_STRUCTURE_SKILL, what: "the Weight line", says: /Weight: \(recomputed\)/ },
    { skill: "GRAPH_STRUCTURE.md", text: DEFAULT_GRAPH_STRUCTURE_SKILL, what: "thread order", says: /re-sorted automatically/i },
    { skill: "EFFORTS.md", text: DEFAULT_PROJECT_VIEW_SKILL, what: "citations", says: /copied exactly as it appears on the node/i },
    { skill: "EFFORTS.md", text: DEFAULT_PROJECT_VIEW_SKILL, what: "the reader-corrections section", says: /never edit that section yourself/i },
  ];

  for (const rule of owned) {
    it(`${rule.skill}: ${rule.what}`, () => {
      expect(rule.says.test(rule.text), `${rule.skill} no longer tells the model that code owns ${rule.what}`).toBe(true);
    });
  }
});

describe("form: every agent skill can be loaded", () => {
  const skillsDir = path.join(REPO_ROOT, ".agents/skills");
  const dirs = readdirSync(skillsDir).filter((d) => statSync(path.join(skillsDir, d)).isDirectory());

  for (const dir of dirs) {
    it(`${dir}/SKILL.md`, () => {
      const lines = readFileSync(path.join(skillsDir, dir, "SKILL.md"), "utf8").split("\n");
      expect(lines[0], "does not open with front matter").toBe("---");
      const end = lines.indexOf("---", 1);
      expect(end, "front matter never closes").toBeGreaterThan(0);
      const frontMatter = lines.slice(1, end);
      const field = (key: string) => frontMatter.find((l) => l.startsWith(`${key}:`))?.slice(key.length + 1).trim();
      expect(field("name"), "name is not the directory's name").toBe(dir);
      expect(field("description"), "description is empty").toBeTruthy();
    });
  }
});

describe("the report: a watched file that changed, and nothing else", () => {
  it("says nothing when nothing changed", () => {
    expect(watchedFilesChanged([{ subject: "GRAPH.md", before: "a\nb", after: "a\nb" }])).toEqual([]);
  });

  it("shows the size on both sides and judges neither", () => {
    expect(watchedFilesChanged([{ subject: "graphlog/SKILL.md", before: "one two\nthree\nfour", after: "one" }])).toEqual([
      { direction: "vouching", subject: "graphlog/SKILL.md", message: "3 -> 1 lines, 4 -> 1 words" },
    ]);
  });

  it("reports a file that arrived or left", () => {
    const findings = watchedFilesChanged([
      { subject: "VOICE.md", before: null, after: "a b" },
      { subject: "phylog/SKILL.md", before: "a", after: null },
    ]);
    expect(findings.map((f) => f.message)).toEqual(["new, 1 lines, 2 words", "removed, was 1 lines, 1 words"]);
  });

  it("reads each seeded skill out of the defaults file, under the name people know it by", () => {
    const skills = extractRuntimeSkills(source("graphLogDefaults.server.ts"));
    expect([...skills.keys()].sort()).toEqual(["EFFORTS.md", "FILING.md", "GRAPH.md", "GRAPH_STRUCTURE.md", "KNOWLEDGE.md", "VOICE.md"]);
    expect(skills.get("GRAPH.md")?.startsWith("Your job is to read this project's synced content")).toBe(true);
  });
});

describe("ADR-018: the Janitor reports, a person decides", () => {
  it("has no write path", () => {
    const dir = path.join(REPO_ROOT, "webapp/scripts/janitor");
    const files = (d: string): string[] =>
      readdirSync(d).flatMap((name) => {
        const full = path.join(d, name);
        return statSync(full).isDirectory() ? files(full) : [full];
      });
    const forbidden =
      /writeFile|appendFile|createWriteStream|\brm(Sync)?\(|unlink|rename|copyFile|mkdir|updateFileRef|setGraphLogDefaultSkillOverride|--fix|"(add|commit|checkout|reset|restore|apply|stash|push)"/;
    for (const file of files(dir)) {
      const hit = readFileSync(file, "utf8").match(forbidden)?.[0];
      expect(hit, `${path.relative(REPO_ROOT, file)} contains ${hit}`).toBeUndefined();
    }
  });
});
