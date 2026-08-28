import { useState, useRef, useEffect } from "react";
import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import { Breadcrumb } from "../components/Breadcrumb";
import type { MetaFunction } from "react-router";
import { Link } from "react-router";

export const meta: MetaFunction = () => [
  { title: "Do Not Use | Nopal Tools" },
  {
    name: "description",
    content: "Generate a printable version of a Do Not Use list",
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type Item = {
  id: string;
  label: string;
  annotation?: string;
  category: string;
};

type PaperSize = "letter" | "a4" | "legal" | "tabloid";

// ─── Data ─────────────────────────────────────────────────────────────────────

const CATEGORIES = ["Insulation", "Structure", "Systems", "Enclosure"];

const ALL_ITEMS: Item[] = [
  // Insulation
  {
    id: "spray-foam",
    label: "Spray Foam",
    annotation: "all types blow",
    category: "Insulation",
  },
  {
    id: "xps",
    label: "XPS Rigid Insulation",
    annotation: "carbon bomb",
    category: "Insulation",
  },
  {
    id: "fiberglass",
    label: "Fiberglass & Mineral Wool",
    annotation: "we don't like to be itchy",
    category: "Insulation",
  },
  // Structure
  {
    id: "osb",
    label: "OSB Sheathing",
    annotation: "mold's best friend",
    category: "Structure",
  },
  {
    id: "excessive-concrete",
    label: "Excessive Concrete",
    annotation: "great material; massive carbon impact",
    category: "Structure",
  },
  // Systems
  {
    id: "flex-duct",
    label: "Flex Duct",
    annotation: "floppy plastic fails",
    category: "Systems",
  },
  {
    id: "natural-gas",
    label: "Natural Gas",
    annotation: "a whole lifecycle of toxicity",
    category: "Systems",
  },
  {
    id: "unbalanced-ventilation",
    label: "Unbalanced Ventilation",
    annotation: "you like fresh air, right?",
    category: "Systems",
  },
  // Enclosure
  {
    id: "vinyl",
    label: "Vinyl",
    annotation: "did you hear about that train explosion?",
    category: "Enclosure",
  },
  {
    id: "pfas-membranes",
    label: "PFAS / Microporous Membranes",
    annotation: "gross, dude",
    category: "Enclosure",
  },
];

const PAPER_SIZES: Record<
  PaperSize,
  { label: string; widthIn: number; heightIn: number; cssSize: string }
> = {
  letter: {
    label: 'Letter (8.5" × 11")',
    widthIn: 8.5,
    heightIn: 11,
    cssSize: "letter",
  },
  a4: {
    label: "A4 (210mm × 297mm)",
    widthIn: 8.27,
    heightIn: 11.69,
    cssSize: "A4",
  },
  legal: {
    label: 'Legal (8.5" × 14")',
    widthIn: 8.5,
    heightIn: 14,
    cssSize: "legal",
  },
  tabloid: {
    label: 'Tabloid (11" × 17")',
    widthIn: 11,
    heightIn: 17,
    cssSize: "tabloid",
  },
};

const DPI = 96;

// ─── Logo ─────────────────────────────────────────────────────────────────────

function NopalLogo({
  width = 194,
  color = "#3F2B46",
}: {
  width?: number;
  color?: string;
}) {
  const height = Math.round((169 / 388) * width);
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 388 169"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M341.525 112.153V128.175H387.588V112.153H374.07V0H341.525V16.0218H357.547V112.153H341.525Z"
        fill={color}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M342.02 112.153V128.175H312.98V116.659C307.973 120.164 293.654 129.176 280.436 129.176C263.913 129.176 254.4 117.16 254.4 102.139C254.4 87.1188 263.913 73.0997 284.441 73.0997C299.462 73.0997 309.976 79.1079 311.979 81.1106V66.0902C310.977 61.4171 306.371 52.0711 291.952 52.0711C277.532 52.0711 273.426 59.0806 271.924 62.0847L255.902 57.5786C258.907 50.9028 270.622 37.5513 293.454 37.5513C316.285 37.5513 325.664 51.5704 327.5 59.0806V112.153H342.02ZM311.682 98.4204C311.625 102.124 306.511 108.158 293.218 111.004C282.988 113.193 271.436 113.533 271.603 102.635C271.77 91.7371 279.299 86.3647 291.103 87.8143C302.908 89.264 311.739 94.7166 311.682 98.4204Z"
        fill={color}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M148.627 168.23V152.208H164.649V55.0755H149.628V40.0551H181.672V53.0728C185.511 47.7322 196.993 39.0537 212.214 39.0537C231.24 39.0537 255.272 51.0701 255.272 83.6144C255.272 116.159 231.74 130.178 212.214 130.178C196.592 130.178 185.344 121.499 181.672 117.16V152.208H197.694V168.23H148.627ZM209.711 115.157C225.472 115.157 238.25 101.483 238.25 84.6154C238.25 67.7478 225.472 54.0738 209.711 54.0738C193.949 54.0738 181.172 67.7478 181.172 84.6154C181.172 101.483 193.949 115.157 209.711 115.157Z"
        fill={color}
      />
      <path
        d="M131.464 128.716C119.316 128.072 113.78 124.025 113.565 121.199C113.332 118.125 120.128 112.326 130.39 109.547C139.394 107.109 147.353 112.26 149.614 119.463C151.874 126.667 140.812 129.211 131.464 128.716Z"
        fill="#5DA06D"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M120.336 107.147C139.14 107.147 154.383 91.9034 154.383 73.1001C154.383 54.2968 139.14 39.0537 120.336 39.0537C101.533 39.0537 86.29 54.2968 86.29 73.1001C86.29 91.9034 101.533 107.147 120.336 107.147ZM120.337 91.1241C130.292 91.1241 138.361 83.0542 138.361 73.0995C138.361 63.1448 130.292 55.0749 120.337 55.0749C110.382 55.0749 102.312 63.1448 102.312 73.0995C102.312 83.0542 110.382 91.1241 120.337 91.1241Z"
        fill={color}
      />
      <path
        d="M0.544922 112.153V128.175H47.1084V112.153H32.5886V65.5893C34.5913 63.0859 47.1084 55.075 58.1234 55.075C66.9354 55.075 68.6377 61.0831 68.6377 65.5893L69.1384 128.175H100.681V112.153H84.6596V56.0763C84.6596 49.5675 77.1493 38.0518 62.6295 38.0518C51.0137 38.0518 37.4285 47.064 32.5886 50.5688V40.0545H0.544922V55.075H15.0647V112.153H0.544922Z"
        fill={color}
      />
    </svg>
  );
}

// ─── Printable Page Content ───────────────────────────────────────────────────

function PrintableContent({
  selectedItems,
  pageWidthPx,
  pageHeightPx,
  scale,
}: {
  selectedItems: Item[];
  pageWidthPx: number;
  pageHeightPx: number;
  scale: number;
}) {
  const extraCats = Array.from(
    new Set(
      selectedItems
        .map((i) => i.category)
        .filter((c) => !CATEGORIES.includes(c))
    )
  );
  const allCats = [...CATEGORIES, ...extraCats];
  const byCategory = allCats.reduce<Record<string, Item[]>>((acc, cat) => {
    const items = selectedItems.filter((i) => i.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {});

  const qrUrl =
    "https://api.qrserver.com/v1/create-qr-code/?size=90x90&data=https%3A%2F%2Fnopal.build&bgcolor=ffffff&color=3f2b46&margin=4";

  return (
    <div
      id="printable-page"
      style={{
        width: `${pageWidthPx}px`,
        height: `${pageHeightPx}px`,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        backgroundColor: "#fff9f1",
        padding: "72px",
        boxSizing: "border-box",
        fontFamily:
          'ui-monospace, SFMono-Regular, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
        color: "#3F2B46",
        flexShrink: 0,
      }}
    >
      {/* Header: Logo + QR */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "12px",
        }}
      >
        <NopalLogo width={220} />
        <div style={{ textAlign: "center" }}>
          <img
            src={qrUrl}
            alt="nopal.build QR code"
            width={90}
            height={90}
            style={{ display: "block", borderRadius: "4px" }}
          />
          <div
            style={{
              fontSize: "10px",
              marginTop: "4px",
              opacity: 0.55,
              letterSpacing: "0.05em",
            }}
          >
            nopal.build
          </div>
        </div>
      </div>

      {/* Do Not Use Box */}
      <div
        style={{
          marginTop: "88px",
          padding: "24px 28px",
          borderRadius: "8px",
          position: "relative",
        }}
      >
        {/* Dashed border rendered as inline SVG so it survives print */}
        <svg
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
            pointerEvents: "none",
          }}
        >
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            rx="8"
            ry="8"
            fill="none"
            stroke="#a63b31"
            strokeWidth="4"
            strokeDasharray="6 14"
            strokeLinecap="square"
          />
        </svg>

        {/* Rotated Title */}
        <div
          className="dnu-badge"
          style={{
            position: "absolute",
            top: "-44px",
            left: "-10px",
            color: "#a63b31",
            border: "3px solid #a63b31",
            borderRadius: "8px",
            padding: "8px 18px",
            fontWeight: "bold",
            fontSize: "26px",
            transform: "rotate(-8deg)",
            backgroundColor: "#fff9f1",
            letterSpacing: "0.05em",
          }}
        >
          DO NOT USE
        </div>

        {/* Items grouped by category */}
        <div
          style={{
            marginTop: "16px",
            display: "flex",
            flexWrap: "wrap",
            gap: "28px 40px",
          }}
        >
          {Object.entries(byCategory).map(([cat, items]) => (
            <dl key={cat} style={{ margin: 0, minWidth: "180px" }}>
              <dt
                style={{
                  fontSize: "10px",
                  fontWeight: "bold",
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  opacity: 0.4,
                  marginBottom: "6px",
                }}
              >
                {cat}
              </dt>
              {items.map((item) => (
                <dd
                  key={item.id}
                  style={{
                    margin: 0,
                    fontSize: "20px",
                    lineHeight: "32px",
                    display: "flex",
                    alignItems: "baseline",
                    gap: "6px",
                  }}
                >
                  <span style={{ opacity: 0.4, flexShrink: 0 }}>–</span>
                  <span>{item.label}</span>
                  {item.annotation && (
                    <span
                      style={{
                        fontFamily: '"Indie Flower", cursive',
                        color: "#a63b31",
                        fontSize: "20px",
                        lineHeight: 1,
                      }}
                    >
                      {item.annotation}
                    </span>
                  )}
                </dd>
              ))}
            </dl>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: "40px",
          marginBottom: "8px",
          fontSize: "12px",
          opacity: 0.4,
          letterSpacing: "0.05em",
        }}
      >
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: "0.3em" }}
        >
          Good Building. Healthy Homes.
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="currentColor"
            style={{
              display: "inline-block",
              verticalAlign: "middle",
              flexShrink: 0,
              marginInline: "8px",
            }}
          >
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
          </svg>
          @nopal.build
        </span>
      </div>
    </div>
  );
}

