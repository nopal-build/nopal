// app/routes/fruits_.good-building-system.$id.tsx
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { redirect, useLoaderData, useFetcher, Link } from "react-router";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  lazy,
  Suspense,
} from "react";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import {
  EditorLoadingFallback,
  EditorErrorBoundary,
} from "../components/MdxEditorFallback";
import {
  getBuildingSystemById,
  getCategories,
  updateBuildingSystem,
  createCategory,
  type BsCategory,
  type Block,
} from "../data/buildingSystem.server";
import { useMarkdown } from "../hooks/useMarkdown";

// Lazy-load the MDX editor — client only, never runs on the server.
const MdxEditorEditable = lazy(() => import("../components/MdxEditorEditable"));

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Category colour palette
// ---------------------------------------------------------------------------

const PILL_COLORS = [
  { bg: "var(--pink)", text: "var(--purple)" },
  { bg: "var(--green-light)", text: "var(--purple)" },
  { bg: "var(--moon)", text: "var(--purple)" },
  { bg: "var(--yellow)", text: "var(--purple)" },
  { bg: "var(--foreground)", text: "var(--purple-light)" },
];

function getCategoryColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return PILL_COLORS[Math.abs(hash) % PILL_COLORS.length];
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const { id } = params;
  if (!id) return redirect("/fruits/good-building-system");

  const [bs, categoriesResult] = await Promise.all([
    getBuildingSystemById(id),
    getCategories(),
  ]);

  if (!bs) throw new Response("Not Found", { status: 404 });

  const categories = categoriesResult?.data ?? [];
  const isAdmin = user.role === "Admin" || user.role === "Super";

  return { user, bs, categories, isAdmin };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  const isAdmin = user.role === "Admin" || user.role === "Super";
  if (!isAdmin) throw new Response("Forbidden", { status: 403 });

  const { id } = params;
  if (!id) throw new Response("Not Found", { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  switch (intent) {
    case "update-title": {
      const name =
        ((formData.get("name") as string) || "").trim() || "Untitled";
      const currentSlug = (formData.get("currentSlug") as string) || "";
      // Only auto-generate a slug if one hasn't been set yet.
      const slug = currentSlug || slugify(name);
      await updateBuildingSystem(id, { name, slug });
      return { ok: true, intent };
    }

    case "update-slug": {
      const raw = (formData.get("slug") as string) || "";
      const slug = slugify(raw);
      await updateBuildingSystem(id, { slug });
      return { ok: true, intent };
    }

    case "update-category": {
      const categoryId = (formData.get("categoryId") as string) || "";
      await updateBuildingSystem(id, { categoryId });
      return { ok: true, intent };
    }

    case "update-blocks": {
      const blocksJson = formData.get("blocks") as string;
      let blocks: Block[] = [];
      try {
        blocks = JSON.parse(blocksJson);
      } catch {
        /* malformed — leave empty */
      }
      await updateBuildingSystem(id, { blocks });
      return { ok: true, intent };
    }

    case "create-category": {
      const name = ((formData.get("name") as string) || "").trim();
      if (!name) return { ok: false, error: "Name required", intent };
      const slug = slugify(name);
      const category = await createCategory({ name, slug });
      if (category) {
        await updateBuildingSystem(id, { categoryId: category._id });
      }
      return { ok: true, intent, newCategoryId: category?._id };
    }

    default:
      return { ok: false, error: "Unknown intent", intent };
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CategoryPill({
  category,
  onClick,
}: {
  category: BsCategory | undefined;
  onClick?: () => void;
}) {
  const color = category
    ? getCategoryColor(category._id)
    : { bg: "var(--midground)", text: "var(--text-subtle)" };
  const label = category?.name ?? "Unpublished";
  const cls =
    "inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-mono transition-opacity";

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cls}
        style={{ background: color.bg, color: color.text, border: "none" }}
      >
        {label}
        <span style={{ opacity: 0.45 }}>▾</span>
      </button>
    );
  }

  return (
    <span className={cls} style={{ background: color.bg, color: color.text }}>
      {label}
    </span>
  );
}

