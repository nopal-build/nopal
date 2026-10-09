/**
 * `:::box{form-id="..." select-group="..." value="..."}` /
 * `::button{form-id="..." action="..."}` — Effort 2 of the "Box
 * Directive + Pricing Card UI Fix" garden seed (`garden/3-growing/
 * box-directive-pricing-card.md`): option 4's shared, page-level form
 * store ("centralized storage, not centralized building").
 *
 * This project has no jsdom/`@testing-library` click-simulation
 * infrastructure (confirmed: every existing test here either renders
 * static HTML via `renderToStaticMarkup` or inspects a registry
 * handler's returned element's own props directly, never a real,
 * live-updating DOM). `BoxDirective`/`WebsiteFormButton`'s own click
 * handlers call `useContext`, which needs a real mounted render to
 * execute at all — so the REAL update/read/payload rules were pulled
 * out into plain, zero-React functions (`OxRenderer.tsx`'s
 * `setWebsiteFormValue`/`getWebsiteFormValue`/`postWebsiteForm`)
 * specifically so they stay directly testable here, the same "zero
 * React" philosophy `oxmarkdown-core`'s own `swatchDirective.ts` uses.
 * `WebsiteFormProvider` itself is deliberately thin wiring around them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import {
  getWebsiteFormValue,
  setWebsiteFormValue,
  postWebsiteForm,
  type WebsiteFormState,
} from "../components/OxRenderer";
import { buildWebsiteDirectiveRegistry } from "../oxmarkdown/websiteDirectives";
import { BoxDirective, WebsiteFormButton } from "../oxmarkdown/websiteForms";

describe("setWebsiteFormValue/getWebsiteFormValue — the real selection-storage rule", () => {
  it("stores a value under (formId, key), readable back by the same pair", () => {
    const state = setWebsiteFormValue({}, "pricing", "plan", "self-guide");
    expect(getWebsiteFormValue(state, "pricing", "plan")).toBe("self-guide");
  });

  it("radio-style mutual exclusivity falls out for free: setting a new value for the SAME key replaces it, not adds to it", () => {
    let state: WebsiteFormState = {};
    state = setWebsiteFormValue(state, "pricing", "plan", "self-guide");
    state = setWebsiteFormValue(state, "pricing", "plan", "guided");
    expect(getWebsiteFormValue(state, "pricing", "plan")).toBe("guided");
    // Only ONE value ever lives under one (formId, key) pair -- there is
    // no second place a "still selected" self-guide could be hiding.
    expect(state.pricing).toEqual({ plan: "guided" });
  });

  it("different select-groups under the SAME form-id don't clobber each other", () => {
    let state: WebsiteFormState = {};
    state = setWebsiteFormValue(state, "pricing", "plan", "guided");
    state = setWebsiteFormValue(state, "pricing", "addon", "support");
    expect(getWebsiteFormValue(state, "pricing", "plan")).toBe("guided");
    expect(getWebsiteFormValue(state, "pricing", "addon")).toBe("support");
  });

  it("different form-ids never share state at all", () => {
    let state: WebsiteFormState = {};
    state = setWebsiteFormValue(state, "pricing", "plan", "guided");
    state = setWebsiteFormValue(state, "newsletter", "email", "a@example.com");
    expect(getWebsiteFormValue(state, "newsletter", "plan")).toBeUndefined();
  });

  it("getWebsiteFormValue on a form-id that's never been touched returns undefined, not a crash", () => {
    expect(getWebsiteFormValue({}, "nope", "plan")).toBeUndefined();
  });
});

describe("postWebsiteForm — the real payload shape", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs exactly that form's own collected values as plain JSON to the given action URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const state = setWebsiteFormValue({}, "pricing", "plan", "guided");
    await postWebsiteForm(state, "pricing", "/api/schedule-call");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/schedule-call");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ plan: "guided" });
  });

  it("a form-id with nothing stored yet posts an empty object, not undefined/a crash", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await postWebsiteForm({}, "pricing", "/api/schedule-call");

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({});
  });
});

describe(":::box{form-id=... select-group=... value=...} — registry wiring", () => {
  const registry = buildWebsiteDirectiveRegistry({ dailyLogEntries: {} });

  function resolveSwatchRole() {
    return undefined;
  }

  it("passes form-id/select-group/value straight through to BoxDirective", () => {
    const el = registry.box({
      attrs: { "form-id": "pricing", "select-group": "plan", value: "guided" },
      label: null,
      resolveSwatchRole,
    }) as ReactElement<{ formId?: string; selectGroup?: string; value?: string }>;
    expect(isValidElement(el)).toBe(true);
    expect(el.type).toBe(BoxDirective);
    expect(el.props.formId).toBe("pricing");
    expect(el.props.selectGroup).toBe("plan");
    expect(el.props.value).toBe("guided");
  });

  it("a bare :::box{} with none of the three still renders BoxDirective, just with them all undefined (plain, unselectable box)", () => {
    const el = registry.box({ attrs: {}, label: null, resolveSwatchRole }) as ReactElement<{
      formId?: string;
      selectGroup?: string;
      value?: string;
    }>;
    expect(el.props.formId).toBeUndefined();
    expect(el.props.selectGroup).toBeUndefined();
    expect(el.props.value).toBeUndefined();
  });
});

describe("::button{form-id=... action=...} — the second, mutually-exclusive mode", () => {
  const registry = buildWebsiteDirectiveRegistry({ dailyLogEntries: {} });

  function resolveSwatchRole() {
    return undefined;
  }

  it("form-id + action renders a WebsiteFormButton, not an <a>", () => {
    const el = registry.button({
      attrs: { text: "Schedule a call", "form-id": "pricing", action: "/api/schedule-call" },
      label: null,
      resolveSwatchRole,
    }) as ReactElement<{ formId: string; action: string; text: string }>;
    expect(el.type).toBe(WebsiteFormButton);
    expect(el.props.formId).toBe("pricing");
    expect(el.props.action).toBe("/api/schedule-call");
    expect(el.props.text).toBe("Schedule a call");
  });

  it("href alone still renders the original CTA <a>, unchanged", () => {
    const el = registry.button({
      attrs: { text: "Learn more", href: "/learn-more" },
      label: null,
      resolveSwatchRole,
    }) as ReactElement<{ href?: string }>;
    expect(el.type).toBe("a");
    expect(el.props.href).toBe("/learn-more");
  });

  it("form-id + action wins if href is ALSO somehow given (the decided tie-break)", () => {
    const el = registry.button({
      attrs: { text: "Both", href: "/learn-more", "form-id": "pricing", action: "/api/schedule-call" },
      label: null,
      resolveSwatchRole,
    }) as ReactElement;
    expect(el.type).toBe(WebsiteFormButton);
  });

  it("neither href nor form-id+action renders nothing, same as missing text before", () => {
    expect(registry.button({ attrs: { text: "Orphan" }, label: null, resolveSwatchRole })).toBeNull();
  });
});
