import { useState, useRef, useEffect, useCallback } from "react";
import type { MetaFunction } from "react-router";

/* ═══════════════════════════════════════════════════════════
   META
═══════════════════════════════════════════════════════════ */
export const meta: MetaFunction = () => [
  { title: "Space Layout | Tools" },
  {
    name: "description",
    content: "Interactive 3D space layout and planning tool.",
  },
];

/* ═══════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════ */
const MOON = "#c4c6fc";
const PURPLE = "#7f5b8b";
const BG = "#f7f6f3";
const PANEL = "#ffffff";
const BORDER = "#e5e3de";
const TEXT = "#1a1a1a";
const MUTED = "#8a8a8a";

const COS30 = Math.cos(Math.PI / 6); // ≈ 0.866
const SIN30 = 0.5;

const PX_PER_INCH = 16;
const PX_PER_FOOT = PX_PER_INCH * 12; // 192 px = 1 foot
const BASE_SCALE = 0.5; // base render scale before zoom

/* ═══════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════ */
type P3 = [number, number, number];
type P2 = [number, number];
type Units = "architect imperial" | "engineer imperial" | "metric" | "px";
type FaceKind = "top" | "bottom" | "front" | "back" | "left" | "right";
type ViewDir =
  | "top"
  | "bottom"
  | "north"
  | "south"
  | "east"
  | "west"
  | "iso-tne" // top-north-east
  | "iso-tnw" // top-north-west
  | "iso-tse" // top-south-east
  | "iso-tsw" // top-south-west
  | "iso-bne" // bottom-north-east
  | "iso-bnw" // bottom-north-west
  | "iso-bse" // bottom-south-east
  | "iso-bsw"; // bottom-south-west

type ElevationGridInstruction = {
  type: "elevation-grid-instruction";
  grid: P3[];
  hidden?: boolean;
};
type CubeInstruction = {
  type: "cube-instruction";
  mode:
    | { type: "new" }
    | { type: "add"; referenceItemId: string }
    | { type: "subtract"; referenceItemId: string };
  width: number;
  height: number;
  depth: number;
  location: { referenceItemId?: string; offset: P3; rotation: P3 };
};
type PlaneSegment = { distance: number; angle: number };
type PlaneInstruction = {
  type: "plane-instruction";
  /** XZ = horizontal floor/ceiling; XY = vertical south/north wall; ZY = vertical east/west wall */
  axis: "XZ" | "XY" | "ZY";
  /** Starting 2D point in the plane's local coords (u, v) */
  start: P2;
  /** Constant value on the perpendicular axis: Y for XZ, Z for XY, X for ZY */
  offset: number;
  /** Each step walks the perimeter; polygon auto-closes back to start */
  segments: PlaneSegment[];
  hidden?: boolean;
};
type Instruction =
  | ElevationGridInstruction
  | CubeInstruction
  | PlaneInstruction;

type MeshFace = { vertices: P3[]; normal: P3; kind: FaceKind };
type MeshGeo = { vertices: P3[]; faces: MeshFace[] };
type SceneItem = { id: string; geos: MeshGeo[] };
type Scene = { elevY: number; items: SceneItem[] };

type Step = { id: string; instructions: Instruction[] };
type JourneyOptions = { elevation_y: number; units: Units; gridSize: number };
type Journey = { name: string; options: JourneyOptions; steps: Step[] };

type SunSettings = {
  lat: number;
  lon: number;
  month: number; // 1–12
  day: number; // 1–31
  hour: number; // 0–23.99 (solar time, noon = 12)
  cityName: string;
};

/* ═══════════════════════════════════════════════════════════
   UNIT FORMATTING
═══════════════════════════════════════════════════════════ */
function fmtLen(px: number, units: Units): string {
  switch (units) {
    case "px":
      return `${Math.round(px)}px`;
    case "metric": {
      const mm = px / (16 / 25.4);
      return mm >= 1000
        ? `${(mm / 1000).toFixed(2)} m`
        : `${Math.round(mm)} mm`;
    }
    case "architect imperial": {
      const totalIn = px / PX_PER_INCH;
      const ft = Math.floor(totalIn / 12);
      const ins = Math.round(totalIn % 12);
      if (ft === 0) return `${ins}"`;
      if (ins === 0) return `${ft}'`;
      return `${ft}'-${ins}"`;
    }
    case "engineer imperial":
      return `${(px / PX_PER_FOOT).toFixed(2)}'`;
  }
}

/* ═══════════════════════════════════════════════════════════
   UNIT HELPERS (for editing)
═══════════════════════════════════════════════════════════ */
function toLenUnit(px: number, units: Units): number {
  if (units === "metric") return px / (PX_PER_INCH / 25.4);
  if (units === "px") return px;
  return px / PX_PER_FOOT; // feet for both imperial variants
}
function fromLenUnit(val: number, units: Units): number {
  if (units === "metric") return val * (PX_PER_INCH / 25.4);
  if (units === "px") return val;
  return val * PX_PER_FOOT;
}
function lenUnitLabel(units: Units): string {
  if (units === "metric") return "mm";
  if (units === "px") return "px";
  return "ft";
}

/* ═══════════════════════════════════════════════════════════
   GEOMETRY
═══════════════════════════════════════════════════════════ */
function makeCubeGeo(
  w: number,
  h: number,
  d: number,
  [ox, oy, oz]: P3,
): MeshGeo {
  const v: P3[] = [
    [ox, oy, oz], // 0 fbl
    [ox + w, oy, oz], // 1 fbr
    [ox + w, oy + h, oz], // 2 ftr
    [ox, oy + h, oz], // 3 ftl
    [ox, oy, oz + d], // 4 bbl
    [ox + w, oy, oz + d], // 5 bbr
    [ox + w, oy + h, oz + d], // 6 btr
    [ox, oy + h, oz + d], // 7 btl
  ];
  return {
    vertices: v,
    faces: [
      { vertices: [v[0], v[1], v[2], v[3]], normal: [0, 0, -1], kind: "front" },
      { vertices: [v[5], v[4], v[7], v[6]], normal: [0, 0, 1], kind: "back" },
      { vertices: [v[4], v[0], v[3], v[7]], normal: [-1, 0, 0], kind: "left" },
      { vertices: [v[1], v[5], v[6], v[2]], normal: [1, 0, 0], kind: "right" },
      {
        vertices: [v[0], v[4], v[5], v[1]],
        normal: [0, -1, 0],
        kind: "bottom",
      },
      { vertices: [v[3], v[2], v[6], v[7]], normal: [0, 1, 0], kind: "top" },
    ],
  };
}

/* ═══════════════════════════════════════════════════════════
   CSG  –  single-mesh AABB subtraction
═══════════════════════════════════════════════════════════ */
/**
 * Subtracts AABB `b` from AABB `a`, returning ONE welded MeshGeo.
 *
 * Strategy:
 *   1. Each of A's 6 outer faces is trimmed to exclude the rectangle
 *      covered by B (split into up to 4 sub-quads).
 *   2. Each of B's 6 faces that lies strictly inside A becomes an inner
 *      wall with its normal flipped (pointing from A's solid into the void).
 *
 * No interior seam faces are generated, so the result renders as a single
 * clean shell regardless of view direction.
 */
function subtractAABBtoMesh(a: MeshGeo, b: MeshGeo): MeshGeo {
  const aabb = (geo: MeshGeo) => {
    const vs = geo.vertices;
    return {
      x0: Math.min(...vs.map((v) => v[0])),
      x1: Math.max(...vs.map((v) => v[0])),
      y0: Math.min(...vs.map((v) => v[1])),
      y1: Math.max(...vs.map((v) => v[1])),
      z0: Math.min(...vs.map((v) => v[2])),
      z1: Math.max(...vs.map((v) => v[2])),
    };
  };
  const A = aabb(a);
  const B = aabb(b);

  // Intersection region
  const ix0 = Math.max(A.x0, B.x0),
    ix1 = Math.min(A.x1, B.x1);
  const iy0 = Math.max(A.y0, B.y0),
    iy1 = Math.min(A.y1, B.y1);
  const iz0 = Math.max(A.z0, B.z0),
    iz1 = Math.min(A.z1, B.z1);

  // No overlap – return A unchanged
  if (ix0 >= ix1 || iy0 >= iy1 || iz0 >= iz1) return a;

  const faces: MeshFace[] = [];
  const vertices: P3[] = [];

  const quad = (vs: P3[], normal: P3, kind: FaceKind) => {
    vs.forEach((v) => vertices.push(v));
    faces.push({ vertices: vs, normal, kind });
  };

  /**
   * Trim the 2-D rectangle [u0,u1]×[v0,v1] by removing [cu0,cu1]×[cv0,cv1].
   * Returns the remaining sub-rectangles (up to 4).
   */
  const trim = (
    u0: number,
    u1: number,
    v0: number,
    v1: number,
    cu0: number,
    cu1: number,
    cv0: number,
    cv1: number,
  ): [number, number, number, number][] => {
    const c0 = Math.max(u0, cu0),
      c1 = Math.min(u1, cu1);
    const c2 = Math.max(v0, cv0),
      c3 = Math.min(v1, cv1);
    if (c0 >= c1 || c2 >= c3) return [[u0, u1, v0, v1]];
    const r: [number, number, number, number][] = [];
    if (u0 < c0) r.push([u0, c0, v0, v1]);
    if (c1 < u1) r.push([c1, u1, v0, v1]);
    if (v0 < c2) r.push([c0, c1, v0, c2]);
    if (c3 < v1) r.push([c0, c1, c3, v1]);
    return r;
  };

  // ── A's outer faces, trimmed ────────────────────────────────────────────

  // Right +X at x=A.x1
  for (const [y0, y1, z0, z1] of B.x0 <= A.x1 && A.x1 <= B.x1
    ? trim(A.y0, A.y1, A.z0, A.z1, iy0, iy1, iz0, iz1)
    : [[A.y0, A.y1, A.z0, A.z1] as [number, number, number, number]])
    quad(
      [
        [A.x1, y0, z0],
        [A.x1, y0, z1],
        [A.x1, y1, z1],
        [A.x1, y1, z0],
      ],
      [1, 0, 0],
      "right",
    );

  // Left -X at x=A.x0
  for (const [y0, y1, z0, z1] of B.x0 <= A.x0 && A.x0 <= B.x1
    ? trim(A.y0, A.y1, A.z0, A.z1, iy0, iy1, iz0, iz1)
    : [[A.y0, A.y1, A.z0, A.z1] as [number, number, number, number]])
    quad(
      [
        [A.x0, y0, z1],
        [A.x0, y0, z0],
        [A.x0, y1, z0],
        [A.x0, y1, z1],
      ],
      [-1, 0, 0],
      "left",
    );

  // Top +Y at y=A.y1
  for (const [x0, x1, z0, z1] of B.y0 <= A.y1 && A.y1 <= B.y1
    ? trim(A.x0, A.x1, A.z0, A.z1, ix0, ix1, iz0, iz1)
    : [[A.x0, A.x1, A.z0, A.z1] as [number, number, number, number]])
    quad(
      [
        [x0, A.y1, z1],
        [x1, A.y1, z1],
        [x1, A.y1, z0],
        [x0, A.y1, z0],
      ],
      [0, 1, 0],
      "top",
    );

  // Bottom -Y at y=A.y0
  for (const [x0, x1, z0, z1] of B.y0 <= A.y0 && A.y0 <= B.y1
    ? trim(A.x0, A.x1, A.z0, A.z1, ix0, ix1, iz0, iz1)
    : [[A.x0, A.x1, A.z0, A.z1] as [number, number, number, number]])
    quad(
      [
        [x0, A.y0, z0],
        [x1, A.y0, z0],
        [x1, A.y0, z1],
        [x0, A.y0, z1],
      ],
      [0, -1, 0],
      "bottom",
    );

  // Front -Z at z=A.z0
  for (const [x0, x1, y0, y1] of B.z0 <= A.z0 && A.z0 <= B.z1
    ? trim(A.x0, A.x1, A.y0, A.y1, ix0, ix1, iy0, iy1)
    : [[A.x0, A.x1, A.y0, A.y1] as [number, number, number, number]])
    quad(
      [
        [x0, y0, A.z0],
        [x1, y0, A.z0],
        [x1, y1, A.z0],
        [x0, y1, A.z0],
      ],
      [0, 0, -1],
      "front",
    );

  // Back +Z at z=A.z1
  for (const [x0, x1, y0, y1] of B.z0 <= A.z1 && A.z1 <= B.z1
    ? trim(A.x0, A.x1, A.y0, A.y1, ix0, ix1, iy0, iy1)
    : [[A.x0, A.x1, A.y0, A.y1] as [number, number, number, number]])
    quad(
      [
        [x1, y0, A.z1],
        [x0, y0, A.z1],
        [x0, y1, A.z1],
        [x1, y1, A.z1],
      ],
      [0, 0, 1],
      "back",
    );

  // ── B's inner walls (strictly inside A) – normals flipped ───────────────
  // B's outward normal points away from B's solid; the inner wall must face
  // into the void (away from A's solid), so we flip it.

  if (A.x0 < B.x1 && B.x1 < A.x1)
    // B right face +X → inner wall -X
    quad(
      [
        [B.x1, iy1, iz0],
        [B.x1, iy0, iz0],
        [B.x1, iy0, iz1],
        [B.x1, iy1, iz1],
      ],
      [-1, 0, 0],
      "left",
    );
  if (A.x0 < B.x0 && B.x0 < A.x1)
    // B left face -X → inner wall +X
    quad(
      [
        [B.x0, iy0, iz0],
        [B.x0, iy1, iz0],
        [B.x0, iy1, iz1],
        [B.x0, iy0, iz1],
      ],
      [1, 0, 0],
      "right",
    );
  if (A.y0 < B.y1 && B.y1 < A.y1)
    // B top face +Y → inner wall -Y
    quad(
      [
        [ix0, B.y1, iz0],
        [ix1, B.y1, iz0],
        [ix1, B.y1, iz1],
        [ix0, B.y1, iz1],
      ],
      [0, -1, 0],
      "bottom",
    );
  if (A.y0 < B.y0 && B.y0 < A.y1)
    // B bottom face -Y → inner wall +Y
    quad(
      [
        [ix1, B.y0, iz0],
        [ix0, B.y0, iz0],
        [ix0, B.y0, iz1],
        [ix1, B.y0, iz1],
      ],
      [0, 1, 0],
      "top",
    );
  if (A.z0 < B.z1 && B.z1 < A.z1)
    // B back face +Z → inner wall -Z
    quad(
      [
        [ix0, iy0, B.z1],
        [ix1, iy0, B.z1],
        [ix1, iy1, B.z1],
        [ix0, iy1, B.z1],
      ],
      [0, 0, -1],
      "front",
    );
  if (A.z0 < B.z0 && B.z0 < A.z1)
    // B front face -Z → inner wall +Z
    quad(
      [
        [ix1, iy0, B.z0],
        [ix0, iy0, B.z0],
        [ix0, iy1, B.z0],
        [ix1, iy1, B.z0],
      ],
      [0, 0, 1],
      "back",
    );

  return { vertices, faces };
}

