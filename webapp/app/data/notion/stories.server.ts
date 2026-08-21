import {
  getAllPublishedPagesByDbRef,
  getPageByDbRefAndSlug,
} from "./core.server";
import type { StoryRecord } from "./types";
import { formatRecord } from "robustness-core/data/generic.server";

const db = {
  id: "27af2211e45f80a993d4dde9a4067ea3",
  dbName: "gbs_stories",
  getPublicUrl: (slug: string) => `/stories/${slug}`,
};

export async function getAllStories(): Promise<{
  data: StoryRecord[];
}> {
  const results = await getAllPublishedPagesByDbRef(db.dbName);

  return {
    data: results.reverse().map(({ page }) => formatStoryRecord(page)),
  };
}

export async function getStoryBySlug(slug: string) {
  const record = await getPageByDbRefAndSlug(db.dbName, slug);
  if (record) {
    return formatStoryRecord(record);
  }
  return null;
}

function formatStoryRecord(_record: any): StoryRecord {
  const record = formatRecord(_record);
  const story: StoryRecord = {
    id: record.id,
    _id: record._id,
    name: record.properties.Name.title[0]?.plain_text || "",
    slug: record.properties.Slug.rich_text[0]?.plain_text || "",
    summary: record.properties.Summary,
    thumbnail: record.properties.Thumbnail.files?.[0]?.file?.url || "",
    status: record.properties.Status.select?.name || "",
    annotation: record.properties.Annotation.select?.name || "",
    pageDetails: record.pageDetails?.results || [],
  };
  return story;
}
