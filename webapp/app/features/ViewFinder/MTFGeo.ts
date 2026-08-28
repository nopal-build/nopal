import type { PearGeo } from "./PearGeo";

export type MTFParams = {
  /** Full stud height in inches (default 96 = 8 ft) */
  studLength: number;
  /** Top tenon vertical length in inches (default 26.5) */
  topTenonLength: number;
  /** How far the top tenon overlaps down into the stud from the top, in inches (default 8) */
  topTenonOverlap: number;
  /** Mid tenon horizontal length in inches (default 14.5) */
  midTenonLength: number;
  /** Distance from ground to the bottom face of the mid tenon, in inches (default 48) */
  midTenonBottomFromGround: number;
  /** Sill tenon horizontal length in inches (default 14.5) */
  sillTenonLength: number;
  /** Lower bridging vertical length in inches (default 12) */
  lowerBridgingLength: number;
  /** Upper bridging vertical length in inches (default 12) */
  upperBridgingLength: number;
};

export const DEFAULT_MTF_PARAMS: MTFParams = {
  studLength: 96,
  topTenonLength: 26.5,
  topTenonOverlap: 8,
  midTenonLength: 14.5,
  midTenonBottomFromGround: 48,
  sillTenonLength: 14.5,
  lowerBridgingLength: 12,
  upperBridgingLength: 12,
};

/**
 * Builds WebGPU-ready geometry for one MTF (Modified Timber Frame) post.
 *
 * Coordinate system (all values in feet, right-handed, Y-up):
 *   X → horizontal face width (studs + tenon overhangs centred at 0)
 *   Y → up (0 = floor, studLength/12 = top of stud)
 *   Z → post depth  (0 = front stud face, 6/12 = back stud face)
 *
 * Assembly layers in Z:
 *   Front stud  Z = [ 0,       1.5/12 ]
 *   Gap (tenons/bridging) Z = [ 1.5/12,  4.5/12 ]
 *   Back stud   Z = [ 4.5/12,  6/12   ]
 *
 * Horizontal tenons (sill, mid) run in X and their 5.5" cross-section
 * dimension is their height (Y). Vertical pieces (bridging, top tenon) run
 * in Y and are 5.5" wide in X.
 */