function subtractBoxFromItem(item: SceneItem, subGeo: MeshGeo): SceneItem {
  return {
    ...item,
    geos: item.geos.map((geo) => subtractAABBtoMesh(geo, subGeo)),
  };
}

/* ═══════════════════════════════════════════════════════════
   PLANE INSTRUCTION HELPERS
═══════════════════════════════════════════════════════════ */
/**
 * Walk the segments to produce the polygon's 2D vertices (in the plane's
 * local u/v coordinates). The returned array starts at `instr.start`; the
 * polygon is closed — the last implicit edge connects back to start.
 *
 * Angle convention
 *   XZ (floor)  : compass bearing — 0° = North (−Z), 90° = East (+X)
 *   XY / ZY     : standard CCW from the +u axis — 0° = right, 90° = up
 */
function computePlanePoints(instr: PlaneInstruction): P2[] {
  const pts: P2[] = [instr.start];
  let [u, v] = instr.start;
  for (const seg of instr.segments) {
    const rad = (seg.angle * Math.PI) / 180;
    if (instr.axis === "XZ") {
      // compass bearing → world XZ  (N=−Z, E=+X, S=+Z, W=−X)
      u += Math.sin(rad) * seg.distance;
      v += -Math.cos(rad) * seg.distance;
    } else {
      // standard angle: 0° = right (+u), 90° = up (+v)
      u += Math.cos(rad) * seg.distance;
      v += Math.sin(rad) * seg.distance;
    }
    pts.push([u, v]);
  }
  return pts;
}

/** Turn a PlaneInstruction into a two-sided flat MeshGeo. */
function buildPlaneGeo(instr: PlaneInstruction): MeshGeo {
  const pts2D = computePlanePoints(instr);
  const pts3D: P3[] = pts2D.map(([u, v]) => {
    if (instr.axis === "XZ") return [u, instr.offset, v];
    if (instr.axis === "XY") return [u, v, instr.offset];
    /* ZY */ return [instr.offset, v, u];
  });
  // Provide both front and back face so the polygon is visible from each side.
  const cfg: Record<PlaneInstruction["axis"], [P3, P3, FaceKind, FaceKind]> = {
    XZ: [[0, 1, 0], [0, -1, 0], "top", "bottom"],
    XY: [[0, 0, -1], [0, 0, 1], "front", "back"],
    ZY: [[1, 0, 0], [-1, 0, 0], "right", "left"],
  };
  const [n1, n2, k1, k2] = cfg[instr.axis];
  return {
    vertices: pts3D,
    faces: [
      { vertices: pts3D, normal: n1, kind: k1 },
      { vertices: [...pts3D].reverse(), normal: n2, kind: k2 },
    ],
  };
}

/* ═══════════════════════════════════════════════════════════
   SCENE BUILDING  (Scene, Instruction) => Scene
═══════════════════════════════════════════════════════════ */
function buildScene(journey: Journey, upToStep: number): Scene {
  let scene: Scene = { elevY: journey.options.elevation_y, items: [] };
  let nextId = 0;
  for (let si = 0; si <= upToStep && si < journey.steps.length; si++) {
    for (const instr of journey.steps[si].instructions) {
      if (instr.type === "plane-instruction") {
        if (!instr.hidden && instr.segments.length > 0) {
          const geo = buildPlaneGeo(instr);
          scene = {
            ...scene,
            items: [...scene.items, { id: `plane-${nextId++}`, geos: [geo] }],
          };
        }
        continue;
      }
      if (instr.type !== "cube-instruction") continue;
      const { mode, width, height, depth, location } = instr;
      const [ox, oy, oz] = location.offset;
      let base: P3 = [0, scene.elevY, 0];
      if (location.referenceItemId) {
        const ref = scene.items.find((i) => i.id === location.referenceItemId);
        if (ref?.geos[0]) {
          const vs = ref.geos[0].vertices;
          base = [
            Math.min(...vs.map((v) => v[0])),
            Math.min(...vs.map((v) => v[1])),
            Math.min(...vs.map((v) => v[2])),
          ];
        }
      }
      const off: P3 = [base[0] + ox, base[1] + oy, base[2] + oz];
      const geo = makeCubeGeo(width, height, depth, off);
      if (mode.type === "new") {
        scene = {
          ...scene,
          items: [...scene.items, { id: `item-${nextId++}`, geos: [geo] }],
        };
      } else if (mode.type === "add") {
        scene = {
          ...scene,
          items: scene.items.map((item) =>
            item.id === mode.referenceItemId
              ? { ...item, geos: [...item.geos, geo] }
              : item,
          ),
        };
      } else if (mode.type === "subtract") {
        scene = {
          ...scene,
          items: scene.items.map((item) =>
            item.id === mode.referenceItemId
              ? subtractBoxFromItem(item, geo)
              : item,
          ),
        };
      }
    }
  }
  return scene;
}

/* ═══════════════════════════════════════════════════════════
   PROJECTION
   Coord system: X=right, Y=up, Z=depth-into-scene
═══════════════════════════════════════════════════════════ */
type ProjFn = (p: P3) => P2;

function getProj(v: ViewDir): ProjFn {
  switch (v) {
    case "top":
      return ([x, , z]) => [x, z];
    case "bottom":
      return ([x, , z]) => [x, -z];
    // South view: standing south, facing north — east(+x) is on the right
    case "south":
      return ([x, y]) => [x, -y];
    // North view: standing north, facing south — east(+x) is on the left
    case "north":
      return ([x, y]) => [-x, -y];
    // East view: standing east, facing west — north(+z) on right, south(-z) on left
    case "east":
      return ([, y, z]) => [z, -y];
    // West view: standing west, facing east — north(+z) on left, south(-z) on right
    case "west":
      return ([, y, z]) => [-z, -y];
    // iso-tse: camera at (+x,+y,-z) — sees top, south, east
    case "iso-tse":
      return ([x, y, z]) => [(x + z) * COS30, (x - z) * SIN30 - y];
    // iso-tsw: camera at (-x,+y,-z) — sees top, south, west
    case "iso-tsw":
      return ([x, y, z]) => [(x - z) * COS30, -(x + z) * SIN30 - y];
    // iso-tne: camera at (+x,+y,+z) — sees top, north, east
    // screen-x uses (z-x) so N→right, E→left; depth +(x+z) so both go downward (near)
    case "iso-tne":
      return ([x, y, z]) => [(z - x) * COS30, (x + z) * SIN30 - y];
    // iso-tnw: camera at (-x,+y,+z) — sees top, north, west
    // screen-x negated so W appears on the right; depth term gives W lower-right
    case "iso-tnw":
      return ([x, y, z]) => [(-x - z) * COS30, (z - x) * SIN30 - y];
    // Bottom iso views: same horizontal projection as their top counterparts,
    // but the y contribution is flipped (camera is below, looking up).
    case "iso-bne":
      return ([x, y, z]) => [(z - x) * COS30, (x + z) * SIN30 + y];
    case "iso-bnw":
      return ([x, y, z]) => [(-x - z) * COS30, (z - x) * SIN30 + y];
    case "iso-bse":
      return ([x, y, z]) => [(x + z) * COS30, (x - z) * SIN30 + y];
    case "iso-bsw":
      return ([x, y, z]) => [(x - z) * COS30, -(x + z) * SIN30 + y];
  }
}

// Camera direction vectors (from scene toward viewer)
const CAM_DIR: Record<ViewDir, P3> = {
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  south: [0, 0, -1], // camera to the south, looks north
  north: [0, 0, 1], // camera to the north, looks south
  east: [1, 0, 0], // camera to the east,  looks west
  west: [-1, 0, 0], // camera to the west,  looks east
  "iso-tse": [1, 1, -1], // top-south-east
  "iso-tsw": [-1, 1, -1], // top-south-west
  "iso-tne": [1, 1, 1], // top-north-east
  "iso-tnw": [-1, 1, 1], // top-north-west
  "iso-bne": [1, -1, 1], // bottom-north-east
  "iso-bnw": [-1, -1, 1], // bottom-north-west
  "iso-bse": [1, -1, -1], // bottom-south-east
  "iso-bsw": [-1, -1, -1], // bottom-south-west
};

const VIEW_LABEL: Record<ViewDir, string> = {
  top: "Top",
  bottom: "Bottom",
  north: "North",
  south: "South",
  east: "East",
  west: "West",
  "iso-tne": "Top · North · East",
  "iso-tnw": "Top · North · West",
  "iso-tse": "Top · South · East",
  "iso-tsw": "Top · South · West",
  "iso-bne": "Bottom · North · East",
  "iso-bnw": "Bottom · North · West",
  "iso-bse": "Bottom · South · East",
  "iso-bsw": "Bottom · South · West",
};

function dot3(a: P3, b: P3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function ctr3(vs: P3[]): P3 {
  const n = vs.length;
  return [
    vs.reduce((s, v) => s + v[0], 0) / n,
    vs.reduce((s, v) => s + v[1], 0) / n,
    vs.reduce((s, v) => s + v[2], 0) / n,
  ];
}
function faceVisible(f: MeshFace, vd: ViewDir) {
  return dot3(f.normal as P3, CAM_DIR[vd]) > 1e-9;
}

/* ═══════════════════════════════════════════════════════════
   PAN / BOUNDS
═══════════════════════════════════════════════════════════ */
function computeBounds(scene: Scene, proj: ProjFn) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const item of scene.items)
    for (const geo of item.geos)
      for (const v of geo.vertices) {
        const [sx, sy] = proj(v);
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
      }
  if (!isFinite(minX)) return { minX: -200, maxX: 200, minY: -200, maxY: 200 };
  const pad = 60;
  return {
    minX: minX - pad,
    maxX: maxX + pad,
    minY: minY - pad,
    maxY: maxY + pad,
  };
}

