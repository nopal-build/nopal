/**
 * `==highlighted text==` syntax — GraphLog's `GRAPH.md` skill wraps every
 * verbatim quote it pulls from a daily log in `==...==` (see the graphlog
 * skill), and nothing in OxMarkdown parsed or rendered that at all before
 * this: it showed up as literal, unstyled `==text==`.
 *
 * Hand-rolled rather than reaching for a package that does this outright
 * (e.g. `micromark-extension-highlight-mark`/`mdast-util-highlight-mark`),
 * per explicit product direction. The actual tokenizing/resolving logic
 * below is original, written by mirroring the SHAPE of the strikethrough
 * extension this repo already depends on transitively (bundled inside
 * `micromark-extension-gfm` / `mdast-util-gfm`:
 * `micromark-extension-gfm-strikethrough` / `mdast-util-gfm-strikethrough`)
 * — `==text==` is structurally the same idea as `~~text~~`, just with a
 * fixed two-character delimiter instead of a one-or-two-character one, so
 * there's no open/close run-length ambiguity to resolve. The small
 * `micromark-util-*` packages imported here are generic micromark
 * plumbing (character classification, event splicing, resolver chaining)
 * already present transitively via `micromark-extension-gfm` — declared
 * directly here (see `package.json`) for the same reason `oxmarkdown-
 * core`'s other direct deps are: so pnpm's strict linking doesn't leave
 * this importing an undeclared transitive package.
 */

import { splice } from "micromark-util-chunked";
import { classifyCharacter } from "micromark-util-classify-character";
import { resolveAll } from "micromark-util-resolve-all";
import { codes, constants, types } from "micromark-util-symbol";
import type {
  Construct,
  Effects,
  Event,
  Extension as MicromarkExtension,
  Resolver,
  State,
  Token,
  TokenizeContext,
} from "micromark-util-types";
import type { Parent, PhrasingContent } from "mdast";
import type {
  CompileContext,
  Extension as FromMarkdownExtension,
  Handle as FromMarkdownHandle,
} from "mdast-util-from-markdown";
import type {
  ConstructName,
  Handle as ToMarkdownHandle,
  Options as ToMarkdownExtension,
} from "mdast-util-to-markdown";

export interface Mark extends Parent {
  type: "mark";
  children: PhrasingContent[];
}

// Registers `mark` as a real mdast/micromark/to-markdown node/token type —
// see each package's own doc comment on the interface being augmented
// (`PhrasingContentMap`/`TokenTypeMap`/`ConstructNameMap`) for the exact
// same pattern third-party extensions like `mdast-util-gfm-strikethrough`
// use, just written out here directly since we're not shipping a
// separate published package with its own bundled `.d.ts`.
declare module "mdast" {
  interface PhrasingContentMap {
    mark: Mark;
  }
  // `Parent.children` is typed as `RootContent[]` for every mdast parent
  // (including e.g. `Strong`/`Emphasis`/`Delete`, which in practice only
  // ever nest inside phrasing content too) -- `RootContentMap` is really
  // "every registered node type", not literally "only Root's direct
  // children", so `mark` needs to be here too or every OTHER custom
  // parent type in this file (`TextDirective`, etc.) stops typechecking
  // the moment `PhrasingContent` can contain something `RootContent`
  // doesn't know about.
  interface RootContentMap {
    mark: Mark;
  }
}
declare module "micromark-util-types" {
  interface TokenTypeMap {
    highlightSequenceTemporary: "highlightSequenceTemporary";
    highlightSequence: "highlightSequence";
    highlight: "highlight";
    highlightText: "highlightText";
  }
}
declare module "mdast-util-to-markdown" {
  interface ConstructNameMap {
    highlight: "highlight";
  }
}

// ── micromark: tokenizer ─────────────────────────────────────────────────

/** Micromark extension enabling `==text==` in the `text` construct — see
 * module docstring for how this maps onto `micromark-extension-gfm-
 * strikethrough`'s shape. */
export function highlightMark(): MicromarkExtension {
  const tokenizer: Construct = {
    name: "highlightMark",
    tokenize: tokenizeHighlightMark,
    resolveAll: resolveAllHighlightMark,
  };

  return {
    text: { [codes.equalsTo]: tokenizer },
    insideSpan: { null: [tokenizer] },
    attentionMarkers: { null: [codes.equalsTo] },
  };
}

/** Pairs up open/close `==` sequences left behind by the tokenizer below,
 * same two-pass shape as strikethrough's own resolver: first turn matched
 * pairs into real `highlightSequence`/`highlight`/`highlightText` tokens,
 * then demote any `==` that never found a partner back to plain text. */
