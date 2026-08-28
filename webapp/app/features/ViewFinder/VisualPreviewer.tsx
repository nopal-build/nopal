import { useRef, useEffect, useState, useCallback } from "react";
import type { PearGeo } from "./PearGeo";
import { mat4Perspective, mat4LookAt, mat4Multiply } from "./mat4";
import {
  buildSvg as buildSvgFn,
  triggerSvgDownload,
  copySvgToClipboard,
} from "./exportSvg";
import {
  geometryToOBJ,
  triggerObjDownload,
  copyObjToClipboard,
} from "./exportObj";

// Cast typed arrays to satisfy @webgpu/types expecting ArrayBuffer (not ArrayBufferLike)
function gpuBuf(data: Float32Array | Uint32Array): BufferSource {
  return data as unknown as BufferSource;
}

// ── WGSL Shaders ────────────────────────────────────────────────────────────

const SHADER_SOURCE = /* wgsl */ `
struct Uniforms {
  mvp      : mat4x4<f32>,
  eyePos   : vec4<f32>,
  viewport : vec4<f32>,
};
@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct VSIn {
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
};
struct VSOut {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) normal : vec3<f32>,
};

@vertex fn vs_main(input : VSIn) -> VSOut {
  var out : VSOut;
  out.clipPos = uniforms.mvp * vec4<f32>(input.position, 1.0);
  out.normal  = input.normal;
  return out;
}

@fragment fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  let lightDir = normalize(vec3<f32>(0.4, 0.9, 0.7));
  let n        = normalize(input.normal);
  let ndotl    = max(dot(n, lightDir), 0.0);
  let ambient  = 0.5;
  let diffuse  = ndotl * 0.32;
  let base     = vec3<f32>(0.36, 0.62, 0.42);
  return vec4<f32>(base * (ambient + diffuse), 1.0);
}

// ── Wireframe (drawn as instanced screen-space quads) ──

struct WireVSOut {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) facing : f32,
};

@vertex fn vs_wire(
  @builtin(vertex_index) vid : u32,
  @location(0) posA      : vec3<f32>,
  @location(1) posB      : vec3<f32>,
  @location(2) edgeNormal : vec3<f32>,
) -> WireVSOut {
  // Determine quad corner from vertex index (6 verts = 2 triangles per instance)
  let ci = vid % 6u;
  var side : f32 = -1.0;
  var endT : f32 = 0.0;
  if (ci == 1u || ci == 3u || ci == 4u) { side = 1.0; }
  if (ci == 2u || ci == 4u || ci == 5u) { endT = 1.0; }

  // Transform both endpoints to clip space
  let clipA = uniforms.mvp * vec4<f32>(posA, 1.0);
  let clipB = uniforms.mvp * vec4<f32>(posB, 1.0);

  // Screen-space positions (in pixels)
  let screenA = (clipA.xy / clipA.w) * uniforms.viewport.xy * 0.5;
  let screenB = (clipB.xy / clipB.w) * uniforms.viewport.xy * 0.5;

  // Direction and perpendicular in screen space
  let lineDir = screenB - screenA;
  let lineLen = length(lineDir);
  var perp = vec2<f32>(0.0, 1.0);
  if (lineLen > 0.001) {
    let dir = lineDir / lineLen;
    perp = vec2<f32>(-dir.y, dir.x);
  }

  // Compute facing factor from averaged edge normal
  let midPos = (posA + posB) * 0.5;
  let viewDir = normalize(uniforms.eyePos.xyz - midPos);
  let n = normalize(edgeNormal);
  let facing = dot(n, viewDir);

  // Width in pixels: thicker for front-facing (facing > 0), thinner for back-facing.
  // Edge normals are outward, so facing > 0 means the surface faces the camera.
  // smoothstep is centred around 0 so silhouette edges get intermediate width.
  let t = smoothstep(-0.2, 0.4, facing);
  let widthPx = mix(1.0, 2.0, t);

  // Pick the interpolated clip position for this vertex
  let clipP = mix(clipA, clipB, endT);

  // Offset in screen-space pixels, then convert back to clip space
  let offsetPx = perp * side * widthPx * 0.5;
  let ndcOffset = offsetPx * 2.0 / uniforms.viewport.xy;

  var out : WireVSOut;
  out.clipPos = clipP;
  out.clipPos.x = out.clipPos.x + ndcOffset.x * clipP.w;
  out.clipPos.y = out.clipPos.y + ndcOffset.y * clipP.w;
  // No manual depth bias — solid pipeline uses depthBias so faces sit just
  // behind the actual surface depth, letting wire edges pass "less-equal".
  out.facing = facing;
  return out;
}

@fragment fn fs_wire(input : WireVSOut) -> @location(0) vec4<f32> {
  // facing < 0 means the outward edge normal points away from the camera →
  // this edge is on the far side of the object.  Discard it so far-side wire
  // edges don't bleed through the transparent background around the object,
  // which is what made the rendering feel depth-reversed.
  if (input.facing < -0.5) { discard; }
  let color = vec3<f32>(0.63, 0.89, 0.68); // light green
  return vec4<f32>(color, 1.0);
}
`;