function clampPan(
  panX: number,
  panY: number,
  zoom: number,
  vpW: number,
  vpH: number,
  b: { minX: number; maxX: number; minY: number; maxY: number },
): P2 {
  const s = BASE_SCALE * zoom;
  const m = 80; // margin px
  // screen_x of world point wx = vpW/2 + panX + wx*s
  // Keep at least margin from each edge
  const loX = m - vpW / 2 - b.maxX * s,
    hiX = vpW / 2 - m - b.minX * s;
  const loY = m - vpH / 2 - b.maxY * s,
    hiY = vpH / 2 - m - b.minY * s;
  const cx = loX <= hiX ? Math.max(loX, Math.min(hiX, panX)) : panX;
  const cy = loY <= hiY ? Math.max(loY, Math.min(hiY, panY)) : panY;
  return [cx, cy];
}

/* ═══════════════════════════════════════════════════════════
   SVG HELPERS
═══════════════════════════════════════════════════════════ */
const toPath = (pts: P2[]) =>
  `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}Z`;

/* ═══════════════════════════════════════════════════════════
   SUN / SOLAR POSITION
   Coord system: X=East, Y=Up, Z=North
   Azimuth measured clockwise from North.
═══════════════════════════════════════════════════════════ */

const CITY_PRESETS: Array<{ name: string; lat: number; lon: number }> = [
  { name: "New York", lat: 40.71, lon: -74.01 },
  { name: "Los Angeles", lat: 34.05, lon: -118.24 },
  { name: "Chicago", lat: 41.88, lon: -87.63 },
  { name: "Miami", lat: 25.77, lon: -80.19 },
  { name: "London", lat: 51.51, lon: -0.13 },
  { name: "Paris", lat: 48.85, lon: 2.35 },
  { name: "Berlin", lat: 52.52, lon: 13.41 },
  { name: "Rome", lat: 41.9, lon: 12.5 },
  { name: "Tokyo", lat: 35.68, lon: 139.69 },
  { name: "Beijing", lat: 39.91, lon: 116.39 },
  { name: "Sydney", lat: -33.87, lon: 151.21 },
  { name: "Dubai", lat: 25.2, lon: 55.27 },
  { name: "Mexico City", lat: 19.43, lon: -99.13 },
  { name: "São Paulo", lat: -23.55, lon: -46.63 },
  { name: "Mumbai", lat: 19.08, lon: 72.88 },
  { name: "Cairo", lat: 30.04, lon: 31.24 },
  { name: "Custom", lat: 0, lon: 0 },
];

const DEFAULT_SUN_SETTINGS: SunSettings = {
  lat: 40.71,
  lon: -74.01,
  month: 6,
  day: 21,
  hour: 10,
  cityName: "New York",
};

function _dayOfYear(month: number, day: number): number {
  const dim = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let d = day;
  for (let m = 1; m < month; m++) d += dim[m];
  return d;
}

function computeSolarPos(
  lat: number,
  month: number,
  day: number,
  hour: number,
): { altitude: number; azimuth: number } {
  const doy = _dayOfYear(month, day);
  // Solar declination
  const declDeg = -23.45 * Math.cos(((2 * Math.PI) / 365) * (doy + 10));
  const decl = (declDeg * Math.PI) / 180;
  // Hour angle (0 at solar noon, ±15°/hr)
  const hourAngle = ((hour - 12) * 15 * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  // Solar altitude
  const sinAlt =
    Math.sin(latRad) * Math.sin(decl) +
    Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngle);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  // Solar azimuth (from North, clockwise)
  const cosAlt = Math.cos(altitude);
  const cosLatRad = Math.cos(latRad);
  const cosAz =
    cosAlt > 1e-9 && cosLatRad > 1e-9
      ? (Math.sin(decl) - Math.sin(altitude) * Math.sin(latRad)) /
        (cosAlt * cosLatRad)
      : 0;
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (Math.sin(hourAngle) > 0) azimuth = 2 * Math.PI - azimuth; // afternoon
  return { altitude, azimuth };
}

/** Returns sun direction [X=East, Y=Up, Z=North] or null when below horizon. */
function getSunDir(s: SunSettings): P3 | null {
  const { altitude, azimuth } = computeSolarPos(s.lat, s.month, s.day, s.hour);
  if (altitude <= 1e-3) return null;
  const cosAlt = Math.cos(altitude);
  return [
    cosAlt * Math.sin(azimuth), // X = East
    Math.sin(altitude), // Y = Up
    cosAlt * Math.cos(azimuth), // Z = North
  ];
}

function fmtHour(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
}

function toCardinal(azDeg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(azDeg / 45) % 8];
}

/* ─── shadow helpers ─── */

function convexHull2D(pts: P2[]): P2[] {
  if (pts.length < 3) return pts;
  const sorted = [...pts].sort((a, b) =>
    a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1],
  );
  const cross = (O: P2, A: P2, B: P2) =>
    (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
  const lower: P2[] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    )
      lower.pop();
    lower.push(p);
  }
  const upper: P2[] = [];
  for (const p of [...sorted].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    )
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Computes the convex-hull shadow polygon (in 2-D projection space)
 * cast by a MeshGeo on the ground plane (y = elevY).
 * For convex objects like cubes this is exact.
 */
function computeShadowHull(
  geo: MeshGeo,
  sunDir: P3,
  elevY: number,
  proj: ProjFn,
): P2[] {
  const [sx, sy, sz] = sunDir;
  if (sy <= 1e-9) return [];
  const pts2D: P2[] = [];
  for (const [vx, vy, vz] of geo.vertices) {
    // Always include the vertex's footprint at ground level
    pts2D.push(proj([vx, elevY, vz]));
    // If the vertex is above the ground, also include where its shadow falls
    if (vy > elevY) {
      const t = (vy - elevY) / sy;
      pts2D.push(proj([vx - t * sx, elevY, vz - t * sz]));
    }
  }
  if (pts2D.length < 3) return [];
  return convexHull2D(pts2D);
}

/* ═══════════════════════════════════════════════════════════
   HATCH PATTERNS
   - top:    horizontal lines   ────
   - front:  diagonal /
   - right:  diagonal \
   - left:   vertical  |  (lighter)
   - back:   cross-hatch        (lighter)
   - bottom: dense cross-hatch  (lightest)
═══════════════════════════════════════════════════════════ */
function HatchDefs() {
  const c = PURPLE,
    sz = 12,
    sw = 0.7,
    op = 0.5;
  return (
    <defs>
      <pattern
        id="h-top"
        x="0"
        y="0"
        width={sz}
        height={sz}
        patternUnits="userSpaceOnUse"
      >
        <line
          x1="0"
          y1={sz * 0.5}
          x2={sz}
          y2={sz * 0.5}
          stroke={c}
          strokeWidth={sw}
          opacity={op}
        />
      </pattern>
      <pattern
        id="h-front"
        x="0"
        y="0"
        width={sz}
        height={sz}
        patternUnits="userSpaceOnUse"
      >
        <line
          x1={-sz}
          y1={sz}
          x2={sz}
          y2={-sz}
          stroke={c}
          strokeWidth={sw}
          opacity={op}
        />
        <line
          x1="0"
          y1={sz}
          x2={sz * 2}
          y2={-sz}
          stroke={c}
          strokeWidth={sw}
          opacity={op}
        />
        <line
          x1={-sz}
          y1={sz * 2}
          x2="0"
          y2="0"
          stroke={c}
          strokeWidth={sw}
          opacity={op}
        />
      </pattern>
      <pattern
        id="h-right"
        x="0"
        y="0"
        width={sz}
        height={sz}
        patternUnits="userSpaceOnUse"
      >
        <line
          x1={-sz}
          y1={-sz}
          x2={sz}
          y2={sz}
          stroke={c}
          strokeWidth={sw}
          opacity={op}
        />
        <line
          x1="0"
          y1={-sz}
          x2={sz * 2}
          y2={sz}
          stroke={c}
          strokeWidth={sw}
          opacity={op}
        />
        <line
          x1={-sz}
          y1="0"
          x2={sz}
          y2={sz * 2}
          stroke={c}
          strokeWidth={sw}
          opacity={op}
        />
      </pattern>
      <pattern
        id="h-left"
        x="0"
        y="0"
        width={sz}
        height={sz}
        patternUnits="userSpaceOnUse"
      >
        <line
          x1={sz * 0.5}
          y1="0"
          x2={sz * 0.5}
          y2={sz}
          stroke={c}
          strokeWidth={sw}
          opacity={op * 0.6}
        />
      </pattern>
      <pattern
        id="h-back"
        x="0"
        y="0"
        width={sz}
        height={sz}
        patternUnits="userSpaceOnUse"
      >
        <line
          x1="0"
          y1={sz * 0.5}
          x2={sz}
          y2={sz * 0.5}
          stroke={c}
          strokeWidth={sw * 0.5}
          opacity={op * 0.4}
        />
        <line
          x1={sz * 0.5}
          y1="0"
          x2={sz * 0.5}
          y2={sz}
          stroke={c}
          strokeWidth={sw * 0.5}
          opacity={op * 0.4}
        />
      </pattern>
      <pattern
        id="h-bottom"
        x="0"
        y="0"
        width={sz * 0.5}
        height={sz * 0.5}
        patternUnits="userSpaceOnUse"
      >
        <line
          x1="0"
          y1={sz * 0.25}
          x2={sz * 0.5}
          y2={sz * 0.25}
          stroke={c}
          strokeWidth={sw * 0.4}
          opacity={op * 0.3}
        />
        <line
          x1={sz * 0.25}
          y1="0"
          x2={sz * 0.25}
          y2={sz * 0.5}
          stroke={c}
          strokeWidth={sw * 0.4}
          opacity={op * 0.3}
        />
      </pattern>
    </defs>
  );
}
const HATCH: Record<FaceKind, string> = {
  top: "url(#h-top)",
  front: "url(#h-front)",
  right: "url(#h-right)",
  left: "url(#h-left)",
  back: "url(#h-back)",
  bottom: "url(#h-bottom)",
};

