// =============================================================================
// One-off content import: copies the two "Stories" pages from the old
// Notion-backed marketing site (nopal.build/stories/*) into a `website`
// project's own vault tree, as real OxMarkdown pages under a `stories/`
// sub-folder — /v2/stories/perfection and /v2/stories/just-keep-creating
// once published (see the `vault` skill's "website projects" section).
//
// Idempotent-ish: skips any file that already exists by name rather than
// overwriting it, so a re-run never clobbers hand-edits made in between.
// New pages are left as drafts (no `publish` front matter at all — the
// same as never having set it) so a human reviews before going live.
//
// Run via: npx vite-node scripts/import-stories.ts <websiteFolderId>
// =============================================================================

import {
  createFileRef,
  createVaultFolder,
  getFolderById,
  listFolderChildren,
} from "robustness-core/data/vault.server";

const STORIES_FOLDER_NAME = "stories";

type StoryContent = {
  fileName: string;
  title: string;
  description: string;
  body: string;
};

const STORIES: StoryContent[] = [
  {
    fileName: "perfection.md",
    title: "Stop Chasing Perfection & Start Finding Joy",
    description:
      "Humans crave a perfected end state to work toward — but the joyful path isn't miles away, just a slight shift in view.",
    body: `# Stop Chasing Perfection & Start Finding Joy

[Watch on YouTube](https://youtu.be/GdhvttaQm24)

Humans crave a destination. Whether it's God, gods, retirement, or a cabin on a creek, we desire that perfected end state we can narrowly work toward. The turmoil of vast expanses of nature and creative acts tends to bring a sense of instability.

A whirling Dervish has learned to embrace this instability, channeling energy into new insights. An over-caffeinated accountant has learned to focus all energy on a single line at a time. The modern world we all live in rewards most of us to be more like the latter.

![Nopal No. 5 — Perfection](https://falling-firefly-1176.fly.storage.tigris.dev/nopal_no.5_-_perfection_1.10.1-instagram.jpg)
![Nopal No. 5 — Perfection](https://falling-firefly-1176.fly.storage.tigris.dev/nopal_no.5_-_perfection_2.15.1-instagram.jpg)

While this isn't inherently a bad thing, it does tend to push us into increasingly narrow views of the world. We obsess and overdevelop an ever-narrower idea of our personal vision of perfection. All other options become less connected and possible. Color fades away, and defects become more visible. We get obsessed with eliminating these remaining defects.

The good news seems to be that the joyful path isn't miles away, but rather a slight shift to the left or right. This change in view can bring a rush of learning. Insights that create meaningful change for our lives and the lives of others.

![Nopal No. 5 — Perfection](https://falling-firefly-1176.fly.storage.tigris.dev/nopal_no.5_-_perfection_1.23.1-instagram.jpg)
![Nopal No. 5 — Perfection](https://falling-firefly-1176.fly.storage.tigris.dev/nopal_no.5_-_perfection_2.2.1-instagram.jpg)

Human joy comes from presence, connection, and creation. Our goal must be not to narrow down on perfection but to expand out to form new insights, real connections, and create meaningful things with and for other humans.

This is my struggle.
`,
  },
  {
    fileName: "just-keep-creating.md",
    title: "Just Keep Creating",
    description:
      "On Resistance, building a first-of-its-kind high-performance door, and showing up consistently to do the work.",
    body: `# Just Keep Creating

[Watch on YouTube](https://youtu.be/AOm54AS2uU4)

Steven Pressfield's *The War of Art* (not to be confused with Art of War) always sits out on my shelf. I try to read it once a year. The subject is what the author calls Resistance. The hidden force that keeps us all stuck, scared of our creative endeavors, the force that powers our inner critic.

Rick Rubin's *The Creative Act* is one of my most gifted books. The main point is that all humans are creative beings. There are no "creatives" and the rest of us.

Both books are written in the format of short chapters; meditations on a collection of ideas. The most simple and valuable learning from these meditations for me are:

- Creating is essential to being human.
- Creating is hard.
- We must keep an eye on the end goal and consistently overcome Resistance.

![Dancing Raven door build](https://falling-firefly-1176.fly.storage.tigris.dev/no.4-resistance-783-instagram.jpg)

### prototype door

The first time Gerald wanted to build a high-performance wood door, I knew this would be a test and a turning point. The precision required for a triple-sealed, multipoint locking door that withstands the test of time and use, built custom without decades of experience, was a monumental challenge. To then also step up the performance with Gutex and Pro Clima and build in a custom rainscreen cladding that makes the door disappear when closed... color me impressed, yet equally skeptical that this would work.

A series of the most detailed 1:1 design drawings I'd ever seen, deep learning about hinge and hardware options, and it was clear this had a shot. Fast forward, and the result was one of the most interesting, well-built, and highest performing doors around.

### finding the limits

The current door in production aims to deliver the same performance while elevating the design details to the maximum. An impossibly simple-looking door that creates the illusion of thick, solid chunks of wood, featuring a brass semi-circle handle, hidden hinges, and lock hardware, along with nearly invisible triple gaskets, without compromising the original's impressive performance and durability.

![Dancing Raven door build](https://falling-firefly-1176.fly.storage.tigris.dev/no.4-resistance-787-instagram.jpg)

### hello Resistance

Whenever we commit to pushing our limits, that old friend Resistance tends to show up. Self-doubt, thoughts of insanity, and the drive to back off the challenge run amok. If we are tuned in, we also recognize this as a sign that we are on the right path.

### don't forget Grit

In the end, all that is required is showing up consistently to do the work. Keep sight of the bold goal and commit to getting there. You can assess the sanity next time, from the spot of completion.

### PS

Follow along with our series of videos as we cover our experience of creating this door for our Dancing Raven project. Time will tell what the next round looks like for our Sunny Home No. 1 build.
`,
  },
];

