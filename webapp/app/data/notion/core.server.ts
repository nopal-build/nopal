import type {
  BlockObjectResponse,
  PageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { query } from "robustness-core/data/generic.server";
import type { Data } from "robustness-core/data/generic.server";

// Nopal Notion Wrapper Types
export type NopalPage = PageObjectResponse &
  Data & { pageDetails?: BlockObjectResponse[] };

export async function getAllPublishedPagesByDbRef(dbName: string) {
  return await query(
    `SELECT page.* FROM ${dbName} WHERE page.properties.Status.select.name = 'published'`,
    {
      limit: 100,
      start: 0,
    }
  ).then((_results) => {
    return (_results?.[0] || []) as { page: NopalPage }[];
  });
}

export async function getPageByDbRefAndSlug(dbName: string, slug: string) {
  const results = await query(
    `SELECT page.*, page.pageDetails.* FROM ${dbName} WHERE page.properties.Slug.rich_text[0].plain_text = '${slug}'`
  );
  if (results.length === 1) {
    const r = results[0] as { page: NopalPage }[];
    const record = r[0] || null;
    if (record?.page) {
      return record.page;
    }
  }
  return null;
}
