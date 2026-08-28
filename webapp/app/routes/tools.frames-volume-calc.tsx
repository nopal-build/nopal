import { useState } from "react";
import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import { Breadcrumb } from "../components/Breadcrumb";
import { FramesVisualPreview } from "../features/ViewFinder/FramesVisualPreview";
import { NumberInput } from "../components/NumberInput";
import { useFrames, formatVolume, formatWeight } from "../hooks/useFrames";
import type { MetaFunction } from "react-router";
import { Link } from "react-router";

export const meta: MetaFunction = () => [
  { title: "Volume Calculator by Frames | Nopal Tools" },
  {
    name: "description",
    content: "Calculate backfill volumes for construction using frame slices",
  },
];

interface Material {
  id: string;
  name: string;
  description: string;
  lbsPerCubicFoot: number; // density in pounds per cubic foot
}

const MATERIALS: Material[] = [
  {
    id: "ab",
    name: "Aggregate Base (AB)",
    description: "Compacted road base material",
    lbsPerCubicFoot: 115,
  },
  {
    id: "quarter-minus",
    name: '1/4" Minus Rock',
    description: "Fine crushed material, compacts well",
    lbsPerCubicFoot: 100,
  },
  {
    id: "pea-gravel",
    name: "Pea Gravel",
    description: '1/8" - 3/8" rounded stones',
    lbsPerCubicFoot: 96,
  },
  {
    id: "crushed-stone",
    name: "Crushed Stone",
    description: '1/2" - 3/4" angular aggregate',
    lbsPerCubicFoot: 100,
  },
  {
    id: "river-rock",
    name: "River Rock",
    description: '1" - 3" smooth rounded stones',
    lbsPerCubicFoot: 90,
  },
  {
    id: "riprap",
    name: "Riprap",
    description: "Large angular stones for erosion control",
    lbsPerCubicFoot: 85,
  },
  {
    id: "sand",
    name: "Sand",
    description: "Fine granular material",
    lbsPerCubicFoot: 100,
  },
  {
    id: "dirt",
    name: "Dirt",
    description: "General fill dirt/soil",
    lbsPerCubicFoot: 75,
  },
  {
    id: "concrete",
    name: "Concrete",
    description: "Mixed concrete",
    lbsPerCubicFoot: 150,
  },
];