// ─── Annotation Input ─────────────────────────────────────────────────────────

function AnnotationInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  // Sync external value changes (e.g. revert) back to the DOM imperatively,
  // but only when the DOM actually differs — this preserves cursor position
  // during normal typing.
  useEffect(() => {
    if (ref.current && ref.current.textContent !== value) {
      ref.current.textContent = value;
    }
  }, [value]);

  const hasContent = value.trim() !== "";

  return (
    <span
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      onInput={() => {
        const text = ref.current?.textContent ?? "";
        // Strip any stray <br> the browser inserts when content is cleared
        if (text === "" && ref.current) ref.current.innerHTML = "";
        onChange(text);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      data-placeholder="add note…"
      className="font-hand annotation-ce red-text"
      style={{
        fontSize: "16px",
        lineHeight: 1,
        outline: "none",
        borderBottom: "1px dashed transparent",
        display: "inline-block",
        minWidth: "40px",
        whiteSpace: "nowrap",
        cursor: "text",
        opacity: hasContent ? 1 : 0.3,
        transition: "border-color 0.15s, opacity 0.15s",
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderBottomColor = "var(--red)";
        e.currentTarget.style.opacity = "1";
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderBottomColor = "transparent";
        e.currentTarget.style.opacity = hasContent ? "1" : "0.3";
      }}
    />
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DoNotUseTool() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(ALL_ITEMS.map((i) => i.id))
  );
  const [paperSize, setPaperSize] = useState<PaperSize>("letter");
  const [customItems, setCustomItems] = useState<Item[]>([]);
  const [customLabel, setCustomLabel] = useState("");
  const [customAnnotation, setCustomAnnotation] = useState("");
  const [customCategory, setCustomCategory] = useState<string>(CATEGORIES[0]);
  const [annotationOverrides, setAnnotationOverrides] = useState<
    Record<string, string>
  >({});
  const [previewWidth, setPreviewWidth] = useState(440);
  const previewWrapperRef = useRef<HTMLDivElement>(null);

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCategory = (cat: string) => {
    const catItems = ALL_ITEMS.filter((i) => i.category === cat);
    const allSelected = catItems.every((i) => selectedIds.has(i.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      catItems.forEach((i) => {
        if (allSelected) next.delete(i.id);
        else next.add(i.id);
      });
      return next;
    });
  };

  const addCustomItem = () => {
    const trimmed = customLabel.trim();
    if (!trimmed) return;
    const id = "custom-" + Date.now();
    const item: Item = {
      id,
      label: trimmed,
      annotation: customAnnotation.trim() || undefined,
      category: customCategory,
    };
    setCustomItems((prev) => [...prev, item]);
    setSelectedIds((prev) => new Set([...prev, id]));
    setCustomLabel("");
    setCustomAnnotation("");
  };

  const removeCustomItem = (id: string) => {
    setCustomItems((prev) => prev.filter((i) => i.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const updateAnnotation = (id: string, value: string) => {
    setAnnotationOverrides((prev) => ({ ...prev, [id]: value }));
  };

  const revertAnnotation = (id: string) => {
    setAnnotationOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const getAnnotation = (item: Item): string | undefined => {
    if (item.id in annotationOverrides) {
      const v = annotationOverrides[item.id];
      return v.trim() === "" ? undefined : v;
    }
    return item.annotation;
  };

  const allItems = [...ALL_ITEMS, ...customItems];
  const selectedItems = allItems
    .filter((i) => selectedIds.has(i.id))
    .map((i) => ({ ...i, annotation: getAnnotation(i) }));
  const paper = PAPER_SIZES[paperSize];

  const pageWidthPx = Math.round(paper.widthIn * DPI);
  const pageHeightPx = Math.round(paper.heightIn * DPI);

  useEffect(() => {
    const el = previewWrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setPreviewWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale = previewWidth / pageWidthPx;
  const previewHeightPx = Math.round(pageHeightPx * scale);

  return (
    <Layout>
      {/* Annotation contentEditable placeholder */}
      <style>{`
        .annotation-ce:empty::before {
          content: attr(data-placeholder);
          pointer-events: none;
        }
      `}</style>

      {/* Print styles injected dynamically based on selected paper size */}
      <style>{`
        @media print {
          @page {
            size: ${paper.cssSize};
            margin: 0;
          }

          html, body {
            width: ${pageWidthPx}px !important;
            height: ${pageHeightPx}px !important;
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          body * {
            visibility: hidden;
          }

          #printable-page,
          #printable-page * {
            visibility: visible;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .preview-shadow-wrapper {
            overflow: visible !important;
            box-shadow: none !important;
          }

          #printable-page {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            transform: none !important;
            width: ${pageWidthPx}px !important;
            height: ${pageHeightPx}px !important;
            box-shadow: none !important;
            background-color: #ffffff !important;
          }

          .dnu-badge {
            background-color: #ffffff !important;
          }
        }
      `}</style>

      <div className="scene1">
        <div className="simple-container p-4 pb-24 max-w-screen-md">
          <Breadcrumb>
            <Link to="/tools">All Tools</Link>
          </Breadcrumb>

          <h1 className="text-4xl font-bold mt-8">Do Not Use</h1>
          <p className="mt-3 mb-10 text-lg">
            Customize and print a Do Not Use list for your job site, office, or
            spec binder.
          </p>
          <div
            className="flex flex-col gap-10"
            style={{ alignItems: "flex-start" }}
          >
            {/* ── Top Row: Controls + Preview ── */}
            <div
              className="flex gap-8"
              style={{
                alignItems: "flex-start",
                flexWrap: "wrap",
              }}
            >
              {/* Config Panel */}
              <div style={{ flexShrink: 0 }}>
                {/* Items by Category */}
                <section>
                  <h3 className="font-bold text-xs uppercase tracking-widest mb-3 purple-light-text">
                    Include Items
                  </h3>

                  {CATEGORIES.map((cat) => {
                    const catItems = ALL_ITEMS.filter(
                      (i) => i.category === cat
                    );
                    const allSelected = catItems.every((i) =>
                      selectedIds.has(i.id)
                    );
                    const someSelected = catItems.some((i) =>
                      selectedIds.has(i.id)
                    );

                    return (
                      <div key={cat} className="mb-4">
                        {/* Category toggle */}
                        <button
                          onClick={() => toggleCategory(cat)}
                          className="flex items-center gap-1 mb-1 text-xs font-bold uppercase tracking-wide cursor-pointer red-text"
                          style={{
                            opacity: allSelected ? 1 : someSelected ? 0.7 : 0.5,
                            background: "none",
                            border: "none",
                            padding: 0,
                          }}
                        >
                          <span
                            style={{
                              display: "inline-block",
                              width: "12px",
                              height: "12px",
                              border: "2px solid currentColor",
                              borderRadius: "2px",
                              background: allSelected
                                ? "currentColor"
                                : "transparent",
                              flexShrink: 0,
                              position: "relative",
                            }}
                          >
                            {someSelected && !allSelected && (
                              <span
                                style={{
                                  position: "absolute",
                                  top: "1px",
                                  left: "2px",
                                  fontSize: "8px",
                                  lineHeight: 1,
                                  color: "var(--red)",
                                }}
                              >
                                –
                              </span>
                            )}
                          </span>
                          {cat}
                        </button>

                        {/* Individual items */}
                        {catItems.map((item) => {
                          const originalAnnotation = item.annotation ?? "";
                          const currentAnnotation =
                            item.id in annotationOverrides
                              ? annotationOverrides[item.id]
                              : originalAnnotation;
                          const isDirty =
                            currentAnnotation !== originalAnnotation;

                          return (
                            <div
                              key={item.id}
                              className="flex items-baseline gap-2 mb-1 font-mono"
                              style={{
                                fontSize: "13px",
                                paddingLeft: "16px",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedIds.has(item.id)}
                                onChange={() => toggleItem(item.id)}
                                style={{
                                  flexShrink: 0,
                                  marginTop: "2px",
                                  cursor: "pointer",
                                }}
                              />
                              <span
                                onClick={() => toggleItem(item.id)}
                                style={{ cursor: "pointer", fontSize: "16px" }}
                              >
                                {item.label}
                              </span>
                              <AnnotationInput
                                value={currentAnnotation}
                                onChange={(v) => updateAnnotation(item.id, v)}
                              />
                              {isDirty && (
                                <button
                                  onClick={() => revertAnnotation(item.id)}
                                  title={`Revert to: "${
                                    originalAnnotation || "(none)"
                                  }"`}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    padding: "0 2px",
                                    cursor: "pointer",
                                    color: "var(--text-subtle)",
                                    fontSize: "13px",
                                    lineHeight: 1,
                                    flexShrink: 0,
                                    opacity: 0.55,
                                  }}
                                >
                                  ↩
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </section>

                {/* Custom Items */}
                <section className="mt-8">
                  <h3 className="font-bold text-xs uppercase tracking-widest mb-3 purple-light-text">
                    Custom Items
                  </h3>

                  {customItems.length > 0 && (
                    <div className="mb-3">
                      {customItems.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-baseline gap-2 mb-1 font-mono"
                          style={{ fontSize: "13px", paddingLeft: "16px" }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(item.id)}
                            onChange={() => toggleItem(item.id)}
                            style={{ flexShrink: 0, marginTop: "2px" }}
                          />
                          <span className="flex-1">{item.label}</span>
                          <span
                            className="font-mono"
                            style={{
                              fontSize: "10px",
                              opacity: 0.45,
                              flexShrink: 0,
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                            }}
                          >
                            {item.category}
                          </span>
                          {item.annotation && (
                            <span
                              className="font-hand red-text"
                              style={{
                                fontSize: "15px",
                                lineHeight: 1,
                              }}
                            >
                              {item.annotation}
                            </span>
                          )}
                          <button
                            onClick={() => removeCustomItem(item.id)}
                            title="Remove"
                            style={{
                              background: "none",
                              border: "none",
                              padding: "0 2px",
                              cursor: "pointer",
                              color: "var(--text-subtle)",
                              fontSize: "14px",
                              lineHeight: 1,
                              flexShrink: 0,
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add form */}
                  <div
                    style={{
                      border: "1.5px solid var(--midground)",
                      borderRadius: "6px",
                      padding: "10px",
                      backgroundColor: "var(--farground)",
                    }}
                  >
                    <select
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value)}
                      className="font-mono text-sm w-full"
                      style={{
                        background: "none",
                        border: "none",
                        borderBottom: "1px solid var(--midground)",
                        outline: "none",
                        color: "var(--text-subtle)",
                        paddingBottom: "6px",
                        marginBottom: "6px",
                        width: "100%",
                        appearance: "auto",
                      }}
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Item name"
                      value={customLabel}
                      onChange={(e) => setCustomLabel(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addCustomItem()}
                      className="font-mono text-sm w-full"
                      style={{
                        background: "none",
                        border: "none",
                        outline: "none",
                        color: "var(--purple)",
                        marginBottom: "6px",
                        width: "100%",
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Annotation (optional)"
                      value={customAnnotation}
                      onChange={(e) => setCustomAnnotation(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addCustomItem()}
                      className="font-hand w-full"
                      style={{
                        background: "none",
                        border: "none",
                        borderTop: "1px solid var(--midground)",
                        outline: "none",
                        paddingTop: "6px",
                        fontSize: "16px",
                        width: "100%",
                      }}
                    />
                    <button
                      onClick={addCustomItem}
                      disabled={!customLabel.trim()}
                      className="btn-secondary text-xs w-full mt-2"
                      style={{ opacity: customLabel.trim() ? 1 : 0.4 }}
                    >
                      + Add Item
                    </button>
                  </div>
                </section>

                {/* Paper Size */}
                <div className="mt-8 mb-8">
                  <label
                    className="font-bold text-xs uppercase tracking-widest block mb-2 purple-light-text"
                    htmlFor="paper-size-select"
                  >
                    Paper Size
                  </label>
                  <select
                    id="paper-size-select"
                    value={paperSize}
                    onChange={(e) => setPaperSize(e.target.value as PaperSize)}
                    className="font-mono text-sm w-full"
                    style={{
                      padding: "6px 10px",
                      border: "1.5px solid var(--midground)",
                      borderRadius: "6px",
                      backgroundColor: "var(--farground)",
                      color: "var(--purple)",
                      appearance: "auto",
                    }}
                  >
                    {(Object.keys(PAPER_SIZES) as PaperSize[]).map((size) => (
                      <option key={size} value={size}>
                        {PAPER_SIZES[size].label}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  className="btn-primary mt-6"
                  onClick={() => window.print()}
                  disabled={selectedItems.length === 0}
                >
                  Print / Save PDF
                </button>

                {selectedItems.length === 0 && (
                  <p
                    className="text-sm mt-2 font-mono"
                    style={{ color: "var(--red)", opacity: 0.8 }}
                  >
                    Select at least one item
                  </p>
                )}
              </div>

              {/* Preview */}
              <div className="mt-8">
                <h3 className="font-bold text-xs uppercase tracking-widest mb-3 purple-light-text">
                  Preview — {paper.label}
                </h3>

                <div
                  className="preview-shadow-wrapper"
                  ref={previewWrapperRef}
                  style={{
                    width: "100%",
                    height: `${previewHeightPx}px`,
                    overflow: "hidden",
                    boxShadow:
                      "0 2px 8px rgba(63,43,70,0.1), 0 8px 32px rgba(63,43,70,0.12)",
                    borderRadius: "3px",
                  }}
                >
                  {selectedItems.length > 0 ? (
                    <PrintableContent
                      selectedItems={selectedItems}
                      pageWidthPx={pageWidthPx}
                      pageHeightPx={pageHeightPx}
                      scale={scale}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "#fff9f1",
                        color: "var(--text-subtle)",
                        fontFamily: "monospace",
                        fontSize: "14px",
                      }}
                    >
                      No items selected
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </Layout>
  );
}