const resolveAllHighlightMark: Resolver = (events, context) => {
  let index = -1;

  while (++index < events.length) {
    const openerCandidate = events[index][1] as Token & { _close?: boolean };
    if (events[index][0] === "enter" && openerCandidate.type === "highlightSequenceTemporary" && openerCandidate._close) {
      let open = index;

      while (open--) {
        const closerCandidate = events[open][1] as Token & { _open?: boolean };
        if (events[open][0] === "exit" && closerCandidate.type === "highlightSequenceTemporary" && closerCandidate._open) {
          events[index][1].type = "highlightSequence";
          events[open][1].type = "highlightSequence";

          const highlight: Token = {
            type: "highlight",
            start: { ...events[open][1].start },
            end: { ...events[index][1].end },
          };
          const text: Token = {
            type: "highlightText",
            start: { ...events[open][1].end },
            end: { ...events[index][1].start },
          };

          const nextEvents: Event[] = [
            ["enter", highlight, context],
            ["enter", events[open][1], context],
            ["exit", events[open][1], context],
            ["enter", text, context],
          ];

          const insideSpan = context.parser.constructs.insideSpan.null;
          if (insideSpan) {
            splice(nextEvents, nextEvents.length, 0, resolveAll(insideSpan, events.slice(open + 1, index), context));
          }

          splice(nextEvents, nextEvents.length, 0, [
            ["exit", text, context],
            ["enter", events[index][1], context],
            ["exit", events[index][1], context],
            ["exit", highlight, context],
          ]);

          splice(events, open - 1, index - open + 3, nextEvents);
          index = open + nextEvents.length - 2;
          break;
        }
      }
    }
  }

  index = -1;
  while (++index < events.length) {
    if (events[index][1].type === "highlightSequenceTemporary") {
      events[index][1].type = types.data;
    }
  }

  return events;
};

/** Consumes exactly two `=` characters — unlike strikethrough's `~`/`~~`,
 * `==` has only one valid length, so any run of one or three-or-more `=`
 * is rejected outright rather than needing a "which length wins"
 * resolution pass. Flanking rules (open/close eligibility based on the
 * surrounding whitespace/punctuation) mirror strikethrough's so `==`
 * behaves the same as any other attention-style delimiter — e.g. it
 * won't misfire on a lone `==` used for something else in prose (in that
 * case it's left as plain text — see `resolveAllHighlightMark`'s second
 * pass — and `mark`'s `toMarkdown` side then escapes it defensively, same
 * as an unmatched `~` already does for strikethrough in this codebase). */
function tokenizeHighlightMark(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  const previous = this.previous;
  const events = this.events;
  let size = 0;

  return start;

  function start(code: number | null): State | undefined {
    if (code !== codes.equalsTo) return nok(code);
    if (previous === codes.equalsTo && events[events.length - 1][1].type !== types.characterEscape) {
      return nok(code);
    }
    effects.enter("highlightSequenceTemporary");
    return more(code);
  }

  function more(code: number | null): State | undefined {
    const before = classifyCharacter(previous);
    if (code === codes.equalsTo) {
      if (size > 1) return nok(code);
      effects.consume(code);
      size++;
      return more;
    }
    if (size < 2) return nok(code);
    const token = effects.exit("highlightSequenceTemporary") as Token & { _open?: boolean; _close?: boolean };
    const after = classifyCharacter(code);
    token._open = !after || (after === constants.attentionSideAfter && Boolean(before));
    token._close = !before || (before === constants.attentionSideAfter && Boolean(after));
    return ok(code);
  }
}

// ── mdast-util: from/to markdown ─────────────────────────────────────────

/** `mdast-util-from-markdown` extension pairing with `highlightMark()`
 * above — turns matched `highlight` tokens into a `mark` mdast node, same
 * shape as `delete`/`strong`/`emphasis`. */
export function highlightMarkFromMarkdown(): FromMarkdownExtension {
  return {
    canContainEols: ["mark"],
    enter: { highlight: enterHighlight },
    exit: { highlight: exitHighlight },
  };
}

const enterHighlight: FromMarkdownHandle = function (this: CompileContext, token) {
  this.enter({ type: "mark", children: [] }, token);
};

const exitHighlight: FromMarkdownHandle = function (this: CompileContext, token) {
  this.exit(token);
};

/** Constructs that occur in phrasing but can't contain a `==...==` pair —
 * kept in sync with `mdast-util-gfm-strikethrough`'s own list for the
 * same construct name, since the reasoning is identical: those raw-text
 * spans must never be split up by another inline construct's markers. */
const CONSTRUCTS_WITHOUT_HIGHLIGHT: ConstructName[] = [
  "autolink",
  "destinationLiteral",
  "destinationRaw",
  "reference",
  "titleQuote",
  "titleApostrophe",
];

/** `mdast-util-to-markdown` extension — serializes a `mark` node back to
 * `==...==`. */
export function highlightMarkToMarkdown(): ToMarkdownExtension {
  return {
    unsafe: [
      {
        character: "=",
        inConstruct: "phrasing",
        notInConstruct: CONSTRUCTS_WITHOUT_HIGHLIGHT,
      },
    ],
    handlers: { mark: handleMark },
  };
}

function handleMark(...args: Parameters<ToMarkdownHandle>): string {
  const [node, , state, info] = args;
  const tracker = state.createTracker(info);
  const exit = state.enter("highlight");
  let value = tracker.move("==");
  value += state.containerPhrasing(node as Mark, {
    ...tracker.current(),
    before: value,
    after: "=",
  });
  value += tracker.move("==");
  exit();
  return value;
}
handleMark.peek = peekMark;

function peekMark(): string {
  return "=";
}