function frontmatter(title: string, description: string): string {
  return `---\ntitle: "${title.replace(/"/g, '\\"')}"\ndescription: "${description.replace(/"/g, '\\"')}"\n---\n\n`;
}

async function ensureStoriesIndex(humanId: string, storiesFolderId: string): Promise<void> {
  const { files } = await listFolderChildren(humanId, storiesFolderId);
  if (files.some((f) => f.name.toLowerCase() === "readme.md")) {
    console.log("  README.md already exists in stories/ — leaving it alone.");
    return;
  }
  const links = STORIES.map(
    (s) => `- [${s.title}](/v2/stories/${s.fileName.replace(/\.md$/, "")})`,
  ).join("\n");
  await createFileRef({
    human_id: humanId,
    name: "README.md",
    content: `---\ntitle: "Stories"\n---\n\n# Stories\n\n${links}\n`,
    content_type: "text/markdown",
    folder_id: storiesFolderId,
  });
  console.log("  Created stories/README.md");
}

async function main() {
  const folderId = process.argv[2];
  if (!folderId) {
    console.error("Usage: vite-node scripts/import-stories.ts <websiteFolderId>");
    process.exit(1);
  }

  const folder = await getFolderById(folderId);
  if (!folder) {
    console.error(`No folder found for id "${folderId}"`);
    process.exit(1);
  }
  if (folder.folder_type !== "website" || !folder.is_folder_type_root) {
    console.error(
      `Folder "${folder.name}" (${folder._id}) isn't a website project anchor — refusing to import into it.`,
    );
    process.exit(1);
  }

  console.log(`Importing Stories into "${folder.name}" (${folder._id})…`);

  const { folders } = await listFolderChildren(folder.human_id, folder._id);
  let storiesFolder = folders.find(
    (f) => f.name.toLowerCase() === STORIES_FOLDER_NAME,
  );
  if (!storiesFolder) {
    storiesFolder = await createVaultFolder({
      human_id: folder.human_id,
      name: STORIES_FOLDER_NAME,
      parent_folder_id: folder._id,
    });
    if (!storiesFolder) throw new Error("Failed to create stories/ folder");
    console.log(`  Created ${STORIES_FOLDER_NAME}/`);
  } else {
    console.log(`  Reusing existing ${STORIES_FOLDER_NAME}/ (${storiesFolder._id})`);
  }

  const { files: existingFiles } = await listFolderChildren(
    folder.human_id,
    storiesFolder._id,
  );
  const existingNames = new Set(existingFiles.map((f) => f.name.toLowerCase()));

  for (const story of STORIES) {
    if (existingNames.has(story.fileName.toLowerCase())) {
      console.log(`  Skipping ${story.fileName} — already exists.`);
      continue;
    }
    await createFileRef({
      human_id: folder.human_id,
      name: story.fileName,
      content: frontmatter(story.title, story.description) + story.body,
      content_type: "text/markdown",
      folder_id: storiesFolder._id,
    });
    console.log(`  Created ${STORIES_FOLDER_NAME}/${story.fileName} (draft)`);
  }

  await ensureStoriesIndex(folder.human_id, storiesFolder._id);

  console.log(
    "\n✓ Done. Publish each page from the Vault (Draft badge → click to publish) once reviewed.",
  );
}

main().catch((err) => {
  console.error("Story import failed:", err);
  process.exit(1);
});