/* ═══════════════════════════════════════════════════════════
   ELEVATION GRID
═══════════════════════════════════════════════════════════ */
function ElevGrid({
  view,
  proj,
  elevY,
  gridSize,
  scale,
  gridN,
  elevPoints,
  selectedPoint,
  onPointClick,
}: {
  view: ViewDir;
  proj: ProjFn;
  elevY: number;
  gridSize: number;
  scale: number;
  /** Half-extent in grid cells: grid runs from -gridN to +gridN in X and Z. */
  gridN: number;
  elevPoints: P3[];
  selectedPoint: [number, number] | null;
  onPointClick: ((x: number, z: number) => void) | null;
}) {
  const n = gridN;
  // Compass labels sit at the outermost grid line so they always frame the grid.
  const compassR = n * gridSize;
  const lines: React.ReactNode[] = [];
  const ln = (key: string, p1: P2, p2: P2, bold: boolean, dash: boolean) => (
    <line
      key={key}
      x1={p1[0]}
      y1={p1[1]}
      x2={p2[0]}
      y2={p2[1]}
      stroke={MOON}
      strokeWidth={bold ? 1.5 : 0.8}
      strokeDasharray={dash ? "5 5" : undefined}
      vectorEffect="non-scaling-stroke"
    />
  );

  // Elevation at any grid node, falling back to the base elevation
  const getElev = (xi: number, zi: number): number => {
    const ep = elevPoints.find(
      (p) =>
        Math.round(p[0] / gridSize) === xi &&
        Math.round(p[2] / gridSize) === zi,
    );
    return ep ? ep[1] : elevY;
  };

  // Terrain-following XZ grid — rendered for every view; proj maps it correctly
  // to a plan mesh (top/iso) or a terrain profile (side views).
  for (let xi = -n; xi <= n; xi++) {
    const isO = xi === 0;
    const pts = Array.from({ length: 2 * n + 1 }, (_, k) => {
      const zi = k - n;
      const [px, py] = proj([xi * gridSize, getElev(xi, zi), zi * gridSize]);
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    });
    lines.push(
      <polyline
        key={`gx${xi}`}
        points={pts.join(" ")}
        fill="none"
        stroke={MOON}
        strokeWidth={isO ? 1.5 : 0.8}
        strokeDasharray={isO ? undefined : "5 5"}
        vectorEffect="non-scaling-stroke"
      />,
    );
  }
  for (let zi = -n; zi <= n; zi++) {
    const isO = zi === 0;
    const pts = Array.from({ length: 2 * n + 1 }, (_, k) => {
      const xi = k - n;
      const [px, py] = proj([xi * gridSize, getElev(xi, zi), zi * gridSize]);
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    });
    lines.push(
      <polyline
        key={`gz${zi}`}
        points={pts.join(" ")}
        fill="none"
        stroke={MOON}
        strokeWidth={isO ? 1.5 : 0.8}
        strokeDasharray={isO ? undefined : "5 5"}
        vectorEffect="non-scaling-stroke"
      />,
    );
  }

  // Plan-view extras: north indicator + interactive dots
  const isPlanView =
    view === "top" || view === "bottom" || view.startsWith("iso");
  if (isPlanView) {
    // — Compass labels (N / S / E / W) at the four grid edges —
    // Each label projects to a completely different screen position in every
    // view, making orientation unambiguous even for a flat symmetric grid.
    const compassLabel = (
      key: string,
      worldPos: P3,
      dirPos: P3, // one step further out, used to push the label clear of the grid
      label: string,
      isNorth: boolean,
    ) => {
      const [tx, ty] = proj(worldPos);
      const [dx, dy] = proj(dirPos);
      const len = Math.sqrt((dx - tx) ** 2 + (dy - ty) ** 2) || 1;
      const ux2 = (dx - tx) / len;
      const uy2 = (dy - ty) / len;
      const perp = { ux: -uy2, uy: ux2 };
      const pad = (isNorth ? 18 : 12) / scale; // label offset in scene units
      const arrowSz = isNorth ? 10 / scale : 0;
      const lx = tx + ux2 * pad;
      const ly = ty + uy2 * pad;
      const nodes: React.ReactNode[] = [];
      if (isNorth) {
        // Bold filled arrowhead for N
        nodes.push(
          <polygon
            key={`${key}-arrow`}
            points={[
              `${tx + ux2 * arrowSz},${ty + uy2 * arrowSz}`,
              `${tx + perp.ux * arrowSz - ux2 * arrowSz},${ty + perp.uy * arrowSz - uy2 * arrowSz}`,
              `${tx - perp.ux * arrowSz - ux2 * arrowSz},${ty - perp.uy * arrowSz - uy2 * arrowSz}`,
            ].join(" ")}
            fill={PURPLE}
          />,
        );
      }
      nodes.push(
        <text
          key={`${key}-text`}
          x={lx}
          y={ly}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={(isNorth ? 15 : 11) / scale}
          fill={isNorth ? PURPLE : MUTED}
          fontFamily="system-ui, -apple-system, sans-serif"
          fontWeight={isNorth ? "800" : "600"}
          style={
            { pointerEvents: "none", userSelect: "none" } as React.CSSProperties
          }
        >
          {label}
        </text>,
      );
      return nodes;
    };

    const pad = gridSize * 0.6; // how far outside the outermost line to place labels
    lines.push(
      ...compassLabel(
        "N",
        [0, elevY, compassR],
        [0, elevY, compassR + pad],
        "N",
        true,
      ),
      ...compassLabel(
        "S",
        [0, elevY, -compassR],
        [0, elevY, -compassR - pad],
        "S",
        false,
      ),
      ...compassLabel(
        "E",
        [compassR, elevY, 0],
        [compassR + pad, elevY, 0],
        "E",
        false,
      ),
      ...compassLabel(
        "W",
        [-compassR, elevY, 0],
        [-compassR - pad, elevY, 0],
        "W",
        false,
      ),
    );

    // — Interactive dots —
    if (onPointClick !== null) {
      const r = 3.5 / scale;
      for (let xi = -n; xi <= n; xi++) {
        for (let zi = -n; zi <= n; zi++) {
          const wx = xi * gridSize;
          const wz = zi * gridSize;
          // Find custom elevation for this node
          const ep = elevPoints.find(
            (p) =>
              Math.round(p[0] / gridSize) === xi &&
              Math.round(p[2] / gridSize) === zi,
          );
          const nodeY = ep ? ep[1] : elevY;
          // Is this node selected?
          const isSel =
            selectedPoint !== null &&
            Math.round(selectedPoint[0] / gridSize) === xi &&
            Math.round(selectedPoint[1] / gridSize) === zi;
          const isModified = !!ep;

          // If elevation is modified, draw a vertical pole from elevY to nodeY
          if (isModified && Math.abs(nodeY - elevY) > 0.5) {
            const [px1, py1] = proj([wx, elevY, wz]);
            const [px2, py2] = proj([wx, nodeY, wz]);
            lines.push(
              <line
                key={`pole${xi}_${zi}`}
                x1={px1}
                y1={py1}
                x2={px2}
                y2={py2}
                stroke={PURPLE}
                strokeWidth={1}
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />,
            );
          }

          const [cx2, cy2] = proj([wx, nodeY, wz]);
          lines.push(
            <circle
              key={`dot${xi}_${zi}`}
              cx={cx2}
              cy={cy2}
              r={r}
              fill={isSel ? PURPLE : isModified ? "#d5cde8" : "transparent"}
              stroke={isSel ? "#fff" : PURPLE}
              strokeWidth={isSel ? 1.5 : 0.8}
              strokeOpacity={isModified || isSel ? 1 : 0.35}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: "pointer" }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onPointClick(wx, wz);
              }}
            />,
          );
        }
      }
    }
  }
  return <g>{lines}</g>;
}

/* ═══════════════════════════════════════════════════════════
   SCENE RENDERER
═══════════════════════════════════════════════════════════ */
interface SceneRendererProps {
  scene: Scene;
  view: ViewDir;
  vpW: number;
  vpH: number;
  panX: number;
  panY: number;
  zoom: number;
  isDragging: boolean;
  sunDir: P3 | null;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
  gridSize: number;
  elevPoints: P3[];
  selectedGridPoint: [number, number] | null;
  onGridPointClick: ((x: number, z: number) => void) | null;
  showGrid: boolean;
  gridFaint: boolean;
  isEditingGrid: boolean;
}