// ── Grid Shader ─────────────────────────────────────────────────────────────

const GRID_SHADER_SOURCE = /* wgsl */ `
struct Uniforms {
  mvp      : mat4x4<f32>,
  eyePos   : vec4<f32>,
  viewport : vec4<f32>,
};
@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct VSIn {
  @location(0) position : vec3<f32>,
};
struct VSOut {
  @builtin(position) clipPos : vec4<f32>,
};

@vertex fn vs_grid(input : VSIn) -> VSOut {
  var out : VSOut;
  out.clipPos = uniforms.mvp * vec4<f32>(input.position, 1.0);
  return out;
}

@fragment fn fs_grid() -> @location(0) vec4<f32> {
  return vec4<f32>(0.78, 0.78, 0.78, 1.0);
}
`;

// ── WebGPU GPU state held in a ref ──────────────────────────────────────────

interface GpuState {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  pipeline: GPURenderPipeline;
  wirePipeline: GPURenderPipeline;
  gridPipeline: GPURenderPipeline;
  uniformBuffer: GPUBuffer;
  uniformBindGroup: GPUBindGroup;
  depthTexture: GPUTexture | null;
  depthTextureView: GPUTextureView | null;
  msaaTexture: GPUTexture | null;
  msaaTextureView: GPUTextureView | null;
  positionBuffer: GPUBuffer | null;
  normalBuffer: GPUBuffer | null;
  indexBuffer: GPUBuffer | null;
  wireBuffer: GPUBuffer | null;
  wireVertCount: number;
  gridBuffer: GPUBuffer | null;
  gridVertCount: number;
  indexCount: number;
  canvasWidth: number;
  canvasHeight: number;
}

// ── Helper: generate wireframe line-list vertices from triangles ────────────

