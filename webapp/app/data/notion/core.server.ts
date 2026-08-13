import { RecordId } from "surrealdb";

import type {
  BlockObjectResponse,
  ListBlockChildrenResponse,
  PageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { query, select, defineTable, upsert } from "robustness-core/data/generic.server";
import type { Data } from "robustness-core/data/generic.server";

// Nopal Notion Wrapper Types
export type NopalBlock = ListBlockChildrenResponse & Data;
export type NopalPage = PageObjectResponse &
  Data & { pageDetails?: BlockObjectResponse[] };

// Connecting Notion Databases to locally stored DBs.
export type NotionDatabase = {
  id: string; // Notion DB ID
  getPublicUrl: (slug: string) => string; // Noapl url, e.g. /assemblies/${slug}
  dbName: string; // Local DB Name
};
const _dbs: NotionDatabase[] = [];
export function registerDb(db: NotionDatabase) {
  const existing = _dbs.find((_db) => _db.dbName === db.dbName);
  if (!existing) {
    _dbs.push(db);
  }
}
export function getDbByName(name: string): NotionDatabase | undefined {
  return _dbs.find((db) => db.dbName === name);
}
export function getAllDbs() {
  return _dbs;
}

// Store all pages in a single table
export const PAGE_TABLE_NAME = "notion_pages";
const BLOCK_TABLE_NAME = "notion_blocks";

export async function defineNotionTables() {
  await defineTable(PAGE_TABLE_NAME);
  await defineTable(BLOCK_TABLE_NAME);
  await query(
    `DEFINE FIELD IF NOT EXISTS pageDetails on ${PAGE_TABLE_NAME} TYPE record <${BLOCK_TABLE_NAME}>;`
  );
}
export async function definePageField(dbName: string) {
  return await query(
    `DEFINE FIELD IF NOT EXISTS page on ${dbName} TYPE record <${PAGE_TABLE_NAME}>;`
  );
}
export async function upsertPage(page: PageObjectResponse) {
  return upsert(PAGE_TABLE_NAME, page);
}
export async function upsertBlock(block: ListBlockChildrenResponse) {
  return upsert(BLOCK_TABLE_NAME, block);
}

export async function findAllNopalPages() {
  return await query<NopalPage[]>(`SELECT * FROM ${PAGE_TABLE_NAME}`);
}
export async function findAllNopalBlocks() {
  const results = await query<NopalBlock[][]>(
    `SELECT * FROM ${BLOCK_TABLE_NAME}`
  );
  return results[0];
}

export async function findNopalPageById(id: string) {
  try {
    return await select<NopalPage>(new RecordId(PAGE_TABLE_NAME, id));
  } catch (error) {
    if (error instanceof Error && error.message.includes("fetch failed")) {
      return undefined;
    }
    throw error;
  }
}

export async function findNopalBlockById(id: string) {
  return await select<NopalBlock>(new RecordId(BLOCK_TABLE_NAME, id));
}

export async function getAllPagesByDbRef(dbName: string) {
  return await query(`SELECT page.* FROM ${dbName}`, {
    limit: 100,
    start: 0,
  }).then((_results) => {
    return (_results?.[0] || []) as { page: NopalPage }[];
  });
}

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