export function buildMTFPostGeometry(
  params: MTFParams = DEFAULT_MTF_PARAMS,
): PearGeo {
  const IN = 1 / 12; // 1 inch → feet

  // ── Lumber dimensions ───────────────────────────────────────────────────
  const STUD_FACE = 5.5 * IN; // 2×6 face width  (X for studs / vertical pieces)
  const STUD_THICK = 1.5 * IN; // 2×6 thickness   (Z for studs)
  const BLOCK_THICK = 3.0 * IN; // 2× 2×6 thickness (Z for tenons/bridging = gap)
  const BLOCK_FACE = 5.5 * IN; // 2× 2×6 face     (Y height of horizontal tenon block)

  // ── Z layout ─────────────────────────────────────────────────────────────
  const Z0 = 0;
  const Z1 = STUD_THICK; // 1.5/12 – gap start
  const Z2 = STUD_THICK + BLOCK_THICK; // 4.5/12 – gap end
  // Z3 unused but kept for reference: Z2 + STUD_THICK = 6/12 – post back face
  // Mid-gap: each laminated piece is actually TWO 2×6 boards face-to-face
  const Z_MID = Z1 + STUD_THICK; // 3/12   – seam between the two boards

  // ── X layout (centred at 0) ───────────────────────────────────────────────
  const HALF_STUD = STUD_FACE / 2; // ±2.75/12 ft

  // ── Component lengths (params are in inches, convert to feet) ────────────
  const SILL_LEN = params.sillTenonLength * IN;
  const MID_LEN = params.midTenonLength * IN;
  const TOP_LEN = params.topTenonLength * IN;
  const LB_LEN = params.lowerBridgingLength * IN;
  const UB_LEN = params.upperBridgingLength * IN;

  // ── Y positions ───────────────────────────────────────────────────────────
  const STUD_H = params.studLength * IN; // full stud height in feet

  // Sill tenon: at the very bottom, BLOCK_FACE tall
  const SILL_Y0 = 0;
  const SILL_Y1 = BLOCK_FACE; // 5.5/12 ft

  // Mid tenon: bottom at midTenonBottomFromGround, BLOCK_FACE tall
  const MID_Y0 = params.midTenonBottomFromGround * IN;
  const MID_Y1 = MID_Y0 + BLOCK_FACE;
  const MID_CY = (MID_Y0 + MID_Y1) / 2;

  // Top tenon: bottom inserts topTenonOverlap" below stud top, rises TOP_LEN total
  const TOP_Y0 = STUD_H - params.topTenonOverlap * IN;
  const TOP_Y1 = TOP_Y0 + TOP_LEN;

  // Lower bridging: centred between sill centre and mid centre
  const SILL_CY = (SILL_Y0 + SILL_Y1) / 2; // 2.75/12 ft
  const LB_CY = (SILL_CY + MID_CY) / 2;
  const LB_Y0 = LB_CY - LB_LEN / 2;
  const LB_Y1 = LB_CY + LB_LEN / 2;

  // Upper bridging: centred between mid centre and top tenon base
  const UB_CY = (MID_CY + TOP_Y0) / 2;
  const UB_Y0 = UB_CY - UB_LEN / 2;
  const UB_Y1 = UB_CY + UB_LEN / 2;

  // ── Box list [x0, x1, y0, y1, z0, z1] ───────────────────────────────────
  type Box = readonly [number, number, number, number, number, number];

  const boxes: Box[] = [
    // Stud A (front face of post) — single 2×6
    [-HALF_STUD, HALF_STUD, 0, STUD_H, Z0, Z1],
    // Stud B (back face of post) — single 2×6
    [-HALF_STUD, HALF_STUD, 0, STUD_H, Z2, Z2 + STUD_THICK],

    // Sill tenon — horizontal, runs ±X, 5.5" tall at base
    // Two individual 2×6 boards laminated face-to-face in Z
    [-SILL_LEN / 2, SILL_LEN / 2, SILL_Y0, SILL_Y1, Z1, Z_MID], // front board
    [-SILL_LEN / 2, SILL_LEN / 2, SILL_Y0, SILL_Y1, Z_MID, Z2], // back board

    // Mid tenon — horizontal, runs ±X, centred at stud mid-point
    [-MID_LEN / 2, MID_LEN / 2, MID_Y0, MID_Y1, Z1, Z_MID], // front board
    [-MID_LEN / 2, MID_LEN / 2, MID_Y0, MID_Y1, Z_MID, Z2], // back board

    // Top tenon — vertical, runs +Y, sticks up above studs
    [-HALF_STUD, HALF_STUD, TOP_Y0, TOP_Y1, Z1, Z_MID], // front board
    [-HALF_STUD, HALF_STUD, TOP_Y0, TOP_Y1, Z_MID, Z2], // back board

    // Lower bridging — vertical, between sill and mid
    [-HALF_STUD, HALF_STUD, LB_Y0, LB_Y1, Z1, Z_MID], // front board
    [-HALF_STUD, HALF_STUD, LB_Y0, LB_Y1, Z_MID, Z2], // back board

    // Upper bridging — vertical, between mid and top tenon
    [-HALF_STUD, HALF_STUD, UB_Y0, UB_Y1, Z1, Z_MID], // front board
    [-HALF_STUD, HALF_STUD, UB_Y0, UB_Y1, Z_MID, Z2], // back board
  ];

  // ── Geometry buffers ──────────────────────────────────────────────────────
  // 6 faces × 4 verts = 24 verts per box
  // 6 faces × 2 tris  = 12 tris per box
  const nBoxes = boxes.length;
  const positions = new Float32Array(nBoxes * 24 * 3);
  const normals = new Float32Array(nBoxes * 24 * 3);
  const indices = new Uint32Array(nBoxes * 12 * 3);

  let vi = 0; // vertex cursor
  let ii = 0; // index  cursor

  /** Push one vertex, return its index. */
  function pv(
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
  ): number {
    const base = vi * 3;
    positions[base] = px;
    positions[base + 1] = py;
    positions[base + 2] = pz;
    normals[base] = nx;
    normals[base + 1] = ny;
    normals[base + 2] = nz;
    return vi++;
  }

  /** Push a CCW quad as two triangles (a,b,c) + (a,c,d).
   *  Winding matches framesToGeometry (verified against WebGPU frontFace:"ccw"). */
  function quad(a: number, b: number, c: number, d: number): void {
    indices[ii++] = a;
    indices[ii++] = b;
    indices[ii++] = c;
    indices[ii++] = a;
    indices[ii++] = c;
    indices[ii++] = d;
  }

  for (const [x0, x1, y0, y1, z0, z1] of boxes) {
    // ── -X face ────────────────────────────────────────────────────────────
    {
      const [nx, ny, nz] = [-1, 0, 0] as const;
      quad(
        pv(x0, y0, z0, nx, ny, nz),
        pv(x0, y1, z0, nx, ny, nz),
        pv(x0, y1, z1, nx, ny, nz),
        pv(x0, y0, z1, nx, ny, nz),
      );
    }
    // ── +X face ────────────────────────────────────────────────────────────
    {
      const [nx, ny, nz] = [1, 0, 0] as const;
      quad(
        pv(x1, y0, z0, nx, ny, nz),
        pv(x1, y0, z1, nx, ny, nz),
        pv(x1, y1, z1, nx, ny, nz),
        pv(x1, y1, z0, nx, ny, nz),
      );
    }
    // ── -Y face (bottom) ───────────────────────────────────────────────────
    {
      const [nx, ny, nz] = [0, -1, 0] as const;
      quad(
        pv(x0, y0, z0, nx, ny, nz),
        pv(x0, y0, z1, nx, ny, nz),
        pv(x1, y0, z1, nx, ny, nz),
        pv(x1, y0, z0, nx, ny, nz),
      );
    }
    // ── +Y face (top) ──────────────────────────────────────────────────────
    {
      const [nx, ny, nz] = [0, 1, 0] as const;
      quad(
        pv(x0, y1, z1, nx, ny, nz),
        pv(x0, y1, z0, nx, ny, nz),
        pv(x1, y1, z0, nx, ny, nz),
        pv(x1, y1, z1, nx, ny, nz),
      );
    }
    // ── -Z face (front stud face / near side) ──────────────────────────────
    {
      const [nx, ny, nz] = [0, 0, -1] as const;
      quad(
        pv(x0, y1, z0, nx, ny, nz),
        pv(x0, y0, z0, nx, ny, nz),
        pv(x1, y0, z0, nx, ny, nz),
        pv(x1, y1, z0, nx, ny, nz),
      );
    }
    // ── +Z face (back stud face / far side) ────────────────────────────────
    {
      const [nx, ny, nz] = [0, 0, 1] as const;
      quad(
        pv(x0, y0, z1, nx, ny, nz),
        pv(x0, y1, z1, nx, ny, nz),
        pv(x1, y1, z1, nx, ny, nz),
        pv(x1, y0, z1, nx, ny, nz),
      );
    }
  }

  return {
    positions,
    normals,
    indices,
    vertexCount: vi,
    triangleCount: ii / 3,
  };
}
