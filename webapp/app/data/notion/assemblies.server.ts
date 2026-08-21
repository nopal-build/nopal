import { query } from "robustness-core/data/generic.server";
import {
  getAllPublishedPagesByDbRef,
  getPageByDbRefAndSlug,
} from "./core.server";
import type { MaterialRecord } from "./types";
import { formatRecord } from "robustness-core/data/generic.server";
import { getGBSScore } from "../../util/getGBSScore";
import { RecordId } from "surrealdb";

const db = {
  id: "1d6f2211e45f803a880dcbd7701ec65d",
  dbName: "gbs_assemblies",
  getPublicUrl: (slug: string) => `/assemblies/${slug}`,
};

export async function getAllAssemblies(): Promise<{
  data: MaterialRecord[];
}> {
  const results = await getAllPublishedPagesByDbRef(db.dbName);

  return {
    data: results.map(({ page }) => formatAssemblyRecord(page)),
  };
}

export async function getAssembliesByPageIds(ids: string[]) {
  const results = await query<any[]>(
    `SELECT * FROM notion_pages WHERE id IN $ids`,
    { ids: ids.map((id) => new RecordId("notion_pages", id)) }
  );
  if (results.length != 1) {
    return undefined;
  }
  return results[0].map((page: any) => formatAssemblyRecord(page));
}

export async function getAssembliesBySlug(slug: string) {
  const record = await getPageByDbRefAndSlug(db.dbName, slug);
  if (record) {
    return formatAssemblyRecord(record);
  }
  return null;
}

export function formatAssemblyRecord(_record: any): MaterialRecord {
  const record = formatRecord(_record);
  const assembly = {
    id: record.id,
    _id: record._id,
    name: record.properties.Name.title[0]?.plain_text || "",
    slug: record.properties.Slug.rich_text[0]?.plain_text || "",
    summary: record.properties.Summary,
    status: record.properties.Status.select?.name || "",
    recommendation: record.properties.Recommendation.select?.name || "",
    gbs: 0,
    comfortScore: record.properties["Comfort Score"].number,
    efficiencyScore: record.properties["Efficiency Score"].number,
    longevityScore: record.properties["Longevity Score"].number,
    socialImpactScore: record.properties["Social Impact Score"].number,
    carbonScore: record.properties["Carbon Score"].number,
    svg: record.properties["svg"]?.files?.[0]?.file?.url || "",
    pageDetails: record.pageDetails?.results || [],
  };
  assembly.gbs = getGBSScore(assembly);
  return assembly;
}