function CategoryPicker({
  categories,
  currentCategoryId,
  onSelect,
  onAddNew,
  onClose,
}: {
  categories: BsCategory[];
  currentCategoryId: string;
  onSelect: (id: string) => void;
  onAddNew: (name: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = categories.filter((c) =>
    c.name.toLowerCase().includes(filter.toLowerCase()),
  );

  const trimmedFilter = filter.trim();
  const exactMatch = categories.some(
    (c) => c.name.toLowerCase() === trimmedFilter.toLowerCase(),
  );
  const showAddNew = trimmedFilter.length > 0 && !exactMatch;

  return (
    <div
      className="absolute left-0 top-full mt-1 z-50 rounded-lg overflow-hidden"
      style={{
        background: "var(--farground)",
        border: "1px solid var(--midground)",
        minWidth: "220px",
        boxShadow: "0 4px 20px rgba(63,43,70,0.14)",
      }}
    >
      {/* Search input */}
      <div
        className="px-3 py-2"
        style={{ borderBottom: "1px solid var(--midground)" }}
      >
        <input
          ref={inputRef}
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search categories…"
          className="w-full text-sm font-mono outline-none bg-transparent purple-text"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && showAddNew) {
              onAddNew(trimmedFilter);
              onClose();
            }
          }}
        />
      </div>

      {/* Options */}
      <ul className="py-1 max-h-52 overflow-y-auto">
        {/* Unpublished */}
        <li>
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-sm font-mono flex items-center gap-2 subtle-text"
            style={{
              background:
                currentCategoryId === "" ? "var(--midground)" : "transparent",
            }}
            onClick={() => {
              onSelect("");
              onClose();
            }}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                background: "var(--foreground)",
                border: "1px solid var(--midground)",
              }}
            />
            Unpublished
          </button>
        </li>

        {filtered.map((cat) => {
          const color = getCategoryColor(cat._id);
          const isActive = cat._id === currentCategoryId;
          return (
            <li key={cat._id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm font-mono flex items-center gap-2 purple-text"
                style={{
                  background: isActive ? "var(--midground)" : "transparent",
                }}
                onClick={() => {
                  onSelect(cat._id);
                  onClose();
                }}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: color.bg }}
                />
                {cat.name}
              </button>
            </li>
          );
        })}

        {showAddNew && (
          <li>
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm font-mono purple-light-text"
              onClick={() => {
                onAddNew(trimmedFilter);
                onClose();
              }}
            >
              + add "{trimmedFilter}"
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function GoodBuildingSystemDetail() {
  const { bs, categories, isAdmin } = useLoaderData<typeof loader>();

  // ── Client-only gate ──────────────────────────────────────────────────────
  const [isClient, setIsClient] = useState(false);

  // ── Category dropdown ────────────────────────────────────────────────────
  const [categoryOpen, setCategoryOpen] = useState(false);
  const categoryContainerRef = useRef<HTMLDivElement>(null);

  // ── Slug ─────────────────────────────────────────────────────────────────
  const [slugValue, setSlugValue] = useState(bs.slug);

  // ── Markdown content (first block) ───────────────────────────────────────
  const firstMd = bs.blocks.find((b) => b.type === "markdown")?.md ?? "";
  const [markdown, setMarkdown] = useState(firstMd);

  // ── Title contenteditable ref ─────────────────────────────────────────────
  const titleRef = useRef<HTMLDivElement>(null);
  const titleInitialized = useRef(false);

  // ── Fetchers ──────────────────────────────────────────────────────────────
  const metaFetcher = useFetcher();
  const categoryFetcher = useFetcher();
  const blocksFetcher = useFetcher();

  // Keep a ref so the debounced callback never stales.
  const blocksFetcherRef = useRef(blocksFetcher);
  blocksFetcherRef.current = blocksFetcher;

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slugSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentCategory = categories.find((c) => c._id === bs.categoryId);
  // The effective slug — auto-derived from name when not explicitly set.
  const effectiveSlug = bs.slug || slugify(bs.name);

  // ── Effects ───────────────────────────────────────────────────────────────

  // Enable client-only features after hydration.
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Initialise the contenteditable title once the div mounts.
  useEffect(() => {
    if (isClient && titleRef.current && !titleInitialized.current) {
      titleRef.current.textContent = bs.name;
      titleInitialized.current = true;
    }
  }, [isClient, bs.name]);

  // Keep the slug input in sync with server state after saves.
  useEffect(() => {
    setSlugValue(bs.slug);
  }, [bs.slug]);

  // Close category dropdown on outside click.
  useEffect(() => {
    if (!categoryOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        categoryContainerRef.current &&
        !categoryContainerRef.current.contains(e.target as Node)
      ) {
        setCategoryOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [categoryOpen]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleTitleInput = () => {
    const name = titleRef.current?.textContent?.trim() || "Untitled";
    if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current);
    titleSaveTimerRef.current = setTimeout(() => {
      metaFetcher.submit(
        { intent: "update-title", name, currentSlug: slugValue || bs.slug },
        { method: "POST" },
      );
    }, 1500);
  };

  const handleTitleBlur = () => {
    if (titleSaveTimerRef.current) {
      clearTimeout(titleSaveTimerRef.current);
      titleSaveTimerRef.current = null;
    }
    const name = titleRef.current?.textContent?.trim() || "Untitled";
    metaFetcher.submit(
      { intent: "update-title", name, currentSlug: slugValue || bs.slug },
      { method: "POST" },
    );
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setSlugValue(raw);
    if (slugSaveTimerRef.current) clearTimeout(slugSaveTimerRef.current);
    slugSaveTimerRef.current = setTimeout(() => {
      const slug = slugify(raw);
      setSlugValue(slug);
      if (slug !== bs.slug) {
        metaFetcher.submit({ intent: "update-slug", slug }, { method: "POST" });
      }
    }, 1500);
  };

  const handleSlugBlur = () => {
    if (slugSaveTimerRef.current) {
      clearTimeout(slugSaveTimerRef.current);
      slugSaveTimerRef.current = null;
    }
    const slug = slugify(slugValue);
    setSlugValue(slug); // normalise displayed value immediately
    if (slug !== bs.slug) {
      metaFetcher.submit({ intent: "update-slug", slug }, { method: "POST" });
    }
  };

  const handleCategorySelect = (categoryId: string) => {
    categoryFetcher.submit(
      { intent: "update-category", categoryId },
      { method: "POST" },
    );
    setCategoryOpen(false);
  };

  const handleAddNewCategory = (name: string) => {
    categoryFetcher.submit(
      { intent: "create-category", name },
      { method: "POST" },
    );
    setCategoryOpen(false);
  };

  // Debounced auto-save for markdown (1.5 s idle).
  const handleMarkdownChange = useCallback((md: string) => {
    setMarkdown(md);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const blocks: Block[] = [{ type: "markdown", md }];
      blocksFetcherRef.current.submit(
        { intent: "update-blocks", blocks: JSON.stringify(blocks) },
        { method: "POST" },
      );
    }, 1500);
  }, []);

  // Called unconditionally — it's a hook.
  const renderedMarkdown = useMarkdown(markdown);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div
        className="container mx-auto px-4 py-12"
        style={{ maxWidth: "720px" }}
      >
        {/* Back */}
        <div className="mb-8">
          <Link
            to="/fruits/good-building-system"
            className="text-sm font-mono purple-light-text"
          >
            ← back to good building
          </Link>
        </div>

        {/* ── Category pill ─────────────────────────────────────────────── */}
        <div className="mb-5 relative inline-block" ref={categoryContainerRef}>
          <CategoryPill
            category={currentCategory}
            onClick={isAdmin ? () => setCategoryOpen((o) => !o) : undefined}
          />
          {isAdmin && categoryOpen && (
            <CategoryPicker
              categories={categories}
              currentCategoryId={bs.categoryId}
              onSelect={handleCategorySelect}
              onAddNew={handleAddNewCategory}
              onClose={() => setCategoryOpen(false)}
            />
          )}
        </div>

        {/* ── Title ─────────────────────────────────────────────────────── */}
        <div className="mb-1">
          {isClient && isAdmin ? (
            <div
              ref={titleRef}
              contentEditable
              suppressContentEditableWarning
              onKeyDown={(e) => {
                // Prevent newlines — single-line title only.
                if (e.key === "Enter") e.preventDefault();
              }}
              onInput={handleTitleInput}
              onBlur={handleTitleBlur}
              className="font-bold text-2xl leading-tight outline-none"
              style={{
                cursor: "text",
                minHeight: "1.2em",
                // Subtle underline to hint it's editable.
                borderBottom: "1px solid transparent",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderBottomColor = "var(--midground)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderBottomColor = "transparent";
              }}
            />
          ) : (
            <h1 className="font-bold text-2xl leading-tight">{bs.name}</h1>
          )}
        </div>

        {/* ── Slug ──────────────────────────────────────────────────────── */}
        <div className="mb-10 flex items-center gap-0.5">
          <span
            className="text-xs font-mono select-none subtle-text"
            style={{ opacity: 0.5 }}
          >
            /
          </span>
          {isAdmin ? (
            <input
              type="text"
              value={slugValue}
              onChange={handleSlugChange}
              onBlur={handleSlugBlur}
              placeholder={effectiveSlug}
              className="text-xs font-mono outline-none bg-transparent"
              style={{
                color: slugValue ? "var(--text-subtle)" : "var(--foreground)",
                minWidth: "200px",
              }}
            />
          ) : (
            <span className="text-xs font-mono subtle-text">
              {effectiveSlug}
            </span>
          )}
        </div>

        {/* Divider */}
        <hr
          style={{
            borderColor: "currentColor",
            opacity: 0.12,
            marginBottom: "28px",
          }}
        />

        {/* ── Content ─────────────────────────────────────────────── */}
        {isAdmin ? (
          <div className="mdx-editor-wrapper">
            {isClient ? (
              <EditorErrorBoundary>
                <Suspense fallback={<EditorLoadingFallback />}>
                  <MdxEditorEditable
                    markdown={markdown}
                    onChange={handleMarkdownChange}
                  />
                </Suspense>
              </EditorErrorBoundary>
            ) : (
              <EditorLoadingFallback />
            )}
          </div>
        ) : markdown ? (
          renderedMarkdown
        ) : (
          <p className="text-sm subtle-text">No content yet.</p>
        )}

        {/* Saving indicator */}
        {(metaFetcher.state === "submitting" ||
          categoryFetcher.state === "submitting" ||
          blocksFetcher.state === "submitting") && (
          <div
            className="fixed bottom-4 right-4 text-xs font-mono px-3 py-1.5 rounded-full"
            style={{
              background: "var(--purple)",
              color: "var(--pink)",
              opacity: 0.85,
            }}
          >
            saving…
          </div>
        )}
      </div>
    </AppLayout>
  );
}
