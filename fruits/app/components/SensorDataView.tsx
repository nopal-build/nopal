// The project page's "Sensor Data" tab (`newspaper.$folderId.tsx`) — load-
// cell test results only, see `loadCellSensorData.server.ts` for why this
// is deliberately narrow rather than a generic "any sync-api analysis"
// view. A list of runs; picking one shows an interactive chart (hover for
// exact values) with the same cleaned rows in a table below, plus raw/
// cleaned CSV downloads.
import { Link, useSearchParams } from "react-router";
import type {
  LoadCellCleanedMeta,
  LoadCellCleanedRow,
  SensorDataRunSummary,
  SensorDataTab,
} from "robustness-core/data/loadCellSensorData.server";
import { Chip } from "stamps/Chip";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { Stack } from "stamps/Stack";
import { LoadCellGraphCard } from "./LoadCellGraphCard";
import "../styles/vault.css";

const RUN_PARAM = "run";

export function SensorDataView({ data }: { projectFolderId: string; data: SensorDataTab }) {
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
        No load-cell test runs yet.
      </p>
    );
  }

  const selectedRun = data.selected ? data.runs.find((r) => r.name === data.selected!.name) : undefined;

  return (
    <Stack gap={6}>
      <div className={sprinkles({ display: "flex", flexWrap: "wrap", gap: 2 })}>
        {data.runs.map((run) => (
          <Link key={run.name} to={hrefFor(run.name)} preventScrollReset style={{ textDecoration: "none" }}>
            <Chip active={data.selected?.name === run.name}>{run.title}</Chip>
          </Link>
        ))}
      </div>

      {data.selected && selectedRun ? (
        <SensorDataRunView run={selectedRun} selected={data.selected} />
      ) : (
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
          Pick a run above.
        </p>
      )}
    </Stack>
  );
}

function SensorDataRunView({
  run,
  selected,
}: {
  run: SensorDataRunSummary;
  selected: { name: string; rows: LoadCellCleanedRow[]; meta: LoadCellCleanedMeta };
}) {
  return (
    <LoadCellGraphCard
      meta={selected.meta}
      rows={selected.rows}
      rawFileId={run.rawFileId}
      cleanedFileId={run.cleanedFileId}
      downloadName={run.name}
      showTable
    />
  );
}


