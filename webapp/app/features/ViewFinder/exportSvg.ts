import {
  mat4Perspective,
  mat4LookAt,
  mat4Multiply,
  projectPoint,
} from "./mat4";
import type { Mat4 } from "./mat4";

export interface CameraState {
  theta: number;
  phi: number;
  distance: number;
  target: [number, number, number];
}

export function buildSvg(
  edges: Float32Array,
  svgW: number,
  svgH: number,
  camera: CameraState,
): string {
  const aspect = svgW / svgH;

  const proj = mat4Perspective(Math.PI / 4, aspect, 0.01, 500);
  const eyeX =
    camera.target[0] +
    camera.distance * Math.cos(camera.phi) * Math.sin(camera.theta);
  const eyeY = camera.target[1] + camera.distance * Math.sin(camera.phi);
  const eyeZ =
    camera.target[2] +
    camera.distance * Math.cos(camera.phi) * Math.cos(camera.theta);
  const view = mat4LookAt([eyeX, eyeY, eyeZ], camera.target, [0, 1, 0]);
  const mvp: Mat4 = mat4Multiply(proj, view);

  const numEdges = edges.length / 9;
  const frontLines: string[] = [];
  const backLines: string[] = [];

  for (let i = 0; i < numEdges; i++) {
    const off = i * 9;
    const ax = edges[off],
      ay = edges[off + 1],
      az = edges[off + 2];
    const bx = edges[off + 3],
      by = edges[off + 4],
      bz = edges[off + 5];
    const nx = edges[off + 6],
      ny = edges[off + 7],
      nz = edges[off + 8];

    const pa = projectPoint(mvp, ax, ay, az);
    const pb = projectPoint(mvp, bx, by, bz);

    // Skip edges behind camera
    if (pa.clipW <= 0 || pb.clipW <= 0) continue;

    const sax = ((pa.clipX / pa.clipW) * 0.5 + 0.5) * svgW;
    const say = ((-pa.clipY / pa.clipW) * 0.5 + 0.5) * svgH;
    const sbx = ((pb.clipX / pb.clipW) * 0.5 + 0.5) * svgW;
    const sby = ((-pb.clipY / pb.clipW) * 0.5 + 0.5) * svgH;

    // Facing: dot(edgeNormal, normalize(eye - midpoint)) — same logic as shader
    const midX = (ax + bx) / 2,
      midY = (ay + by) / 2,
      midZ = (az + bz) / 2;
    const vx = eyeX - midX,
      vy = eyeY - midY,
      vz = eyeZ - midZ;
    const vLen = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
    const facing = (nx * vx + ny * vy + nz * vz) / vLen;

    // Edge normals are outward-pointing, so facing > 0 = near side, facing < 0 = far side.
    // Skip clearly far-side edges (matches the discard threshold in fs_wire).
    if (facing < -0.5) continue;

    // smoothstep(-0.2, 0.4, facing) — matches updated shader
    const t = Math.max(0, Math.min(1, (facing + 0.2) / 0.6));
    const strokeW = (0.8 + t * 1.2).toFixed(2);

    const line = `<line x1="${sax.toFixed(1)}" y1="${say.toFixed(
      1,
    )}" x2="${sbx.toFixed(1)}" y2="${sby.toFixed(
      1,
    )}" stroke-width="${strokeW}"/>`;

    // facing > 0: near-side edge → draw solid on top; ≤ 0: far/silhouette → dashed behind
    if (facing > 0) {
      frontLines.push(line);
    } else {
      backLines.push(line);
    }
  }

  // ── Scale bar ─────────────────────────────────────────────────────────────
  // Project two world-space points separated by `worldLen` feet at the
  // camera-target depth so we know how many SVG pixels equal that distance.
  const scaleTarget = camera.target;

  function scaleBarPixels(worldLen: number): number {
    const p1 = projectPoint(
      mvp,
      scaleTarget[0] - worldLen / 2,
      scaleTarget[1],
      scaleTarget[2],
    );
    const p2 = projectPoint(
      mvp,
      scaleTarget[0] + worldLen / 2,
      scaleTarget[1],
      scaleTarget[2],
    );
    if (p1.clipW <= 0 || p2.clipW <= 0) return 0;
    const sx1 = (p1.clipX / p1.clipW) * 0.5 * svgW + svgW * 0.5;
    const sx2 = (p2.clipX / p2.clipW) * 0.5 * svgW + svgW * 0.5;
    return Math.abs(sx2 - sx1);
  }

  // Pick the "nicest" world length that projects to roughly 50–180 px
  const scaleCandidates = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100];
  let scaleWorldLen = scaleCandidates[0];
  let scalePx = scaleBarPixels(scaleWorldLen);
  for (const c of scaleCandidates) {
    const px = scaleBarPixels(c);
    if (px >= 50 && px <= 180) {
      scaleWorldLen = c;
      scalePx = px;
      break;
    }
    // Keep the candidate closest to 100 px as a fallback
    if (Math.abs(px - 100) < Math.abs(scalePx - 100)) {
      scaleWorldLen = c;
      scalePx = px;
    }
  }

  // Format label: sub-foot values → inches, whole feet → feet notation
  let scaleLabel: string;
  if (scaleWorldLen < 1) {
    scaleLabel = `${Math.round(scaleWorldLen * 12)}"`;
  } else {
    scaleLabel = `${scaleWorldLen}'`;
  }

  // Build scale-bar SVG elements (bottom-right corner)
  const sbMargin = 24;
  const sbBarY = svgH - sbMargin;
  const sbBarX2 = svgW - sbMargin;
  const sbBarX1 = sbBarX2 - scalePx;
  const sbTickH = 6;
  const sbLabelY = sbBarY + sbTickH + 14;
  const sbMidX = (sbBarX1 + sbBarX2) / 2;

  const scaleBarSvg =
    scalePx > 0
      ? [
          `  <g stroke="#444444" stroke-width="1.5" fill="none" stroke-linecap="round">`,
          `    <line x1="${sbBarX1.toFixed(1)}" y1="${sbBarY.toFixed(
            1,
          )}" x2="${sbBarX2.toFixed(1)}" y2="${sbBarY.toFixed(1)}"/>`,
          `    <line x1="${sbBarX1.toFixed(1)}" y1="${(
            sbBarY - sbTickH
          ).toFixed(1)}" x2="${sbBarX1.toFixed(1)}" y2="${(
            sbBarY + sbTickH
          ).toFixed(1)}"/>`,
          `    <line x1="${sbBarX2.toFixed(1)}" y1="${(
            sbBarY - sbTickH
          ).toFixed(1)}" x2="${sbBarX2.toFixed(1)}" y2="${(
            sbBarY + sbTickH
          ).toFixed(1)}"/>`,
          `  </g>`,
          `  <text x="${sbMidX.toFixed(1)}" y="${sbLabelY.toFixed(
            1,
          )}" text-anchor="middle" font-family="monospace" font-size="11" fill="#444444">${scaleLabel}</text>`,
        ]
      : [];

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">`,
    `  <rect width="${svgW}" height="${svgH}" fill="white"/>`,
    `  <g stroke="#222222" fill="none" opacity="0.2" stroke-dasharray="3 3">`,
    ...backLines.map((l) => `    ${l}`),
    `  </g>`,
    `  <g stroke="#222222" fill="none">`,
    ...frontLines.map((l) => `    ${l}`),
    `  </g>`,
    ...scaleBarSvg,
    `</svg>`,
  ].join("\n");
}

export function triggerSvgDownload(svg: string): void {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "frame-preview.svg";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function copySvgToClipboard(svg: string): Promise<void> {
  return navigator.clipboard.writeText(svg);
}
