import { query } from "robustness-core/data/generic.server";
import {
  registerDb,
  getAllPublishedPagesByDbRef,
  getPageByDbRefAndSlug,
} from "./core.server";
import type { NopalPage } from "./core.server";
import { getAssembliesByPageIds } from "./assemblies.server";
import type { ScienceRecord } from "./types";
import { formatRecord } from "robustness-core/data/generic.server";
import { RecordId } from "surrealdb";

const db = {
  id: "1d1f2211e45f80df81c3c82b831b45c1",
  dbName: "gbs_applied_science",
  getPublicUrl: (slug: string) => `/science/${slug}`,
};

export function registerAppliedScienceDb() {
  registerDb(db);
}

const assemblyDbFieldName = "Assembly Database";

export async function getSampleSciences(): Promise<{
  data: ScienceRecord[];
}> {
  const results = await getAllPublishedPagesByDbRef(db.dbName);
  const ids = getAssemblyPageIds(results);
  const gbs = await getGBSByPageIds(ids);

  return {
    data: results.map(({ page }) => formatScienceRecord(page, gbs)),
  };
}

function getAssemblyPageIds(results: { page: NopalPage }[]) {
  return results.reduce((acc: string[], { page }) => {
    const assemblies = page.properties?.[assemblyDbFieldName];
    if (assemblies?.type == "relation" && Array.isArray(assemblies.relation)) {
      assemblies.relation.forEach(({ id }) => {
        if (!acc.includes(id)) {
          acc.push(id);
        }
      });
    }
    return acc;
  }, []);
}

type GBSPage = { id: string; gbs: number };
async function getGBSByPageIds(ids: string[]): Promise<GBSPage[]> {
  const result = await query(
    `SELECT
      id,
      math::sum([
          properties["Carbon Score"].number,
          properties["Comfort Score"].number,
          properties["Efficiency Score"].number,
          properties["Longevity Score"].number,
          properties["Social Impact Score"].number
      ]) as gbs FROM notion_pages WHERE id IN $ids`,
    { ids: ids.map((id) => new RecordId("notion_pages", id)) }
  );

  const first = result[0];
  if (Array.isArray(first)) {
    return first.map(({ id, gbs }) => ({ id: id.id, gbs }));
  }
  return [];
}

export async function getScienceBySlug(slug: string) {
  const record = await getPageByDbRefAndSlug(db.dbName, slug);
  if (record) {
    const db = record.properties[assemblyDbFieldName];
    if (db.type === "relation") {
      const ids = db.relation.map(({ id }: { id: string }) => id);
      const assemblies = await getAssembliesByPageIds(ids);
      return formatScienceRecord(record, [], assemblies);
    }
  }
  return null;
}

function formatScienceRecord(
  _record: any,
  gbs: GBSPage[],
  assemblies: NopalPage[] = []
): ScienceRecord {
  const record = formatRecord(_record);
  const scienceRecord: ScienceRecord = {
    id: record.id,
    _id: record._id,
    name: record.properties.Name.title[0]?.plain_text || "",
    slug: record.properties.Slug.rich_text[0]?.plain_text || "",
    summary: record.properties.Summary,
    annotation: record.properties.Annotation.rich_text[0]?.plain_text || "",
    status: record.properties.Status.select?.name || "",
    thumbnail: record.properties.Thumbnail.files?.[0]?.file?.url || "",
    scores: record.properties[assemblyDbFieldName].relation
      .map(({ id }: { id: string }) => {
        const score = gbs.find((s) => s.id === id);
        return score ? score.gbs : 0;
      })
      .filter((score: number) => score > 0),
    pageDetails: record.pageDetails?.results || [],
    assemblies,
  };
  return scienceRecord;
}
