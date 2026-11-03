// "All Projects" — the Kanban board itself (garden/3-growing/
// guide-projects-phases.md). Split out from the route file
// (`app/routes/guide-projects.tsx`) because route files in this app
// don't import plain CSS directly — see that file's own note. Takes
// only what the loader returned, same convention `DashboardView`
// already uses.
import { useMemo, useState } from "react";
import { Link, useRevalidator } from "react-router";
import { AppLayout } from "../AppLayout";
import { CenterContent } from "stamps/CenterContent";
import { Stack } from "stamps/Stack";
import { Cluster } from "stamps/Cluster";
import { Surface } from "stamps/Surface";
import { Badge } from "stamps/Badge";
import { Select } from "stamps/Select";
import { button } from "stamps/button.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import type { GuideProjectsLoaderData } from "../../routes/guide-projects";
import "./guideProjects.css";

type Phase = GuideProjectsLoaderData["phases"][number];
type Card = Phase["cards"][number];

function phaseBadgeVariant(type: Phase["type"]): "accent" | "success" | undefined {
  if (type === "start") return "accent";
  if (type === "end") return "success";
  return undefined;
}

const subtle = { color: semanticColors.textSubtle } as const;

function CardTile({
  card,
  nextPhaseName,
  onMove,
  moving,
}: {
  card: Card;
  nextPhaseName: string | null;
  onMove: () => void;
  moving: boolean;
}) {
  const body = (
    <Stack gap={1}>
      <span className="gp-kanban__card-name">{card.title}</span>
      <span className="gp-kanban__card-meta">
        {card.guideName ?? "Unassigned"}
        {card.targetFinish ? ` · target ${card.targetFinish}` : ""}
      </span>
    </Stack>
  );
  return (
    <div className="gp-kanban__card">
      {card.projectFolderId ? (
        <Link to={`/newspaper/${card.projectFolderId}`} style={{ color: "inherit", textDecoration: "none" }}>
          {body}
        </Link>
      ) : (
        body
      )}
      {nextPhaseName && (
        <button
          type="button"
          className={`${button({ variant: "outline", size: "compact" })} gp-kanban__card-move`}
          onClick={onMove}
          disabled={moving}
        >
          {moving ? "Moving…" : `Move to ${nextPhaseName} →`}
        </button>
      )}
    </div>
  );
}

export function GuideProjectsBoard({ data }: { data: GuideProjectsLoaderData }) {
  const { viewerId, setUp, guides, phases } = data;
  const revalidator = useRevalidator();
  const [filter, setFilter] = useState("all");
  const [movingFileId, setMovingFileId] = useState<string | null>(null);

  const filterOptions = useMemo(
    () => [
      { value: "all", label: "All Org Projects" },
      { value: "mine", label: "My Projects" },
      ...guides.map((g) => ({ value: `guide:${g.id}`, label: `${g.name}'s Projects` })),
    ],
    [guides],
  );

  function matchesFilter(card: Card): boolean {
    if (filter === "all") return true;
    if (filter === "mine") return card.guideId === viewerId;
    const guideId = filter.startsWith("guide:") ? filter.slice("guide:".length) : null;
    return guideId ? card.guideId === guideId : true;
  }

  async function moveCard(fileId: string, destFolderId: string) {
    setMovingFileId(fileId);
    try {
      const res = await fetch(`/api/vault/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: destFolderId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        window.alert(body?.error ?? `Couldn't move that card (${res.status}).`);
        return;
      }
      revalidator.revalidate();
    } finally {
      setMovingFileId(null);
    }
  }

  return (
    <AppLayout>
      <CenterContent maxWidth={1100}>
        <Stack gap={6}>
          <header>
            <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold" })}`}>All Projects</h1>
          </header>

          {!setUp ? (
            <Surface className={sprinkles({ p: 4 })}>
              <p className={textSize.sm} style={subtle}>
                No Projects board has been set up for this organization yet.
              </p>
            </Surface>
          ) : (
            <Surface className={sprinkles({ p: 4 })}>
              <Stack gap={4}>
                <div className="gp-toolbar">
                  <Select
                    label="Filter"
                    size="small"
                    name="filter"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    options={filterOptions}
                  />
                </div>
                <div className="gp-kanban">
                  {phases.map((phase, i) => {
                    const nextPhase = phases[i + 1] ?? null;
                    const items = phase.cards.filter(matchesFilter);
                    return (
                      <div key={phase.name} className="gp-kanban__column">
                        <div className="gp-kanban__column-header">
                          <Cluster gap={2} align="center">
                            <span className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>{phase.name}</span>
                            {phase.type !== "normal" && <Badge variant={phaseBadgeVariant(phase.type)}>{phase.type}</Badge>}
                          </Cluster>
                          <span className={textSize.xs} style={subtle}>
                            {items.length} {items.length === 1 ? "project" : "projects"}
                          </span>
                        </div>
                        <div className="gp-kanban__column-body">
                          {items.length === 0 ? (
                            <p className={textSize.xs} style={subtle}>
                              Nothing here.
                            </p>
                          ) : (
                            items.map((card) => (
                              <CardTile
                                key={card.fileId}
                                card={card}
                                nextPhaseName={nextPhase?.name ?? null}
                                moving={movingFileId === card.fileId}
                                onMove={() => nextPhase && moveCard(card.fileId, nextPhase.folderId)}
                              />
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Stack>
            </Surface>
          )}
        </Stack>
      </CenterContent>
    </AppLayout>
  );
}