function buildWireframeBuffer(
  positions: Float32Array,
  indices: Uint32Array,
): Float32Array {
  // Build a map from each edge to the triangle indices that share it
  const edgeTriMap = new Map<string, number[]>();
  for (let i = 0; i < indices.length; i += 3) {
    const triIdx = i / 3;
    const tri = [indices[i], indices[i + 1], indices[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let list = edgeTriMap.get(key);
      if (!list) {
        list = [];
        edgeTriMap.set(key, list);
      }
      list.push(triIdx);
    }
  }

  // Helper: compute triangle normal (unnormalized)
  function triNormal(triIdx: number): [number, number, number] {
    const i0 = indices[triIdx * 3];
    const i1 = indices[triIdx * 3 + 1];
    const i2 = indices[triIdx * 3 + 2];
    const ax = positions[i1 * 3] - positions[i0 * 3];
    const ay = positions[i1 * 3 + 1] - positions[i0 * 3 + 1];
    const az = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
    const bx = positions[i2 * 3] - positions[i0 * 3];
    const by = positions[i2 * 3 + 1] - positions[i0 * 3 + 1];
    const bz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
    return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
  }

  // Collect edges (with averaged normals), skipping internal diagonals of coplanar quad faces
  const edgeList: {
    a: number;
    b: number;
    nx: number;
    ny: number;
    nz: number;
  }[] = [];
  for (const [key, tris] of edgeTriMap) {
    // Compute average normal from adjacent triangles
    let nx = 0,
      ny = 0,
      nz = 0;
    for (const t of tris) {
      const n = triNormal(t);
      nx += n[0];
      ny += n[1];
      nz += n[2];
    }
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }

    if (tris.length === 2) {
      // Shared edge — check if the two triangles are coplanar
      const n1 = triNormal(tris[0]);
      const n2 = triNormal(tris[1]);
      const dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2];
      const len1 = Math.sqrt(n1[0] * n1[0] + n1[1] * n1[1] + n1[2] * n1[2]);
      const len2 = Math.sqrt(n2[0] * n2[0] + n2[1] * n2[1] + n2[2] * n2[2]);
      if (len1 > 0 && len2 > 0 && dot / (len1 * len2) > 0.999) {
        continue; // coplanar shared edge = quad diagonal, skip
      }
    }
    const parts = key.split("_");
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    edgeList.push({ a, b, nx, ny, nz });
  }

  // Per-edge instance data: posA (vec3) + posB (vec3) + normal (vec3) = 9 floats
  const verts = new Float32Array(edgeList.length * 9);
  for (let i = 0; i < edgeList.length; i++) {
    const { a, b, nx, ny, nz } = edgeList[i];
    const off = i * 9;
    // Endpoint A
    verts[off] = positions[a * 3];
    verts[off + 1] = positions[a * 3 + 1];
    verts[off + 2] = positions[a * 3 + 2];
    // Endpoint B
    verts[off + 3] = positions[b * 3];
    verts[off + 4] = positions[b * 3 + 1];
    verts[off + 5] = positions[b * 3 + 2];
    // Edge normal — negate so the normal points outward (the cross product of
    // the geometry winding is inward due to WebGPU's Y-down front-face convention).
    verts[off + 6] = -nx;
    verts[off + 7] = -ny;
    verts[off + 8] = -nz;
  }
  return verts;
}

// ── Helper: build grid lines on the ground plane (Y=0) ─────────────────────

function buildGridBuffer(
  centerX: number,
  centerZ: number,
  extent: number,
  step: number,
): Float32Array {
  const lines: number[] = [];
  const halfExt = Math.ceil(extent / step) * step;
  const startX = centerX - halfExt;
  const endX = centerX + halfExt;
  const startZ = centerZ - halfExt;
  const endZ = centerZ + halfExt;

  // Lines parallel to Z
  for (let x = startX; x <= endX + 0.001; x += step) {
    lines.push(x, 0, startZ, x, 0, endZ);
  }
  // Lines parallel to X
  for (let z = startZ; z <= endZ + 0.001; z += step) {
    lines.push(startX, 0, z, endX, 0, z);
  }
  return new Float32Array(lines);
}

// ── React component ─────────────────────────────────────────────────────────

interface VisualPreviewerProps {
  geometry: PearGeo;
}

