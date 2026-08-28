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
  { title: "Load Capacity | Nopal Tools" },
  {
    name: "description",
    content: "Tool for learning about load capacity for different size beams",
  },
];

export default function FramesVolumeCalc() {
  return (
    <Layout>
      <div className="scene1">
        <div className="simple-container p-4">
          <Breadcrumb>
            <Link to="/tools">All Tools</Link>
          </Breadcrumb>
          <h1 className="text-4xl font-bold mt-8">Load Capacity</h1>

          <p className="mt-4 mb-8 text-lg">
            Calculate the load capacity of a beam.
          </p>
        </div>
      </div>

      <Footer />
    </Layout>
  );
}
