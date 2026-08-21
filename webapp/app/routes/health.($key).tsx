import type { Collection } from "robustness-core/data/generic.server";
import type { MaterialRecord } from "../data/notion/types";
import { useLoaderData, useLocation, useNavigate } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { GbScore } from "../components/GbScore";
import { NotionText } from "../components/NotionText";
import { GoodArrow } from "../components/GoodAssets";
import { isPublished } from "../data/materials";
import { getCacheControlHeader } from "../util/getCacheControlHeader.server";
import { getAllMaterials } from "../data/notion/materials.server";
import { getAllAssemblies } from "../data/notion/assemblies.server";
import { surfaceBase, surfaceHoverable } from "stamps/surface.css";

export function headers() {
  return {
    "Cache-Control": getCacheControlHeader(),
  };
}

type LoaderResult = {
  data: Collection<MaterialRecord>;
};
export const loader = async (remixContext: LoaderFunctionArgs) => {
  const key = remixContext.params?.key || "assemblies";

  switch (key) {
    case "materials":
      const materials = await getAllMaterials();
      return { data: materials };
    case "assemblies":
      const assemblies = await getAllAssemblies();
      return { data: assemblies };
  }
};

export default function HealthIndex() {
  const location = useLocation();
  const { data } = useLoaderData<LoaderResult>();

  return (
    <>
      {data.data.map((i) => {
        const status = isPublished(i);
        if (!status) {
          return null;
        }
        if (location.pathname === "/health/collections") {
          return null;
        }
        if (location.pathname === "/health/materials") {
          return <HealthItem item={i} type="materials" key={i._id} />;
        }
        return <HealthItem item={i} type="assemblies" key={i._id} />;
      })}
    </>
  );
}

export function HealthItem({
  item,
  type,
  returnUrl,
}: {
  item: any;
  type: "assemblies" | "materials";
  returnUrl?: string;
}) {
  const navigation = useNavigate();
  const { name, slug, summary, gbs, svg } = item;

  return (
    <div
      onClick={() => {
        navigation(`/${type}/${slug}`, { state: { returnUrl } });
      }}
      className={`${surfaceBase} ${surfaceHoverable} p-4 flex flex-col justify-between`}
    >
      <div>
        <div className="mt-8 gap-2 flex justify-center items-end">
          <img src={svg} />
          <GbScore score={gbs} />
        </div>
        <h3 className="mt-2 text-center font-bold purple-light-text text-2xl">
          {name}
        </h3>
        <div className="mt-2 text-center">
          <NotionText text={summary?.rich_text} />
        </div>
      </div>
      <div className="flex justify-end mt-4">
        <GoodArrow />
      </div>
    </div>
  );
}
