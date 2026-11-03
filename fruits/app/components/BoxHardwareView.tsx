// The project page's "Sensor Data" tab's BoxHardware half
// (`newspaper.$folderId.tsx`) — wall-temperature test results from the
// `box-hardware-data` sync-api analysis only, see
// `boxHardwareData.server.ts` for why this is deliberately narrow rather
// than a generic "any sync-api analysis" view. A list of runs; picking one
// shows interactive Temperature vs. Time / Delta T vs. Time charts (hover
// for exact values) with the same cleaned per-cycle rows in a table below,
// plus raw/cleaned CSV downloads. Rendered alongside (never instead of)
// `SensorDataView`'s own load-cell half — a project can have either, or
// both, recognized analyses at once.
import { Link, useSearchParams } from "react-router";
import type {
  BoxHardwareCleanedMeta,
  BoxHardwareCleanedRow,
  BoxHardwareDataTab,
  BoxHardwareRunSummary,
} from "robustness-core/data/boxHardwareData.server";
import { Chip } from "stamps/Chip";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { Stack } from "stamps/Stack";
import { BoxHardwareGraphCard } from "./BoxHardwareGraphCard";
import "../styles/vault.css";

const RUN_PARAM = "boxRun";

export function BoxHardwareView({ data }: { projectFolderId: string; data: BoxHardwareDataTab }) {
  const [params] = useSearchParams();

  const hrefFor = (runName: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", "sensorData");
    next.set(RUN_PARAM, runName);
    return `?${next.toString()}`;
  };

  if (data.runs.length === 0) {
    return (
      <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
        No BoxHardware test runs yet.
      </p>
    );
  }

  const selectedRun = data.selected ? data.runs.find((r) => r.name === data.selected!.name) : undefined;

  return (
    <Stack gap={6}>
      <div className={textSize.sm} style={{ fontWeight: 600 }}>
        Box Hardware
      </div>
      <div className={sprinkles({ display: "flex", flexWrap: "wrap", gap: 2 })}>
        {data.runs.map((run) => (
          <Link key={run.name} to={hrefFor(run.name)} preventScrollReset style={{ textDecoration: "none" }}>
            <Chip active={data.selected?.name === run.name}>{run.title}</Chip>
          </Link>
        ))}
      </div>

      {data.selected && selectedRun ? (
        <BoxHardwareRunView run={selectedRun} selected={data.selected} />
      ) : (
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
          Pick a run above.
        </p>
      )}
    </Stack>
  );
}

function BoxHardwareRunView({
  run,
  selected,
}: {
  run: BoxHardwareRunSummary;
  selected: { name: string; rows: BoxHardwareCleanedRow[]; meta: BoxHardwareCleanedMeta };
}) {
  return (
    <BoxHardwareGraphCard
      meta={selected.meta}
      rows={selected.rows}
      rawFileId={run.rawFileId}
      cleanedFileId={run.cleanedFileId}
      downloadName={run.name}
      showTable
    />
  );
}