export default function FramesVolumeCalc() {
  const {
    frames,
    addFrame,
    removeFrame,
    updateFrame,
    totalVolume,
    segmentVolumes,
  } = useFrames();
  const [selectedMaterialId, setSelectedMaterialId] =
    useState<string>("quarter-minus");

  const selectedMaterial =
    MATERIALS.find((m) => m.id === selectedMaterialId) || MATERIALS[0];

  const formattedTotal = formatVolume(totalVolume);
  const totalWeight =
    formattedTotal.cubicFeet * selectedMaterial.lbsPerCubicFoot;
  const formattedWeight = formatWeight(totalWeight);

  // Cumulative distance from the first frame (in feet)
  const cumulativeDistances = frames.map((_, i) =>
    frames.slice(0, i).reduce((sum, f) => sum + f.distanceToNext, 0)
  );
  const totalLength = cumulativeDistances[cumulativeDistances.length - 1] || 0;

  return (
    <Layout>
      <div className="scene1">
        <div className="simple-container p-4">
          <Breadcrumb>
            <Link to="/tools">All Tools</Link>
          </Breadcrumb>
          <h1 className="text-4xl font-bold mt-8">
            Volume Calculator by Frames
          </h1>

          <p className="mt-4 mb-8 text-lg">
            Calculate the volume along a linear run. Each frame represents a
            rectangular cross-section slice. The volume between frames is
            calculated using trapezoidal approximation.
          </p>

          {/* Material Selection */}
          <div className="mb-6">
            <label
              htmlFor="material-select"
              className="block text-lg font-medium mb-2"
            >
              Select Material
            </label>
            <select
              id="material-select"
              value={selectedMaterialId}
              onChange={(e) => setSelectedMaterialId(e.target.value)}
              className="w-full sm:w-auto px-4 py-3 border border-gray-300 dark:border-[var(--dark-midground)] rounded-md bg-white dark:bg-[var(--purple)] dark:text-white focus:outline-none focus:ring-2 focus:ring-[var(--green)] text-lg"
            >
              {MATERIALS.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name}
                </option>
              ))}
            </select>
            <p className="text-sm opacity-70 mt-1">
              {selectedMaterial.description} —{" "}
              {selectedMaterial.lbsPerCubicFoot} lbs/ft³
            </p>
          </div>

          {/* Total Volume & Weight Display */}
          <div className="bg-green-100 dark:bg-green-900 rounded-lg p-6 mb-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <h3 className="text-xl green-text mb-1">Total Volume</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-xl font-bold">
                      {formattedTotal.cubicFeetStr}
                    </span>
                    <span className="text-lg ml-1">ft³</span>
                  </div>
                  <div>
                    <span className="text-xl font-bold">
                      {formattedTotal.cubicYardsStr}
                    </span>
                    <span className="text-lg ml-1">yd³</span>
                  </div>
                </div>
              </div>
              <div>
                <h3 className="text-xl green-text mb-1">Total Length</h3>
                <div>
                  <span className="text-xl font-bold">
                    {totalLength.toFixed(1)}
                  </span>
                  <span className="text-lg ml-1">ft</span>
                </div>
              </div>
              <div>
                <h3 className="text-xl green-text mb-1">Total Weight</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-xl font-bold">
                      {formattedWeight.pounds}
                    </span>
                    <span className="text-lg ml-1">lbs</span>
                  </div>
                  <div>
                    <span className="text-xl font-bold">
                      {formattedWeight.tons}
                    </span>
                    <span className="text-lg ml-1">tons</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Frames List */}
          <div className="relative mb-6 pl-8">
            {/* Vertical line — from center of first dot to center of last dot */}
            {frames.length > 1 && (
              <div
                className="absolute bg-[var(--moon)]"
                style={{
                  width: "4px",
                  left: "18px",
                  top: "23px",
                  bottom: "23px",
                  borderRadius: "2px",
                }}
              />
            )}

            {frames.flatMap((frame, index) => {
              const elements = [];

              {
                /* Frame Node — big dot + card */
              }
              elements.push(
                <div
                  key={`frame-${frame.id}`}
                  className="relative flex items-start gap-6"
                >
                  {/* Big dot on the line */}
                  <div
                    className="absolute flex-shrink-0 z-10"
                    style={{
                      left: "-31px",
                      top: "-3px",
                    }}
                  >
                    <div
                      className="rounded-full bg-[var(--moon)] border-4 border-[var(--white)] dark:border-[var(--purple)]"
                      style={{
                        width: "38px",
                        height: "38px",
                      }}
                    ></div>
                  </div>

                  {/* Frame content card */}
                  <div className="flex-1 ml-4 pb-2 pt-0.5">
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="text-xl font-semibold">
                        Frame {index + 1}
                        <span className="text-sm font-normal opacity-70 ml-3">
                          {index === 0
                            ? "(start)"
                            : `${cumulativeDistances[index].toFixed(
                                1
                              )} ft from start`}
                        </span>
                      </h4>
                      {frames.length > 1 && (
                        <button
                          onClick={() => removeFrame(frame.id)}
                          className="text-red-500 hover:text-red-700 text-sm px-2 py-1"
                          aria-label={`Remove frame ${index + 1}`}
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label
                          htmlFor={`width-${frame.id}`}
                          className="block text-sm font-medium mb-1"
                        >
                          Width (inches)
                        </label>
                        <NumberInput
                          id={`width-${frame.id}`}
                          min={0}
                          step={0.5}
                          value={frame.width}
                          onChange={(v) => updateFrame(frame.id, "width", v)}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`depth-${frame.id}`}
                          className="block text-sm font-medium mb-1"
                        >
                          Depth (inches)
                        </label>
                        <NumberInput
                          id={`depth-${frame.id}`}
                          min={0}
                          step={0.5}
                          value={frame.depth}
                          onChange={(v) => updateFrame(frame.id, "depth", v)}
                        />
                      </div>
                    </div>

                    <div className="mt-2 text-sm opacity-70">
                      Cross-section: {(frame.width * frame.depth).toFixed(1)}{" "}
                      in² ({((frame.width * frame.depth) / 144).toFixed(2)} ft²)
                    </div>
                  </div>
                </div>
              );

              {
                /* Distance Connector — between frames */
              }
              if (index < frames.length - 1) {
                elements.push(
                  <div
                    key={`dist-${frame.id}`}
                    className="relative flex items-start"
                  >
                    {/* Distance + segment volume content */}
                    <div className="flex-1 py-6 pl-4 my-2">
                      <div className="flex flex-wrap items-end gap-4">
                        <div className="w-48">
                          <label
                            htmlFor={`distance-${frame.id}`}
                            className="block text-sm font-medium mb-1 opacity-80"
                          >
                            Distance to Frame {index + 2} (feet)
                          </label>
                          <NumberInput
                            id={`distance-${frame.id}`}
                            min={0}
                            step={0.5}
                            value={frame.distanceToNext}
                            onChange={(v) =>
                              updateFrame(frame.id, "distanceToNext", v)
                            }
                          />
                        </div>
                        {segmentVolumes[index] && (
                          <div className="text-sm purple-light-text pb-2">
                            Segment volume:{" "}
                            <span className="font-semibold">
                              {
                                formatVolume(segmentVolumes[index].volume)
                                  .cubicFeetStr
                              }{" "}
                              ft³
                            </span>{" "}
                            (
                            {
                              formatVolume(segmentVolumes[index].volume)
                                .cubicYardsStr
                            }{" "}
                            yd³)
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              return elements;
            })}

            {/* Insert Frame Button */}
            <div className="relative mt-8">
              {/* Big dot on the line */}
              <div
                className="absolute flex-shrink-0 z-10"
                style={{
                  left: "-31px",
                  top: "-1px",
                }}
              >
                <div
                  className="rounded-full bg-[var(--moon)] border-4 border-[var(--white)] dark:border-[var(--purple)] flex items-center justify-center text-sm font-bold text-[var(--purple)]"
                  style={{
                    width: "38px",
                    height: "38px",
                  }}
                >
                  +
                </div>
              </div>
              <button
                onClick={addFrame}
                className="px-4 py-1 btn btn-purple w-full sm:w-auto text-lg ml-0.5"
              >
                Add Frame
              </button>
            </div>
          </div>

          {/* Visual Representation */}
          <FramesVisualPreview frames={frames} />
        </div>
      </div>

      <Footer />
    </Layout>
  );
}