function SceneRenderer({
  scene,
  view,
  vpW,
  vpH,
  panX,
  panY,
  zoom,
  isDragging,
  sunDir,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  showGrid,
  gridFaint,
  isEditingGrid,
  gridSize,
  elevPoints,
  selectedGridPoint,
  onGridPointClick,
}: SceneRendererProps) {
  const proj = getProj(view);
  const scale = BASE_SCALE * zoom;
  const camDir = CAM_DIR[view];

  // Grid half-extent: a few cells beyond the scene's world-space XZ footprint.
  let maxAbsXZ = 0;
  for (const item of scene.items)
    for (const geo of item.geos)
      for (const [x, , z] of geo.vertices)
        maxAbsXZ = Math.max(maxAbsXZ, Math.abs(x), Math.abs(z));
  const gridN = Math.max(4, Math.ceil(maxAbsXZ / gridSize) + 3);

  // Split faces into visible and hidden (back-facing)
  const visibleFaces: { face: MeshFace; depth: number }[] = [];
  const hiddenFaces: { face: MeshFace; depth: number }[] = [];
  for (const item of scene.items)
    for (const geo of item.geos)
      for (const face of geo.faces) {
        const depth = dot3(ctr3(face.vertices), camDir);
        (faceVisible(face, view) ? visibleFaces : hiddenFaces).push({
          face,
          depth,
        });
      }
  // Back-to-front for painter's algorithm
  visibleFaces.sort((a, b) => a.depth - b.depth);
  hiddenFaces.sort((a, b) => a.depth - b.depth);

  const cx = vpW / 2 + panX,
    cy = vpH / 2 + panY;
  return (
    <svg
      width={vpW}
      height={vpH}
      style={{
        display: "block",
        touchAction: "none",
        cursor: isDragging ? "grabbing" : "grab",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={onWheel}
    >
      <rect width={vpW} height={vpH} fill={BG} />
      <HatchDefs />
      <g transform={`translate(${cx},${cy}) scale(${scale})`}>
        {showGrid && (
          <g opacity={gridFaint ? 0.18 : 1}>
            <ElevGrid
              key={view}
              view={view}
              proj={proj}
              elevY={scene.elevY}
              gridSize={gridSize}
              scale={scale}
              gridN={gridN}
              elevPoints={elevPoints}
              selectedPoint={isEditingGrid ? selectedGridPoint : null}
              onPointClick={isEditingGrid ? onGridPointClick : null}
            />
          </g>
        )}
        {/* Ground-plane shadows – only meaningful in top/iso views */}
        {sunDir &&
          (view === "top" || view === "bottom" || view.startsWith("iso")) &&
          scene.items.flatMap((item, ii) =>
            item.geos.map((geo, gi) => {
              const hull = computeShadowHull(geo, sunDir, scene.elevY, proj);
              return hull.length >= 3 ? (
                <path
                  key={`sh-${ii}-${gi}`}
                  d={toPath(hull)}
                  fill="rgba(80,60,120,0.18)"
                  stroke="none"
                />
              ) : null;
            }),
          )}
        {/* Hidden faces – dashed outlines behind visible geometry */}
        {hiddenFaces.map(({ face }, i) => (
          <path
            key={`h${i}`}
            d={toPath(face.vertices.map(proj))}
            fill="none"
            stroke={PURPLE}
            strokeOpacity={0.22}
            strokeWidth={1}
            strokeDasharray="3 4"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* Visible faces – hatch + stroke (drawn after dashes so they dominate) */}
        {visibleFaces.map(({ face }, i) => {
          const d = toPath(face.vertices.map(proj));
          return (
            <g key={`v${i}`}>
              <path d={d} fill={HATCH[face.kind]} />
              <path
                d={d}
                fill="none"
                stroke={PURPLE}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                strokeWidth={1.5}
              />
            </g>
          );
        })}
      </g>
      {/* View label */}
      <text
        x={vpW / 2}
        y={vpH - 14}
        textAnchor="middle"
        fill={MUTED}
        fontSize={11}
        fontFamily="system-ui, sans-serif"
        style={{
          pointerEvents: "none",
          userSelect: "none",
          letterSpacing: "0.05em",
        }}
      >
        {VIEW_LABEL[view]}
      </text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════
   VIEW CUBE  — context-sensitive 3×3 navigation grid

   Coordinate conventions (matching the sun system):
     X = East, Y = Up, Z = North

   Cardinal views — what you see when standing at that cardinal
   point and looking toward the scene center:
     south : standing south → facing north → east is on RIGHT
     north : standing north → facing south → east is on LEFT
     east  : standing east  → facing west  → north is on RIGHT, south on LEFT
     west  : standing west  → facing east  → north is on LEFT,  south on RIGHT

   ISO ring (clockwise from above): tne → tse → tsw → tnw → tne
   Each cell's left neighbour = next CCW iso, right = next CW iso.
   The two horizontal face cells follow the same handedness rule.
═══════════════════════════════════════════════════════════ */

type CellView = ViewDir | null;

// prettier-ignore
const VIEW_GRID: Record<ViewDir, [[CellView,CellView,CellView],[CellView,CellView,CellView],[CellView,CellView,CellView]]> = {
  //           SPOT 1        SPOT 2    SPOT 3
  //           SPOT 4        SPOT 5    SPOT 6
  //           SPOT 7        SPOT 8    SPOT 9
  //
  // Spot 2 is always Top, spot 8 is always Bottom.
  // Spot 5 is the "context" view (the non-top/bottom view whose grid is shown).
  // Top/Bottom entries below are fallbacks; the ViewCube uses gridContext instead.
  top: [
    ["iso-tnw",  "north",   "iso-tne"],
    ["west",     "top",     "east"   ],
    ["iso-tsw",  "south",   "iso-tse"],
  ],
  bottom: [
    [null,       "north",   null     ],
    ["west",     "bottom",  "east"   ],
    [null,       "south",   null     ],
  ],
  // CARDINAL VIEWS
  // Ring layout: spots 1,3 = top-iso neighbours sharing this face
  //              spots 7,9 = bottom-iso counterparts of spots 1,3
  // Standing NORTH, facing south: east on LEFT, west on RIGHT
  north: [
    ["iso-tne",  "top",     "iso-tnw"],
    ["east",     "north",   "west"   ],
    ["iso-bne",  "bottom",  "iso-bnw"],
  ],
  // Standing SOUTH, facing north: west on LEFT, east on RIGHT
  south: [
    ["iso-tsw",  "top",     "iso-tse"],
    ["west",     "south",   "east"   ],
    ["iso-bsw",  "bottom",  "iso-bse"],
  ],
  // Standing EAST, facing west: south on LEFT, north on RIGHT
  east: [
    ["iso-tse",  "top",     "iso-tne"],
    ["south",    "east",    "north"  ],
    ["iso-bse",  "bottom",  "iso-bne"],
  ],
  // Standing WEST, facing east: north on LEFT, south on RIGHT
  west: [
    ["iso-tnw",  "top",     "iso-tsw"],
    ["north",    "west",    "south"  ],
    ["iso-bnw",  "bottom",  "iso-bsw"],
  ],
  // TOP ISO VIEWS — ring CW from above: tne → tse → tsw → tnw → tne
  // Row 0: [CCW-top-iso, Top, CW-top-iso]
  // Row 2: [bottom-iso of CCW, Bottom, bottom-iso of CW]
  "iso-tne": [
    ["iso-tnw",  "top",     "iso-tse"],
    ["north",    "iso-tne", "east"   ],
    ["iso-bnw",  "bottom",  "iso-bse"],
  ],
  "iso-tse": [
    ["iso-tne",  "top",     "iso-tsw"],
    ["east",     "iso-tse", "south"  ],
    ["iso-bne",  "bottom",  "iso-bsw"],
  ],
  "iso-tsw": [
    ["iso-tse",  "top",     "iso-tnw"],
    ["south",    "iso-tsw", "west"   ],
    ["iso-bse",  "bottom",  "iso-bnw"],
  ],
  "iso-tnw": [
    ["iso-tsw",  "top",     "iso-tne"],
    ["west",     "iso-tnw", "north"  ],
    ["iso-bsw",  "bottom",  "iso-bne"],
  ],
  // BOTTOM ISO VIEWS — ring CW from above: bne → bse → bsw → bnw → bne
  // Row 0: [CCW-bottom-iso, Top, CW-bottom-iso]
  // Row 2: [top-iso of CCW, Bottom, top-iso of CW]
  "iso-bne": [
    ["iso-tnw",  "top",     "iso-tse"],
    ["north",    "iso-bne", "east"   ],
    ["iso-bnw",  "bottom",  "iso-bse"],
  ],
  "iso-bse": [
    ["iso-tne",  "top",     "iso-tsw"],
    ["east",     "iso-bse", "south"  ],
    ["iso-bne",  "bottom",  "iso-bsw"],
  ],
  "iso-bsw": [
    ["iso-tse",  "top",     "iso-tnw"],
    ["south",    "iso-bsw", "west"   ],
    ["iso-bse",  "bottom",  "iso-bnw"],
  ],
  "iso-bnw": [
    ["iso-tsw",  "top",     "iso-tne"],
    ["west",     "iso-bnw", "north"  ],
    ["iso-bsw",  "bottom",  "iso-bne"],
  ],
};

// Short labels shown inside each cell
const VIEW_SHORT: Record<ViewDir, string> = {
  top: "Top",
  bottom: "Bot",
  north: "N",
  south: "S",
  east: "E",
  west: "W",
  "iso-tne": "NE",
  "iso-tnw": "NW",
  "iso-tse": "SE",
  "iso-tsw": "SW",
  "iso-bne": "NE",
  "iso-bnw": "NW",
  "iso-bse": "SE",
  "iso-bsw": "SW",
};

function ViewCube({
  view,
  onView,
}: {
  view: ViewDir;
  onView: (v: ViewDir) => void;
}) {
  const [hovIdx, setHovIdx] = useState<number | null>(null);

  // gridContext determines the 3×3 grid layout and is always a non-top/bottom view.
  // When the user clicks Top (spot 2) or Bottom (spot 8) the grid doesn't change —
  // only which cell is highlighted moves. The context stays as the last iso/cardinal view.
  const isTopOrBottom = (v: ViewDir) => v === "top" || v === "bottom";
  const [gridContext, setGridContext] = useState<ViewDir>(
    isTopOrBottom(view) ? "iso-tnw" : view,
  );

  // Keep gridContext in sync with external view changes (e.g. initial load).
  useEffect(() => {
    if (!isTopOrBottom(view)) setGridContext(view);
  }, [view]);

  const grid = VIEW_GRID[gridContext];
  const CELL = 36,
    GAP = 1;

  // Which flat index (0-8) is the highlighted / "current" cell?
  //   spot 2 (index 1) = Top highlighted when view is top
  //   spot 8 (index 7) = Bottom highlighted when view is bottom
  //   spot 5 (index 4) = the gridContext view otherwise
  const highlightedIdx = view === "top" ? 1 : view === "bottom" ? 7 : 4;

  const handleCellClick = (cellView: ViewDir) => {
    if (!isTopOrBottom(cellView)) setGridContext(cellView);
    onView(cellView);
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        fontFamily: "system-ui, -apple-system, sans-serif",
        userSelect: "none",
      }}
    >
      {/* Current-view caption */}
      <div
        style={{
          textAlign: "center",
          fontSize: 9,
          color: MUTED,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 5,
        }}
      >
        {VIEW_LABEL[view]}
      </div>

      {/* 3 × 3 grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(3, ${CELL}px)`,
          gridTemplateRows: `repeat(3, ${CELL}px)`,
          gap: GAP,
          background: BORDER,
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 2px 12px rgba(0,0,0,0.14)",
        }}
      >
        {grid.flat().map((cellView, i) => {
          const isHighlighted = i === highlightedIdx;
          const clickable = !!cellView && !isHighlighted;
          const hovered = hovIdx === i && clickable;
          const isIso = cellView?.startsWith("iso");
          const isBotIso = cellView?.startsWith("iso-b");

          let bg: string;
          if (isHighlighted) bg = PURPLE;
          else if (!cellView) bg = BG;
          else if (hovered) bg = `${PURPLE}28`;
          else bg = PANEL;

          return (
            <div
              key={i}
              title={cellView ? VIEW_LABEL[cellView] : undefined}
              onClick={() => clickable && handleCellClick(cellView!)}
              onMouseEnter={() => clickable && setHovIdx(i)}
              onMouseLeave={() => setHovIdx(null)}
              style={{
                width: CELL,
                height: CELL,
                background: bg,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                cursor: clickable ? "pointer" : "default",
                gap: 2,
                transition: "background 0.08s",
              }}
            >
              {cellView && (
                <>
                  <span
                    style={{
                      fontSize: isHighlighted ? 12 : 11,
                      fontWeight: isHighlighted ? 700 : 500,
                      color: isHighlighted ? "#fff" : TEXT,
                      lineHeight: 1,
                    }}
                  >
                    {VIEW_SHORT[cellView]}
                  </span>
                  {isIso && (
                    <span
                      style={{
                        fontSize: 7,
                        color: isHighlighted ? "rgba(255,255,255,0.65)" : MUTED,
                        lineHeight: 1,
                      }}
                    >
                      {isBotIso ? "↓ iso" : "↑ iso"}
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   OPTIONS POPOVER
═══════════════════════════════════════════════════════════ */
function OptionsPopover({
  options,
  name,
  onChange,
  onClose,
}: {
  options: JourneyOptions;
  name: string;
  onChange: (u: { name?: string; options?: Partial<JourneyOptions> }) => void;
  onClose: () => void;
}) {
  const unitOpts: Array<{ value: Units; label: string }> = [
    { value: "architect imperial", label: "Architect Imperial  (1'-6\")" },
    { value: "engineer imperial", label: "Engineer Imperial  (1.50')" },
    { value: "metric", label: "Metric  (mm / m)" },
    { value: "px", label: "Pixels  (px)" },
  ];
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 8px",
    border: `1px solid ${BORDER}`,
    borderRadius: 6,
    fontSize: 12,
    color: TEXT,
    outline: "none",
    fontFamily: "system-ui, sans-serif",
    boxSizing: "border-box",
    background: BG,
  };
  const labelCapStyle: React.CSSProperties = {
    fontSize: 10,
    color: MUTED,
    marginBottom: 5,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    display: "block",
  };
  return (
    <div
      style={{
        position: "absolute",
        bottom: 52,
        left: 10,
        right: 10,
        background: PANEL,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        padding: 16,
        boxShadow: "0 4px 24px rgba(0,0,0,0.13)",
        zIndex: 200,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13, color: TEXT }}>
          Journey Options
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: MUTED,
            fontSize: 16,
            padding: 0,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      <label style={{ display: "block", marginBottom: 12 }}>
        <span style={labelCapStyle}>Journey Name</span>
        <input
          type="text"
          value={name}
          style={inputStyle}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>

      <div style={{ marginBottom: 12 }}>
        <span style={labelCapStyle}>Units</span>
        {unitOpts.map((o) => (
          <label
            key={o.value}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              marginBottom: 5,
              cursor: "pointer",
              fontSize: 12,
              color: TEXT,
            }}
          >
            <input
              type="radio"
              name="units"
              checked={options.units === o.value}
              onChange={() => onChange({ options: { units: o.value } })}
            />
            {o.label}
          </label>
        ))}
      </div>

      <label style={{ display: "block" }}>
        <span style={labelCapStyle}>Elevation Y</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="number"
            value={options.elevation_y}
            onChange={(e) =>
              onChange({ options: { elevation_y: Number(e.target.value) } })
            }
            style={{ ...inputStyle, width: 80 }}
          />
          <span style={{ fontSize: 11, color: MUTED }}>
            px = {fmtLen(options.elevation_y, options.units)}
          </span>
        </div>
      </label>

      <label style={{ display: "block", marginTop: 12 }}>
        <span style={labelCapStyle}>Grid Size</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="number"
            min={0}
            step={options.units === "metric" ? 10 : 0.25}
            value={
              Math.round(
                toLenUnit(options.gridSize ?? PX_PER_FOOT, options.units) *
                  1000,
              ) / 1000
            }
            onChange={(e) =>
              onChange({
                options: {
                  gridSize: fromLenUnit(Number(e.target.value), options.units),
                },
              })
            }
            style={{ ...inputStyle, width: 80 }}
          />
          <span style={{ fontSize: 11, color: MUTED }}>
            {lenUnitLabel(options.units)}
          </span>
        </div>
      </label>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   STEP EDITOR PANEL
═══════════════════════════════════════════════════════════ */
function StepEditorPanel({
  step,
  units,
  onChange,
  onDeleteStep,
  canDelete,
  availableItems,
  selectedGridPoint,
  onGridPointElevChange,
  journeyElevY,
  journey_gridSize,
}: {
  step: Step;
  units: Units;
  onChange: (s: Step) => void;
  onDeleteStep: () => void;
  canDelete: boolean;
  availableItems: SceneItem[];
  selectedGridPoint: [number, number] | null;
  onGridPointElevChange: (x: number, z: number, yAbs: number) => void;
  journeyElevY: number;
  journey_gridSize: number;
}) {
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "5px 7px",
    border: `1px solid ${BORDER}`,
    borderRadius: 5,
    fontSize: 12,
    color: TEXT,
    outline: "none",
    fontFamily: "system-ui, sans-serif",
    boxSizing: "border-box",
    background: PANEL,
  };
  const labelCapStyle: React.CSSProperties = {
    fontSize: 9,
    color: MUTED,
    marginBottom: 3,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    display: "block",
  };
  const ulabel = lenUnitLabel(units);
  const stepSize = units === "metric" ? 10 : 0.25;

  const updateInstr = (i: number, instr: Instruction) => {
    const instrs = [...step.instructions];
    instrs[i] = instr;
    onChange({ ...step, instructions: instrs });
  };

  const removeInstr = (i: number) => {
    onChange({
      ...step,
      instructions: step.instructions.filter((_, j) => j !== i),
    });
  };

  const addCubeInstr = () => {
    const newInstr: CubeInstruction = {
      type: "cube-instruction",
      mode: { type: "new" },
      width: PX_PER_FOOT,
      height: PX_PER_FOOT,
      depth: PX_PER_FOOT,
      location: { offset: [0, 0, 0], rotation: [0, 0, 0] },
    };
    onChange({ ...step, instructions: [...step.instructions, newInstr] });
  };

  const addPlaneInstr = () => {
    const newInstr: PlaneInstruction = {
      type: "plane-instruction",
      axis: "XZ",
      start: [0, 0],
      offset: journeyElevY,
      segments: [],
    };
    onChange({ ...step, instructions: [...step.instructions, newInstr] });
  };

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        borderTop: `1px solid ${BORDER}`,
        padding: "12px 14px 10px",
        background: PANEL,
      }}
    >
      {/* Step Name */}
      <label style={{ display: "block", marginBottom: 12 }}>
        <span style={labelCapStyle}>Step Name</span>
        <input
          type="text"
          value={step.id}
          style={inputStyle}
          onChange={(e) => onChange({ ...step, id: e.target.value })}
        />
      </label>

      {/* Instructions */}
      <div>
        <span style={labelCapStyle}>
          Instructions · {step.instructions.length}
        </span>

        {step.instructions.map((instr, i) => (
          <div
            key={i}
            style={{
              background: BG,
              borderRadius: 7,
              padding: "9px 10px 10px",
              marginBottom: 8,
              border: `1px solid ${BORDER}`,
            }}
          >
            {/* Instruction header row */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 9,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: PURPLE,
                  fontFamily: "monospace",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {instr.type === "cube-instruction"
                  ? "Cube"
                  : instr.type === "plane-instruction"
                    ? `Plane · ${instr.axis}`
                    : "Elevation Grid"}
              </span>
              <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                {/* Visibility toggle — planes and elevation grid */}
                {(instr.type === "plane-instruction" ||
                  instr.type === "elevation-grid-instruction") && (
                  <button
                    onClick={() =>
                      updateInstr(i, { ...instr, hidden: !instr.hidden })
                    }
                    title={instr.hidden ? "Show" : "Hide"}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: instr.hidden ? MUTED : PURPLE,
                      fontSize: 13,
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    {instr.hidden ? "○" : "●"}
                  </button>
                )}
                {/* Remove — cubes and planes */}
                {instr.type !== "elevation-grid-instruction" && (
                  <button
                    onClick={() => removeInstr(i)}
                    title="Remove instruction"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: MUTED,
                      fontSize: 15,
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {instr.type === "cube-instruction" && (
              <>
                {/* Mode */}
                <div style={{ marginBottom: 9 }}>
                  <span style={labelCapStyle}>Mode</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {(["new", "add", "subtract"] as const).map((m) => {
                      const active = instr.mode.type === m;
                      return (
                        <button
                          key={m}
                          onClick={() => {
                            const newMode =
                              m === "new"
                                ? ({ type: "new" } as const)
                                : ({
                                    type: m,
                                    referenceItemId:
                                      instr.mode.type !== "new"
                                        ? instr.mode.referenceItemId
                                        : (availableItems[0]?.id ?? ""),
                                  } as const);
                            updateInstr(i, { ...instr, mode: newMode });
                          }}
                          style={{
                            flex: 1,
                            padding: "4px 0",
                            border: `1px solid ${active ? PURPLE : BORDER}`,
                            borderRadius: 5,
                            background: active ? "#f0ebf8" : "transparent",
                            color: active ? PURPLE : MUTED,
                            cursor: "pointer",
                            fontSize: 11,
                            fontWeight: active ? 600 : 400,
                            textTransform: "capitalize",
                          }}
                        >
                          {m}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Reference item (add / subtract) */}
                {instr.mode.type !== "new" && (
                  <div style={{ marginBottom: 9 }}>
                    <span style={labelCapStyle}>Reference Item</span>
                    {availableItems.length === 0 ? (
                      <div style={{ fontSize: 11, color: MUTED }}>
                        No items from previous steps
                      </div>
                    ) : (
                      <select
                        value={instr.mode.referenceItemId}
                        onChange={(e) =>
                          updateInstr(i, {
                            ...instr,
                            mode: {
                              type: instr.mode.type as "add" | "subtract",
                              referenceItemId: e.target.value,
                            },
                          })
                        }
                        style={{ ...inputStyle }}
                      >
                        {availableItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.id}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {/* W / H / D */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 5,
                    marginBottom: 9,
                  }}
                >
                  {(["width", "height", "depth"] as const).map((dim) => (
                    <label key={dim}>
                      <span style={labelCapStyle}>
                        {dim} ({ulabel})
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={stepSize}
                        value={
                          Math.round(toLenUnit(instr[dim], units) * 1000) / 1000
                        }
                        style={{ ...inputStyle, padding: "4px 5px" }}
                        onChange={(e) =>
                          updateInstr(i, {
                            ...instr,
                            [dim]: fromLenUnit(Number(e.target.value), units),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>

                {/* Offset */}
                <div>
                  <span style={labelCapStyle}>Offset x / y / z ({ulabel})</span>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: 5,
                    }}
                  >
                    {([0, 1, 2] as const).map((axis) => (
                      <input
                        key={axis}
                        type="number"
                        step={stepSize}
                        value={
                          Math.round(
                            toLenUnit(instr.location.offset[axis], units) *
                              1000,
                          ) / 1000
                        }
                        style={{ ...inputStyle, padding: "4px 5px" }}
                        onChange={(e) => {
                          const newOffset = [...instr.location.offset] as P3;
                          newOffset[axis] = fromLenUnit(
                            Number(e.target.value),
                            units,
                          );
                          updateInstr(i, {
                            ...instr,
                            location: {
                              ...instr.location,
                              offset: newOffset,
                            },
                          });
                        }}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}

            {instr.type === "elevation-grid-instruction" &&
              (() => {
                const selPt = selectedGridPoint;

                const selEp = selPt
                  ? instr.grid.find(
                      (p) =>
                        Math.round(p[0] / journey_gridSize) ===
                          Math.round(selPt[0] / journey_gridSize) &&
                        Math.round(p[2] / journey_gridSize) ===
                          Math.round(selPt[1] / journey_gridSize),
                    )
                  : undefined;
                const selYAbs = selEp ? selEp[1] : journeyElevY;

                return (
                  <>
                    {instr.grid.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <span style={labelCapStyle}>Modified Points</span>
                        {instr.grid.map((p, pi) => {
                          const offset = p[1] - journeyElevY;
                          return (
                            <div
                              key={pi}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                marginBottom: 3,
                              }}
                            >
                              <span
                                style={{
                                  flex: 1,
                                  fontSize: 11,
                                  color: TEXT,
                                  fontFamily: "monospace",
                                }}
                              >
                                ({fmtLen(p[0], units)}, {fmtLen(p[2], units)})
                              </span>
                              <span style={{ fontSize: 11, color: MUTED }}>
                                {offset >= 0 ? "+" : ""}
                                {fmtLen(Math.abs(offset), units)}
                              </span>
                              <button
                                onClick={() => {
                                  const newGrid = instr.grid.filter(
                                    (_, j) => j !== pi,
                                  );
                                  onChange({
                                    ...step,
                                    instructions: step.instructions.map(
                                      (ins) =>
                                        ins === instr
                                          ? { ...instr, grid: newGrid }
                                          : ins,
                                    ),
                                  });
                                }}
                                style={{
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  color: MUTED,
                                  fontSize: 13,
                                  padding: 0,
                                  lineHeight: 1,
                                }}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {selPt && (
                      <div
                        style={{
                          marginBottom: 8,
                          padding: "8px 10px",
                          background: "#f0ebf8",
                          borderRadius: 6,
                        }}
                      >
                        <span style={labelCapStyle}>
                          Selected Point ({fmtLen(selPt[0], units)},{" "}
                          {fmtLen(selPt[1], units)})
                        </span>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span style={{ fontSize: 11, color: MUTED }}>
                            Offset
                          </span>
                          <input
                            type="number"
                            step={units === "metric" ? 10 : 0.25}
                            value={
                              Math.round(
                                toLenUnit(selYAbs - journeyElevY, units) * 1000,
                              ) / 1000
                            }
                            style={{
                              ...inputStyle,
                              width: 80,
                              padding: "4px 6px",
                            }}
                            onChange={(e) => {
                              const newYAbs =
                                journeyElevY +
                                fromLenUnit(Number(e.target.value), units);
                              onGridPointElevChange(
                                selPt[0],
                                selPt[1],
                                newYAbs,
                              );
                            }}
                          />
                          <span style={{ fontSize: 11, color: MUTED }}>
                            {lenUnitLabel(units)}
                          </span>
                        </div>
                      </div>
                    )}
                    {!selPt && (
                      <span style={{ fontSize: 11, color: MUTED }}>
                        Click a grid point to set its elevation.
                      </span>
                    )}
                  </>
                );
              })()}

            {/* ──── PLANE INSTRUCTION ──── */}
            {instr.type === "plane-instruction" &&
              (() => {
                const pl = instr as PlaneInstruction;
                const updatePl = (patch: Partial<PlaneInstruction>) =>
                  updateInstr(i, { ...pl, ...patch });

                const axisLabels: Record<PlaneInstruction["axis"], string> = {
                  XZ: "Floor / ceiling (horizontal)",
                  XY: "Wall — S/N facing (vertical)",
                  ZY: "Wall — E/W facing (vertical)",
                };
                const startLabels: Record<
                  PlaneInstruction["axis"],
                  [string, string]
                > = {
                  XZ: ["X — East", "Z — South"],
                  XY: ["X — East", "Y — Up"],
                  ZY: ["Z — South", "Y — Up"],
                };
                const offsetLabels: Record<PlaneInstruction["axis"], string> = {
                  XZ: "Y — Elevation",
                  XY: "Z — Depth",
                  ZY: "X — Position",
                };

                const dirBtns =
                  pl.axis === "XZ"
                    ? [
                        { label: "N", angle: 0 },
                        { label: "E", angle: 90 },
                        { label: "S", angle: 180 },
                        { label: "W", angle: 270 },
                      ]
                    : [
                        { label: "→", angle: 0 },
                        { label: "↑", angle: 90 },
                        { label: "←", angle: 180 },
                        { label: "↓", angle: 270 },
                      ];

                const pts2D = computePlanePoints(pl);
                const pvW = 108,
                  pvH = 72,
                  pvPad = 10;
                const uArr = pts2D.map((p) => p[0]);
                const vArr = pts2D.map((p) => p[1]);
                const minU = Math.min(...uArr),
                  maxU = Math.max(...uArr);
                const minV = Math.min(...vArr),
                  maxV = Math.max(...vArr);
                const rangeU = Math.max(maxU - minU, 1);
                const rangeV = Math.max(maxV - minV, 1);
                const sc = Math.min(
                  (pvW - pvPad * 2) / rangeU,
                  (pvH - pvPad * 2) / rangeV,
                );
                const offU = pvW / 2 - ((minU + maxU) / 2) * sc;
                const offV = pvH / 2 + ((minV + maxV) / 2) * sc;
                const toSvg = ([u, v]: P2): P2 => [
                  offU + u * sc,
                  pl.axis === "XZ" ? offV + v * sc : offV - v * sc,
                ];
                const svgPts = pts2D.map(toSvg);
                const pathD =
                  svgPts.length > 1
                    ? "M " +
                      svgPts[0][0].toFixed(1) +
                      " " +
                      svgPts[0][1].toFixed(1) +
                      " " +
                      svgPts
                        .slice(1)
                        .map(
                          (p) => "L " + p[0].toFixed(1) + " " + p[1].toFixed(1),
                        )
                        .join(" ") +
                      " Z"
                    : "";

                const [sl0, sl1] = startLabels[pl.axis];

                return (
                  <>
                    {/* Axis selector */}
                    <div style={{ marginBottom: 9 }}>
                      <span style={labelCapStyle}>Plane</span>
                      <div style={{ display: "flex", gap: 4, marginBottom: 3 }}>
                        {(["XZ", "XY", "ZY"] as const).map((ax) => {
                          const active = pl.axis === ax;
                          return (
                            <button
                              key={ax}
                              onClick={() => updatePl({ axis: ax })}
                              title={axisLabels[ax]}
                              style={{
                                flex: 1,
                                padding: "4px 0",
                                border: `1px solid ${active ? PURPLE : BORDER}`,
                                borderRadius: 5,
                                background: active ? "#f0ebf8" : "transparent",
                                color: active ? PURPLE : MUTED,
                                cursor: "pointer",
                                fontSize: 11,
                                fontWeight: active ? 600 : 400,
                                fontFamily: "monospace",
                              }}
                            >
                              {ax}
                            </button>
                          );
                        })}
                      </div>
                      <span style={{ fontSize: 10, color: MUTED }}>
                        {axisLabels[pl.axis]}
                      </span>
                    </div>

                    {/* Start point + offset */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr 1fr",
                        gap: 5,
                        marginBottom: 9,
                      }}
                    >
                      <label>
                        <span style={labelCapStyle}>
                          {sl0} ({ulabel})
                        </span>
                        <input
                          type="number"
                          step={stepSize}
                          value={
                            Math.round(toLenUnit(pl.start[0], units) * 1000) /
                            1000
                          }
                          style={{ ...inputStyle, padding: "4px 5px" }}
                          onChange={(e) =>
                            updatePl({
                              start: [
                                fromLenUnit(Number(e.target.value), units),
                                pl.start[1],
                              ],
                            })
                          }
                        />
                      </label>
                      <label>
                        <span style={labelCapStyle}>
                          {sl1} ({ulabel})
                        </span>
                        <input
                          type="number"
                          step={stepSize}
                          value={
                            Math.round(toLenUnit(pl.start[1], units) * 1000) /
                            1000
                          }
                          style={{ ...inputStyle, padding: "4px 5px" }}
                          onChange={(e) =>
                            updatePl({
                              start: [
                                pl.start[0],
                                fromLenUnit(Number(e.target.value), units),
                              ],
                            })
                          }
                        />
                      </label>
                      <label>
                        <span style={labelCapStyle}>
                          {offsetLabels[pl.axis]} ({ulabel})
                        </span>
                        <input
                          type="number"
                          step={stepSize}
                          value={
                            Math.round(toLenUnit(pl.offset, units) * 1000) /
                            1000
                          }
                          style={{ ...inputStyle, padding: "4px 5px" }}
                          onChange={(e) =>
                            updatePl({
                              offset: fromLenUnit(
                                Number(e.target.value),
                                units,
                              ),
                            })
                          }
                        />
                      </label>
                    </div>

                    {/* Segments list */}
                    <div style={{ marginBottom: 9 }}>
                      <span style={labelCapStyle}>
                        Segments{" "}
                        {pl.segments.length > 0
                          ? `· ${pl.segments.length} — closes back to start`
                          : "· none yet"}
                      </span>

                      {pl.segments.map((seg, si) => (
                        <div
                          key={si}
                          style={{
                            display: "flex",
                            gap: 4,
                            alignItems: "flex-end",
                            marginBottom: 5,
                          }}
                        >
                          {/* Index */}
                          <span
                            style={{
                              fontSize: 9,
                              color: MUTED,
                              fontFamily: "monospace",
                              minWidth: 14,
                              textAlign: "right",
                              paddingBottom: 5,
                            }}
                          >
                            {si + 1}
                          </span>

                          {/* Distance */}
                          <label style={{ flex: 1 }}>
                            <span style={labelCapStyle}>dist ({ulabel})</span>
                            <input
                              type="number"
                              min={0}
                              step={stepSize}
                              value={
                                Math.round(
                                  toLenUnit(seg.distance, units) * 1000,
                                ) / 1000
                              }
                              style={{ ...inputStyle, padding: "4px 5px" }}
                              onChange={(e) => {
                                const segs = [...pl.segments];
                                segs[si] = {
                                  ...seg,
                                  distance: fromLenUnit(
                                    Number(e.target.value),
                                    units,
                                  ),
                                };
                                updatePl({ segments: segs });
                              }}
                            />
                          </label>

                          {/* Angle */}
                          <label style={{ flex: 1 }}>
                            <span style={labelCapStyle}>
                              {pl.axis === "XZ" ? "bearing °" : "angle °"}
                            </span>
                            <input
                              type="number"
                              step={1}
                              value={Math.round(seg.angle * 10) / 10}
                              style={{ ...inputStyle, padding: "4px 5px" }}
                              onChange={(e) => {
                                const segs = [...pl.segments];
                                segs[si] = {
                                  ...seg,
                                  angle: Number(e.target.value),
                                };
                                updatePl({ segments: segs });
                              }}
                            />
                          </label>

                          {/* Quick-direction 2×2 grid */}
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: 2,
                              paddingBottom: 2,
                            }}
                          >
                            {dirBtns.map((d) => (
                              <button
                                key={d.angle}
                                title={`${d.label} (${d.angle}°)`}
                                onClick={() => {
                                  const segs = [...pl.segments];
                                  segs[si] = { ...seg, angle: d.angle };
                                  updatePl({ segments: segs });
                                }}
                                style={{
                                  width: 18,
                                  height: 18,
                                  fontSize: 9,
                                  border: `1px solid ${
                                    seg.angle === d.angle ? PURPLE : BORDER
                                  }`,
                                  borderRadius: 3,
                                  background:
                                    seg.angle === d.angle
                                      ? "#f0ebf8"
                                      : "transparent",
                                  color: seg.angle === d.angle ? PURPLE : MUTED,
                                  cursor: "pointer",
                                  padding: 0,
                                  lineHeight: 1,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                {d.label}
                              </button>
                            ))}
                          </div>

                          {/* Remove segment */}
                          <button
                            onClick={() => {
                              const segs = pl.segments.filter(
                                (_, j) => j !== si,
                              );
                              updatePl({ segments: segs });
                            }}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              color: MUTED,
                              fontSize: 13,
                              padding: 0,
                              paddingBottom: 4,
                              lineHeight: 1,
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}

                      {/* Add segment button */}
                      <button
                        onClick={() =>
                          updatePl({
                            segments: [
                              ...pl.segments,
                              { distance: PX_PER_FOOT, angle: 0 },
                            ],
                          })
                        }
                        style={{
                          width: "100%",
                          marginTop: 3,
                          padding: "4px 0",
                          border: `1px dashed ${BORDER}`,
                          borderRadius: 5,
                          background: "transparent",
                          color: MUTED,
                          cursor: "pointer",
                          fontSize: 11,
                        }}
                      >
                        + Add Segment
                      </button>
                    </div>

                    {/* Inline preview SVG */}
                    {pl.segments.length > 0 && (
                      <div>
                        <span style={labelCapStyle}>
                          Preview — {pts2D.length} pts
                        </span>
                        <div
                          style={{
                            background: "#f0ebf8",
                            borderRadius: 6,
                            padding: 4,
                            display: "flex",
                            justifyContent: "center",
                          }}
                        >
                          <svg
                            width={pvW}
                            height={pvH}
                            style={{ display: "block", overflow: "visible" }}
                          >
                            {pathD && (
                              <path
                                d={pathD}
                                fill="rgba(127,91,139,0.14)"
                                stroke={PURPLE}
                                strokeWidth={1.5}
                                strokeLinejoin="round"
                              />
                            )}
                            {svgPts[0] && (
                              <circle
                                cx={svgPts[0][0]}
                                cy={svgPts[0][1]}
                                r={3}
                                fill={PURPLE}
                              />
                            )}
                            {svgPts.length > 1 &&
                              svgPts.slice(0, -1).map(([ax, ay], ki) => {
                                const [bx, by] = svgPts[ki + 1];
                                const mx = (ax + bx) / 2;
                                const my = (ay + by) / 2;
                                const ddx = bx - ax;
                                const ddy = by - ay;
                                const len = Math.sqrt(ddx * ddx + ddy * ddy);
                                if (len < 4) return null;
                                const ux = ddx / len;
                                const uy = ddy / len;
                                const hs = 4;
                                return (
                                  <polygon
                                    key={ki}
                                    points={
                                      `${(mx + ux * hs).toFixed(1)},${(my + uy * hs).toFixed(1)} ` +
                                      `${(mx - ux * hs - uy * hs * 0.6).toFixed(1)},${(my - uy * hs + ux * hs * 0.6).toFixed(1)} ` +
                                      `${(mx - ux * hs + uy * hs * 0.6).toFixed(1)},${(my - uy * hs - ux * hs * 0.6).toFixed(1)}`
                                    }
                                    fill={PURPLE}
                                    opacity={0.6}
                                  />
                                );
                              })}
                          </svg>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
          </div>
        ))}

        {/* Add cube + delete step row */}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={addCubeInstr}
            style={{
              flex: 1,
              padding: "7px 0",
              border: `1px dashed ${BORDER}`,
              borderRadius: 6,
              background: "transparent",
              color: MUTED,
              cursor: "pointer",
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
            }}
          >
            + Add Cube
          </button>
          <button
            onClick={addPlaneInstr}
            style={{
              flex: 1,
              padding: "7px 0",
              border: `1px dashed ${BORDER}`,
              borderRadius: 6,
              background: "transparent",
              color: MUTED,
              cursor: "pointer",
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
            }}
          >
            + Add Plane
          </button>
          <button
            onClick={onDeleteStep}
            disabled={!canDelete}
            title="Delete step"
            style={{
              width: 32,
              border: `1px solid ${canDelete ? BORDER : "#eee"}`,
              borderRadius: 6,
              background: "transparent",
              color: canDelete ? MUTED : "#ddd",
              cursor: canDelete ? "pointer" : "default",
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   JOURNEY COLUMN
═══════════════════════════════════════════════════════════ */
function JourneyColumn({
  journey,
  stepIdx,
  onStep,
  onChange,
  selectedGridPoint,
  onGridPointElevChange,
}: {
  journey: Journey;
  stepIdx: number;
  onStep: (i: number) => void;
  onChange: (j: Journey) => void;
  selectedGridPoint: [number, number] | null;
  onGridPointElevChange: (x: number, z: number, yAbs: number) => void;
}) {
  const [showOpts, setShowOpts] = useState(false);
  const total = journey.steps.length;

  const handleOptChange = (u: {
    name?: string;
    options?: Partial<JourneyOptions>;
  }) => {
    onChange({
      ...journey,
      name: u.name ?? journey.name,
      options: { ...journey.options, ...u.options },
    });
  };

  const updateCurrentStep = (updated: Step) => {
    const steps = [...journey.steps];
    steps[stepIdx] = updated;
    onChange({ ...journey, steps });
  };

  const addStep = () => {
    const newStep: Step = {
      id: `step-${journey.steps.length + 1}`,
      instructions: [],
    };
    const steps = [...journey.steps, newStep];
    onChange({ ...journey, steps });
    onStep(steps.length - 1);
    setShowOpts(false);
  };

  const deleteStep = (i: number) => {
    if (journey.steps.length <= 1) return;
    const steps = journey.steps.filter((_, j) => j !== i);
    onChange({ ...journey, steps });
    onStep(Math.min(stepIdx, steps.length - 1));
  };

  const iconBtn = (active: boolean, disabled = false): React.CSSProperties => ({
    width: 32,
    height: 36,
    border: "none",
    borderRadius: 6,
    cursor: disabled ? "default" : "pointer",
    background: active ? PURPLE : "#ece9e4",
    color: active ? "#fff" : disabled ? "#ccc" : MUTED,
    fontSize: 15,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  });

  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "8px 0",
    border: "none",
    borderRadius: 6,
    background: disabled ? "#ece9e4" : PURPLE,
    color: disabled ? MUTED : "#fff",
    cursor: disabled ? "default" : "pointer",
    fontSize: 15,
    fontWeight: 500,
    transition: "background 0.15s",
  });

  return (
    <div
      style={{
        width: 272,
        minWidth: 272,
        height: "100vh",
        background: PANEL,
        borderRight: `1px solid ${BORDER}`,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        fontFamily: "system-ui, -apple-system, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "18px 16px 14px",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: MUTED,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 4,
          }}
        >
          Journey
        </div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: TEXT,
            lineHeight: 1.3,
          }}
        >
          {journey.name}
        </div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>
          {total} step{total !== 1 ? "s" : ""} · {journey.options.units}
        </div>
      </div>

      {/* Steps */}
      <div style={{ overflowY: "auto", padding: "8px 0", maxHeight: 220 }}>
        {journey.steps.map((step, i) => {
          const isCurrent = i === stepIdx;
          const isPast = i < stepIdx;
          return (
            <button
              key={step.id}
              onClick={() => onStep(i)}
              style={{
                width: "100%",
                textAlign: "left",
                background: isCurrent ? "#f0ebf8" : "transparent",
                border: "none",
                borderLeft: isCurrent
                  ? `3px solid ${PURPLE}`
                  : "3px solid transparent",
                padding: "10px 16px",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: isCurrent
                      ? PURPLE
                      : isPast
                        ? "#d5cde8"
                        : "#eee",
                    fontSize: 8,
                    fontWeight: 700,
                    color: isCurrent ? "#fff" : isPast ? PURPLE : MUTED,
                  }}
                >
                  {isPast ? "✓" : i + 1}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: isCurrent ? 600 : 400,
                      color: isCurrent ? TEXT : isPast ? "#555" : MUTED,
                      fontFamily: "monospace",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {step.id}
                  </div>
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>
                    {step.instructions.length} instruction
                    {step.instructions.length !== 1 ? "s" : ""}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Step editor – always visible for the current step */}
      <StepEditorPanel
        step={journey.steps[stepIdx]}
        units={journey.options.units}
        onChange={updateCurrentStep}
        onDeleteStep={() => deleteStep(stepIdx)}
        canDelete={total > 1}
        availableItems={buildScene(journey, stepIdx - 1).items}
        selectedGridPoint={selectedGridPoint}
        onGridPointElevChange={onGridPointElevChange}
        journeyElevY={journey.options.elevation_y}
        journey_gridSize={journey.options.gridSize ?? PX_PER_FOOT}
      />

      {/* Footer */}
      <div
        style={{
          padding: "12px 10px",
          borderTop: `1px solid ${BORDER}`,
          display: "flex",
          gap: 6,
          position: "relative",
        }}
      >
        <button
          onClick={() => onStep(Math.max(0, stepIdx - 1))}
          disabled={stepIdx === 0}
          style={btnStyle(stepIdx === 0)}
        >
          ←
        </button>
        <button
          onClick={() => onStep(Math.min(total - 1, stepIdx + 1))}
          disabled={stepIdx === total - 1}
          style={btnStyle(stepIdx === total - 1)}
        >
          →
        </button>
        {/* Add step */}
        <button onClick={addStep} title="Add step" style={iconBtn(false)}>
          +
        </button>

        {/* Journey options */}
        <button
          onClick={() => setShowOpts((v) => !v)}
          title="Journey options"
          style={iconBtn(showOpts)}
        >
          ⚙
        </button>

        {showOpts && (
          <OptionsPopover
            options={journey.options}
            name={journey.name}
            onChange={handleOptChange}
            onClose={() => setShowOpts(false)}
          />
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DEFAULT JOURNEY  (1'×1'×1' cube at origin, elevation grid)
═══════════════════════════════════════════════════════════ */
const DEFAULT_JOURNEY: Journey = {
  name: "My First Space",
  options: {
    elevation_y: 0,
    units: "architect imperial",
    gridSize: PX_PER_FOOT,
  },
  steps: [
    {
      id: "plot-of-land",
      instructions: [{ type: "elevation-grid-instruction", grid: [] }],
    },
    {
      id: "base-cube",
      instructions: [
        {
          type: "cube-instruction",
          mode: { type: "new" },
          width: PX_PER_FOOT,
          height: PX_PER_FOOT,
          depth: PX_PER_FOOT,
          // Center the cube around the origin in X and Z
          location: {
            offset: [-PX_PER_FOOT / 2, 0, -PX_PER_FOOT / 2],
            rotation: [0, 0, 0],
          },
        },
      ],
    },
  ],
};

/* ═══════════════════════════════════════════════════════════
   SUN PANEL  (bottom-right controls)
═══════════════════════════════════════════════════════════ */
function SunPanel({
  settings,
  onChange,
}: {
  settings: SunSettings;
  onChange: (s: SunSettings) => void;
}) {
  const [open, setOpen] = useState(false);

  const { altitude, azimuth } = computeSolarPos(
    settings.lat,
    settings.month,
    settings.day,
    settings.hour,
  );
  const sunAbove = altitude > 1e-3;
  const altDeg = ((altitude * 180) / Math.PI).toFixed(1);
  const azDeg = Math.round((azimuth * 180) / Math.PI);

  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  const inp: React.CSSProperties = {
    width: "100%",
    padding: "5px 8px",
    border: `1px solid ${BORDER}`,
    borderRadius: 6,
    fontSize: 12,
    color: TEXT,
    outline: "none",
    fontFamily: "system-ui, sans-serif",
    boxSizing: "border-box",
    background: BG,
  };
  const cap: React.CSSProperties = {
    fontSize: 10,
    color: MUTED,
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    display: "block",
  };

  return (
    <>
      {/* Badge / toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "absolute",
          bottom: 16,
          right: 16,
          zIndex: 110,
          background: open ? PURPLE : PANEL,
          border: `1px solid ${open ? PURPLE : BORDER}`,
          borderRadius: 10,
          padding: "7px 13px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          color: open ? "#fff" : TEXT,
          boxShadow: "0 2px 12px rgba(0,0,0,0.10)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <span style={{ fontSize: 15 }}>{sunAbove ? "☀" : "○"}</span>
        <span>
          {settings.cityName} · {MONTHS[settings.month - 1]} {settings.day} ·{" "}
          {fmtHour(settings.hour)}
        </span>
      </button>

      {/* Expanded panel */}
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: 60,
            right: 16,
            zIndex: 100,
            background: PANEL,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: 16,
            width: 290,
            boxShadow: "0 4px 24px rgba(0,0,0,0.14)",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>
              ☀ Sun &amp; Location
            </span>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: MUTED,
                fontSize: 16,
                padding: 0,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          {/* Sun status */}
          <div
            style={{
              background: sunAbove ? "#fff9e0" : BG,
              borderRadius: 8,
              padding: "8px 10px",
              marginBottom: 14,
              fontSize: 11,
              color: MUTED,
            }}
          >
            {sunAbove
              ? `Altitude ${altDeg}°  ·  Azimuth ${azDeg}° (${toCardinal(azDeg)})`
              : "Sun is below the horizon — no shadow"}
          </div>

          {/* Location */}
          <div style={{ marginBottom: 12 }}>
            <span style={cap}>Location</span>
            <select
              value={settings.cityName}
              onChange={(e) => {
                const preset = CITY_PRESETS.find(
                  (c) => c.name === e.target.value,
                );
                if (preset && preset.name !== "Custom") {
                  onChange({
                    ...settings,
                    lat: preset.lat,
                    lon: preset.lon,
                    cityName: preset.name,
                  });
                } else {
                  onChange({ ...settings, cityName: "Custom" });
                }
              }}
              style={{ ...inp, marginBottom: 6 }}
            >
              {CITY_PRESETS.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 6 }}>
              <label style={{ flex: 1 }}>
                <span style={cap}>Latitude</span>
                <input
                  type="number"
                  step="0.01"
                  min={-90}
                  max={90}
                  value={settings.lat}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      lat: Number(e.target.value),
                      cityName: "Custom",
                    })
                  }
                  style={inp}
                />
              </label>
              <label style={{ flex: 1 }}>
                <span style={cap}>Longitude</span>
                <input
                  type="number"
                  step="0.01"
                  min={-180}
                  max={180}
                  value={settings.lon}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      lon: Number(e.target.value),
                      cityName: "Custom",
                    })
                  }
                  style={inp}
                />
              </label>
            </div>
          </div>

          {/* Date */}
          <div style={{ marginBottom: 12 }}>
            <span style={cap}>Date</span>
            <div style={{ display: "flex", gap: 6 }}>
              <select
                value={settings.month}
                onChange={(e) =>
                  onChange({ ...settings, month: Number(e.target.value) })
                }
                style={{ ...inp, flex: 2 }}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={31}
                value={settings.day}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    day: Math.max(1, Math.min(31, Number(e.target.value))),
                  })
                }
                style={{ ...inp, flex: 1 }}
              />
            </div>
          </div>

          {/* Time */}
          <div>
            <span style={cap}>
              Time (solar noon = 12:00) &nbsp;·&nbsp; {fmtHour(settings.hour)}
            </span>
            <input
              type="range"
              min={0}
              max={23.75}
              step={0.25}
              value={settings.hour}
              onChange={(e) =>
                onChange({ ...settings, hour: Number(e.target.value) })
              }
              style={
                { width: "100%", accentColor: PURPLE } as React.CSSProperties
              }
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10,
                color: MUTED,
                marginTop: 2,
              }}
            >
              <span>00:00</span>
              <span>06:00</span>
              <span>12:00</span>
              <span>18:00</span>
              <span>24:00</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════ */
export default function SpaceLayout() {
  const [journey, setJourney] = useState<Journey>(DEFAULT_JOURNEY);
  const [stepIdx, setStepIdx] = useState(DEFAULT_JOURNEY.steps.length - 1);
  const [view, setView] = useState<ViewDir>("iso-tse");
  const [pan, setPan] = useState<P2>([0, 0]);
  const [zoom, setZoom] = useState(1.4);
  const [isDragging, setIsDragging] = useState(false);
  const [vpSize, setVpSize] = useState({ w: 800, h: 600 });
  const [sunSettings, setSunSettings] =
    useState<SunSettings>(DEFAULT_SUN_SETTINGS);
  const [selectedGridPoint, setSelectedGridPoint] = useState<
    [number, number] | null
  >(null);
  const sunDir = getSunDir(sunSettings);

  const vpRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // Measure viewport
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setVpSize({ w: width, h: height });
    });
    ro.observe(el);
    setVpSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const scene = buildScene(journey, stepIdx);
  const proj = getProj(view);

  // Find the most recent elevation-grid-instruction across all steps up to
  // the current one, so the grid persists into later steps.
  let elevInstr: ElevationGridInstruction | undefined;
  let elevInstrStepIdx = -1;
  for (let si = stepIdx; si >= 0; si--) {
    const found = journey.steps[si].instructions.find(
      (ins): ins is ElevationGridInstruction =>
        ins.type === "elevation-grid-instruction",
    );
    if (found) {
      elevInstr = found;
      elevInstrStepIdx = si;
      break;
    }
  }
  // Are we on the step that owns the instruction (editing mode)?
  const isEditingGrid = elevInstrStepIdx === stepIdx;
  // Grid is always rendered when present; hidden + not editing → faint only
  const showGrid = !!elevInstr;
  const gridFaint = !!elevInstr?.hidden && !isEditingGrid;
  const elevPoints: P3[] = elevInstr?.grid ?? [];
  const gridSize = journey.options.gridSize ?? PX_PER_FOOT;

  // Clear selected grid point whenever we leave the step that owns the instruction
  useEffect(() => {
    if (!isEditingGrid) setSelectedGridPoint(null);
  }, [isEditingGrid]);

  const doPan = useCallback(
    (dx: number, dy: number) => {
      setPan(([px, py]) => {
        const bounds = computeBounds(scene, proj);
        return clampPan(px + dx, py + dy, zoom, vpSize.w, vpSize.h, bounds);
      });
    },
    [scene, proj, zoom, vpSize],
  );

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      dragRef.current = { x: e.clientX, y: e.clientY };
      doPan(dx, dy);
    },
    [doPan],
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      // Zoom toward cursor
      const rect = (e.currentTarget as Element).getBoundingClientRect();
      const mx = e.clientX - rect.left - vpSize.w / 2;
      const my = e.clientY - rect.top - vpSize.h / 2;
      setZoom((prev) => Math.max(0.1, Math.min(20, prev * factor)));
      setPan(([px, py]) => {
        const newPx = px + (mx - px) * (1 - 1 / factor);
        const newPy = py + (my - py) * (1 - 1 / factor);
        const bounds = computeBounds(scene, proj);
        return clampPan(
          newPx,
          newPy,
          zoom * factor,
          vpSize.w,
          vpSize.h,
          bounds,
        );
      });
    },
    [scene, proj, zoom, vpSize],
  );

  const handleViewChange = (v: ViewDir) => {
    setView(v);
    setPan([0, 0]); // reset pan on view change
  };

  const handleGridPointClick = useCallback(
    (x: number, z: number) => {
      setSelectedGridPoint((prev) =>
        prev &&
        Math.round(prev[0] / gridSize) === Math.round(x / gridSize) &&
        Math.round(prev[1] / gridSize) === Math.round(z / gridSize)
          ? null
          : [x, z],
      );
    },
    [gridSize],
  );

  const handleGridPointElevChange = useCallback(
    (x: number, z: number, yAbs: number) => {
      setJourney((j) => {
        const steps = j.steps.map((step, si) => {
          if (si !== stepIdx) return step;
          const instructions = step.instructions.map((instr) => {
            if (instr.type !== "elevation-grid-instruction") return instr;
            const filtered = instr.grid.filter(
              (p) =>
                Math.round(p[0] / gridSize) !== Math.round(x / gridSize) ||
                Math.round(p[2] / gridSize) !== Math.round(z / gridSize),
            );
            const newGrid =
              Math.abs(yAbs - j.options.elevation_y) < 0.5
                ? filtered
                : [...filtered, [x, yAbs, z] as P3];
            return { ...instr, grid: newGrid };
          });
          return { ...step, instructions };
        });
        return { ...j, steps };
      });
    },
    [stepIdx, gridSize],
  );

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <JourneyColumn
        journey={journey}
        stepIdx={stepIdx}
        onStep={setStepIdx}
        onChange={setJourney}
        selectedGridPoint={selectedGridPoint}
        onGridPointElevChange={handleGridPointElevChange}
      />

      <div
        ref={vpRef}
        style={{ flex: 1, position: "relative", overflow: "hidden" }}
      >
        <SceneRenderer
          scene={scene}
          view={view}
          vpW={vpSize.w}
          vpH={vpSize.h}
          panX={pan[0]}
          panY={pan[1]}
          zoom={zoom}
          isDragging={isDragging}
          sunDir={sunDir}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
          showGrid={showGrid}
          gridFaint={gridFaint}
          isEditingGrid={isEditingGrid}
          gridSize={gridSize}
          elevPoints={elevPoints}
          selectedGridPoint={selectedGridPoint}
          onGridPointClick={handleGridPointClick}
        />
        <ViewCube view={view} onView={handleViewChange} />
        <SunPanel settings={sunSettings} onChange={setSunSettings} />
      </div>
    </div>
  );
}