export function VisualPreviewer({ geometry }: VisualPreviewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<GpuState | null>(null);
  const rafRef = useRef<number>(0);
  // Counter that increments each time WebGPU init completes.
  // 0 = pending, -1 = not supported, >0 = ready (sequence number).
  // Using a counter instead of a boolean guarantees dependent effects
  // always re-fire — even after React Strict Mode double-mount.
  const [initSeq, setInitSeq] = useState(0);

  // Camera state (orbit camera)
  const cameraRef = useRef({
    theta: Math.PI * 0.25, // azimuth
    phi: Math.PI * 0.3, // elevation
    distance: 8,
    target: [0, 0, 0] as [number, number, number],
    needsRender: true,
  });

  // ── Compute bounding box center and good camera defaults ──
  const boundsRef = useRef({
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    maxExtent: 4,
  });

  // ── Raw wireframe edge data for SVG export (CPU-side copy) ──
  const wireEdgesRef = useRef<Float32Array | null>(null);

  // ── Initialize WebGPU (runs once) ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!navigator.gpu) {
      console.log("GPU INIT: No Navigator GPU");
      setInitSeq(-1);
      return;
    }

    async function init() {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        console.log("GPU INIT: No Adapter");
        setInitSeq(-1);
        return;
      }
      const device = await adapter.requestDevice();

      const context = canvas.getContext("webgpu");
      if (!context) {
        console.log("GPU INIT: No Context", context);
        setInitSeq(-1);
        return;
      }

      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: "premultiplied" });

      // ── Shader modules ──
      const shaderModule = device.createShaderModule({ code: SHADER_SOURCE });
      const gridShaderModule = device.createShaderModule({
        code: GRID_SHADER_SOURCE,
      });

      // ── Uniform buffer & bind group layout ──
      const uniformBuffer = device.createBuffer({
        size: 96, // mat4x4<f32> (64) + vec4<f32> eyePos (16) + vec4<f32> viewport (16)
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: "uniform" },
          },
        ],
      });

      const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      });

      const uniformBindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      });

      // ── Solid pipeline ──
      const pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
          module: shaderModule,
          entryPoint: "vs_main",
          buffers: [
            {
              arrayStride: 12,
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x3" },
              ],
            },
            {
              arrayStride: 12,
              attributes: [
                { shaderLocation: 1, offset: 0, format: "float32x3" },
              ],
            },
          ],
        },
        fragment: {
          module: shaderModule,
          entryPoint: "fs_main",
          targets: [{ format }],
        },
        primitive: {
          topology: "triangle-list",
          cullMode: "front",
          frontFace: "ccw",
        },
        depthStencil: {
          format: "depth24plus",
          depthWriteEnabled: true,
          depthCompare: "less",
          // Push solid faces slightly back in the depth buffer so wire edges
          // drawn at the actual surface depth pass the "less-equal" test.
          // depthBias units = multiples of the minimum resolvable depth value
          // (1 / 2^24 ≈ 6e-8 for depth24plus), so this is imperceptibly small.
          depthBias: 2,
          depthBiasSlopeScale: 1.0,
          depthBiasClamp: 0.0,
        },
        multisample: { count: 4 },
      });

      // ── Wire pipeline (instanced triangle quads) ──
      const wirePipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
          module: shaderModule,
          entryPoint: "vs_wire",
          buffers: [
            {
              arrayStride: 36, // posA (12) + posB (12) + normal (12)
              stepMode: "instance",
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x3" }, // posA
                { shaderLocation: 1, offset: 12, format: "float32x3" }, // posB
                { shaderLocation: 2, offset: 24, format: "float32x3" }, // normal
              ],
            },
          ],
        },
        fragment: {
          module: shaderModule,
          entryPoint: "fs_wire",
          targets: [{ format }],
        },
        primitive: { topology: "triangle-list" },
        depthStencil: {
          format: "depth24plus",
          depthWriteEnabled: true,
          // "less-equal" lets edges at the actual surface depth pass now that
          // solid faces are pushed back by depthBias above.
          depthCompare: "less-equal",
        },
        multisample: { count: 4 },
      });

      // ── Grid pipeline (line-list) ──
      const gridPipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
          module: gridShaderModule,
          entryPoint: "vs_grid",
          buffers: [
            {
              arrayStride: 12,
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x3" },
              ],
            },
          ],
        },
        fragment: {
          module: gridShaderModule,
          entryPoint: "fs_grid",
          targets: [{ format }],
        },
        primitive: { topology: "line-list" },
        depthStencil: {
          format: "depth24plus",
          depthWriteEnabled: false,
          depthCompare: "less",
        },
        multisample: { count: 4 },
      });

      gpuRef.current = {
        device,
        context,
        format,
        pipeline,
        wirePipeline,
        gridPipeline,
        uniformBuffer,
        uniformBindGroup,
        depthTexture: null,
        depthTextureView: null,
        msaaTexture: null,
        msaaTextureView: null,
        positionBuffer: null,
        normalBuffer: null,
        indexBuffer: null,
        wireBuffer: null,
        wireVertCount: 0,
        gridBuffer: null,
        gridVertCount: 0,
        indexCount: 0,
        canvasWidth: 0,
        canvasHeight: 0,
      };

      setInitSeq((s) => Math.max(1, Math.abs(s) + 1));
      cameraRef.current.needsRender = true;
    }

    init();

    return () => {
      cancelAnimationFrame(rafRef.current);
      if (gpuRef.current) {
        gpuRef.current.positionBuffer?.destroy();
        gpuRef.current.normalBuffer?.destroy();
        gpuRef.current.indexBuffer?.destroy();
        gpuRef.current.wireBuffer?.destroy();
        gpuRef.current.gridBuffer?.destroy();
        gpuRef.current.depthTexture?.destroy();
        gpuRef.current.device.destroy();
        gpuRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Upload geometry when geometry changes or GPU (re-)initializes ──
  useEffect(() => {
    if (initSeq <= 0) return;
    const gpu = gpuRef.current;
    if (!gpu) return;

    // Destroy old buffers
    gpu.positionBuffer?.destroy();
    gpu.normalBuffer?.destroy();
    gpu.indexBuffer?.destroy();
    gpu.wireBuffer?.destroy();
    gpu.gridBuffer?.destroy();

    if (geometry.vertexCount === 0) {
      gpu.positionBuffer = null;
      gpu.normalBuffer = null;
      gpu.indexBuffer = null;
      gpu.wireBuffer = null;
      gpu.gridBuffer = null;
      gpu.indexCount = 0;
      gpu.wireVertCount = 0;
      gpu.gridVertCount = 0;
      cameraRef.current.needsRender = true;
      return;
    }

    const { device } = gpu;

    // Position buffer
    const posBuf = device.createBuffer({
      size: geometry.positions.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(posBuf, 0, gpuBuf(geometry.positions));

    // Normal buffer
    const normBuf = device.createBuffer({
      size: geometry.normals.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(normBuf, 0, gpuBuf(geometry.normals));

    // Index buffer
    const idxBuf = device.createBuffer({
      size: geometry.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(idxBuf, 0, gpuBuf(geometry.indices));

    // Wireframe buffer
    const wireData = buildWireframeBuffer(geometry.positions, geometry.indices);
    wireEdgesRef.current = wireData; // keep a CPU-side copy for SVG export
    const wireBuf = device.createBuffer({
      size: wireData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(wireBuf, 0, gpuBuf(wireData));

    gpu.positionBuffer = posBuf;
    gpu.normalBuffer = normBuf;
    gpu.indexBuffer = idxBuf;
    gpu.wireBuffer = wireBuf;
    gpu.wireVertCount = wireData.length / 9; // edge count (instances)
    gpu.indexCount = geometry.indices.length;

    // Compute actual bounding box from geometry positions
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < geometry.vertexCount; i++) {
      const px = geometry.positions[i * 3];
      const py = geometry.positions[i * 3 + 1];
      const pz = geometry.positions[i * 3 + 2];
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (pz < minZ) minZ = pz;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
      if (pz > maxZ) maxZ = pz;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.1);

    boundsRef.current = {
      centerX: cx,
      centerY: cy,
      centerZ: cz,
      maxExtent: extent,
    };
    cameraRef.current.target = [cx, cy, cz];
    // Pull camera back enough to fit the whole mesh; factor ~1.8 gives good padding
    cameraRef.current.distance = extent * 1.8;

    // Build grid centered under the mesh
    const gridExtent = Math.max(extent, 4);
    const gridData = buildGridBuffer(cx, cz, gridExtent, 1);
    const gridBuf = device.createBuffer({
      size: gridData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(gridBuf, 0, gpuBuf(gridData));
    gpu.gridBuffer = gridBuf;
    gpu.gridVertCount = gridData.length / 3;

    console.log(
      "[WebGPU] Geometry uploaded. indexCount:",
      gpu.indexCount,
      "wireVerts:",
      gpu.wireVertCount,
      "gridVerts:",
      gpu.gridVertCount,
    );
    cameraRef.current.needsRender = true;
  }, [geometry, initSeq]);

  // ── OBJ export ──
  const [copiedObj, setCopiedObj] = useState(false);

  const exportObj = useCallback(() => {
    triggerObjDownload(geometryToOBJ(geometry));
  }, [geometry]);

  const copyObj = useCallback(() => {
    copyObjToClipboard(geometryToOBJ(geometry)).then(() => {
      setCopiedObj(true);
      setTimeout(() => setCopiedObj(false), 2000);
    });
  }, [geometry]);

  // ── SVG export ──
  const [copiedSvg, setCopiedSvg] = useState(false);

  const buildSvg = useCallback((): string | null => {
    const edges = wireEdgesRef.current;
    const canvas = canvasRef.current;
    if (!edges || !canvas) return null;
    const svgW = Math.max(canvas.clientWidth, 400);
    const svgH = Math.max(canvas.clientHeight, 300);
    return buildSvgFn(edges, svgW, svgH, cameraRef.current);
  }, []);

  const exportSvg = useCallback(() => {
    const svg = buildSvg();
    if (!svg) return;
    triggerSvgDownload(svg);
  }, [buildSvg]);

  const copySvg = useCallback(() => {
    const svg = buildSvg();
    if (!svg) return;
    copySvgToClipboard(svg).then(() => {
      setCopiedSvg(true);
      setTimeout(() => setCopiedSvg(false), 2000);
    });
  }, [buildSvg]);

  // ── Render function ──
  const renderCountRef = useRef(0);
  const render = useCallback(() => {
    const gpu = gpuRef.current;
    const canvas = canvasRef.current;
    if (!gpu || !canvas) {
      console.warn(
        "[WebGPU render] Skipped — gpu:",
        !!gpu,
        "canvas:",
        !!canvas,
      );
      return;
    }

    // Resize the canvas drawing buffer to match its CSS layout size
    const dpr = window.devicePixelRatio || 1;
    const displayW = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const displayH = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== displayW || canvas.height !== displayH) {
      canvas.width = displayW;
      canvas.height = displayH;
    }

    // Get the color texture FIRST — its actual size is the source of truth
    let colorTexture: GPUTexture;
    try {
      colorTexture = gpu.context.getCurrentTexture();
    } catch {
      return; // context lost or canvas not visible
    }
    const tw = colorTexture.width;
    const th = colorTexture.height;
    const colorView = colorTexture.createView();

    // Recreate depth texture whenever the color texture size changes
    if (
      !gpu.depthTexture ||
      gpu.canvasWidth !== tw ||
      gpu.canvasHeight !== th
    ) {
      gpu.depthTexture?.destroy();
      gpu.depthTexture = gpu.device.createTexture({
        size: [tw, th],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        sampleCount: 4,
      });
      gpu.depthTextureView = gpu.depthTexture.createView();

      gpu.msaaTexture?.destroy();
      gpu.msaaTexture = gpu.device.createTexture({
        size: [tw, th],
        format: gpu.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        sampleCount: 4,
      });
      gpu.msaaTextureView = gpu.msaaTexture.createView();

      gpu.canvasWidth = tw;
      gpu.canvasHeight = th;
    }

    if (!gpu.depthTextureView) {
      console.warn("[WebGPU render] No depth texture view");
      return;
    }

    renderCountRef.current++;
    if (renderCountRef.current <= 3) {
      console.log(
        `[WebGPU render #${renderCountRef.current}]`,
        `color: ${tw}x${th}`,
        `indexCount: ${gpu.indexCount}`,
        `wireVerts: ${gpu.wireVertCount}`,
        `gridVerts: ${gpu.gridVertCount}`,
      );
    }

    // Compute MVP
    const cam = cameraRef.current;
    const aspect = tw / th;
    const proj = mat4Perspective(Math.PI / 4, aspect, 0.01, 500);

    const eyeX =
      cam.target[0] + cam.distance * Math.cos(cam.phi) * Math.sin(cam.theta);
    const eyeY = cam.target[1] + cam.distance * Math.sin(cam.phi);
    const eyeZ =
      cam.target[2] + cam.distance * Math.cos(cam.phi) * Math.cos(cam.theta);

    const view = mat4LookAt([eyeX, eyeY, eyeZ], cam.target, [0, 1, 0]);
    const mvp = mat4Multiply(proj, view);

    gpu.device.queue.writeBuffer(gpu.uniformBuffer, 0, gpuBuf(mvp));
    gpu.device.queue.writeBuffer(
      gpu.uniformBuffer,
      64,
      gpuBuf(new Float32Array([eyeX, eyeY, eyeZ, 0])),
    );
    gpu.device.queue.writeBuffer(
      gpu.uniformBuffer,
      80,
      gpuBuf(new Float32Array([tw, th, 0, 0])),
    );

    const encoder = gpu.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: gpu.msaaTextureView!,
          resolveTarget: colorView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: gpu.depthTextureView,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    // Draw grid
    if (gpu.gridBuffer && gpu.gridVertCount > 0) {
      pass.setPipeline(gpu.gridPipeline);
      pass.setBindGroup(0, gpu.uniformBindGroup);
      pass.setVertexBuffer(0, gpu.gridBuffer);
      pass.draw(gpu.gridVertCount);
    }

    // Draw solid geometry
    if (gpu.positionBuffer && gpu.normalBuffer && gpu.indexBuffer) {
      pass.setPipeline(gpu.pipeline);
      pass.setBindGroup(0, gpu.uniformBindGroup);
      pass.setVertexBuffer(0, gpu.positionBuffer);
      pass.setVertexBuffer(1, gpu.normalBuffer);
      pass.setIndexBuffer(gpu.indexBuffer, "uint32");
      pass.drawIndexed(gpu.indexCount);
    }

    // Draw wireframe
    if (gpu.wireBuffer && gpu.wireVertCount > 0) {
      pass.setPipeline(gpu.wirePipeline);
      pass.setBindGroup(0, gpu.uniformBindGroup);
      pass.setVertexBuffer(0, gpu.wireBuffer);
      pass.draw(6, gpu.wireVertCount);
    }

    pass.end();
    gpu.device.queue.submit([encoder.finish()]);
  }, []);

  // ── Render loop (unconditional — checks gpuRef internally) ──
  useEffect(() => {
    function loop() {
      if (gpuRef.current && cameraRef.current.needsRender) {
        cameraRef.current.needsRender = false;
        render();
      }
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(rafRef.current);
  }, [render]);

  // ── Mouse / touch interaction for orbit camera ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    function onPointerDown(e: PointerEvent) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      const cam = cameraRef.current;
      cam.theta -= dx * 0.007;
      cam.phi += dy * 0.007;
      // Clamp phi to avoid flipping
      cam.phi = Math.max(-Math.PI * 0.48, Math.min(Math.PI * 0.48, cam.phi));
      cam.needsRender = true;
    }

    function onPointerUp(e: PointerEvent) {
      dragging = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const cam = cameraRef.current;
      cam.distance *= 1 + e.deltaY * 0.001;
      cam.distance = Math.max(0.5, Math.min(200, cam.distance));
      cam.needsRender = true;
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  // ── Handle resize ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver(() => {
      cameraRef.current.needsRender = true;
    });
    observer.observe(canvas);

    return () => observer.disconnect();
  }, []);

  // ── WebGPU not available fallback ──
  if (initSeq < 0) {
    return (
      <div className="mt-8 p-4 border border-gray-300 dark:border-gray-600 rounded-lg">
        <h3 className="text-xl font-semibold mb-2">3D Preview</h3>
        <p className="text-sm opacity-60">
          WebGPU is not available in this browser.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <h3 className="text-xl font-semibold mb-4">3D Preview (testing)</h3>
      <div className="relative w-full" style={{ height: "420px" }}>
        <canvas
          ref={canvasRef}
          className="w-full h-full rounded-md cursor-grab active:cursor-grabbing"
          style={{ touchAction: "none" }}
        />
        {initSeq === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-md">
            <span className="text-sm opacity-60">Initializing WebGPU…</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-4 mt-2">
        <p className="text-sm opacity-70">Drag to orbit · Scroll to zoom</p>
        <button
          onClick={copySvg}
          className="text-sm opacity-60 hover:opacity-100 underline underline-offset-2 transition-opacity"
        >
          {copiedSvg ? "Copied!" : "Copy SVG"}
        </button>
        <button
          onClick={exportSvg}
          className="text-sm opacity-60 hover:opacity-100 underline underline-offset-2 transition-opacity"
        >
          Export SVG
        </button>
        <button
          onClick={copyObj}
          className="text-sm opacity-60 hover:opacity-100 underline underline-offset-2 transition-opacity"
        >
          {copiedObj ? "Copied!" : "Copy OBJ"}
        </button>
        <button
          onClick={exportObj}
          className="text-sm opacity-60 hover:opacity-100 underline underline-offset-2 transition-opacity"
        >
          Export OBJ
        </button>
      </div>
    </div>
  );
}
