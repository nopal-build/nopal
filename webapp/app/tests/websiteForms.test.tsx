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
import { renderToStaticMarkup } from "react-dom/server";
import {
  getWebsiteFormValue,
  setWebsiteFormValue,
  postWebsiteForm,
  WebsiteFormContext,
  type WebsiteFormApi,
  type WebsiteFormState,
} from "../components/OxRenderer";
import { buildWebsiteDirectiveRegistry } from "../oxmarkdown/websiteDirectives";
import { BoxDirective, WebsiteFormButton, WebsiteFormLink } from "../oxmarkdown/websiteForms";

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

describe("::button{href=... form-id=... select-group=...} — the third, mutually-exclusive mode", () => {
  const registry = buildWebsiteDirectiveRegistry({ dailyLogEntries: {} });

  function resolveSwatchRole() {
    return undefined;
  }

  it("href + form-id + select-group renders a WebsiteFormLink, not a plain <a>", () => {
    const el = registry.button({
      attrs: {
        text: "Meet with a Guide",
        href: "https://calendly.com/build-for-good/30min",
        "form-id": "pricing",
        "select-group": "plan",
        param: "utm_content",
      },
      label: null,
      resolveSwatchRole,
    }) as ReactElement<{ href: string; formId: string; selectGroup: string; param: string; text: string }>;
    expect(el.type).toBe(WebsiteFormLink);
    expect(el.props.href).toBe("https://calendly.com/build-for-good/30min");
    expect(el.props.formId).toBe("pricing");
    expect(el.props.selectGroup).toBe("plan");
    expect(el.props.param).toBe("utm_content");
    expect(el.props.text).toBe("Meet with a Guide");
  });

  it("param defaults to \"value\" when omitted, same degrade-gracefully convention as everything else here", () => {
    const el = registry.button({
      attrs: { text: "Meet with a Guide", href: "/book", "form-id": "pricing", "select-group": "plan" },
      label: null,
      resolveSwatchRole,
    }) as ReactElement<{ param: string }>;
    expect(el.props.param).toBe("value");
  });

  it("form-id + action still wins over form-id + select-group + href, same tie-break as before (mode 2 checked first)", () => {
    const el = registry.button({
      attrs: {
        text: "Both",
        href: "/book",
        "form-id": "pricing",
        "select-group": "plan",
        action: "/api/schedule-call",
      },
      label: null,
      resolveSwatchRole,
    }) as ReactElement;
    expect(el.type).toBe(WebsiteFormButton);
  });

  it("form-id without select-group falls through to the plain <a> (mode 1), not mode 3", () => {
    const el = registry.button({
      attrs: { text: "Meet with a Guide", href: "/book", "form-id": "pricing" },
      label: null,
      resolveSwatchRole,
    }) as ReactElement<{ href?: string }>;
    expect(el.type).toBe("a");
    expect(el.props.href).toBe("/book");
  });
});

describe("WebsiteFormLink — the actual href-computation rule", () => {
  function renderWithSelection(selected: string | undefined, props: Partial<Parameters<typeof WebsiteFormLink>[0]> = {}) {
    const api: WebsiteFormApi = {
      getValue: () => selected,
      setValue: () => {},
      submit: async () => {},
    };
    return renderToStaticMarkup(
      <WebsiteFormContext.Provider value={api}>
        <WebsiteFormLink
          text="Meet with a Guide"
          className="btn"
          href="https://calendly.com/build-for-good/30min"
          formId="pricing"
          selectGroup="plan"
          param="utm_content"
          {...props}
        />
      </WebsiteFormContext.Provider>,
    );
  }

  it("nothing selected yet — falls back to the plain href, untouched (the resolved fallback decision)", () => {
    const html = renderWithSelection(undefined);
    expect(html).toContain('href="https://calendly.com/build-for-good/30min"');
  });

  it("a value is selected — appends it as the given query param", () => {
    const html = renderWithSelection("self-guide");
    expect(html).toContain('href="https://calendly.com/build-for-good/30min?utm_content=self-guide"');
  });

  it("uses & instead of ? when the base href already has a query string", () => {
    const html = renderWithSelection("self-guide", { href: "https://calendly.com/build-for-good/30min?a=1" });
    expect(html).toContain('href="https://calendly.com/build-for-good/30min?a=1&amp;utm_content=self-guide"');
  });

  it("URL-encodes a selected value with special characters", () => {
    const html = renderWithSelection("self guide & more");
    expect(html).toContain("utm_content=self%20guide%20%26%20more");
  });

  it("no Provider mounted (undefined context) still renders the plain href, not a crash", () => {
    const html = renderToStaticMarkup(
      <WebsiteFormLink
        text="Meet with a Guide"
        className="btn"
        href="https://calendly.com/build-for-good/30min"
        formId="pricing"
        selectGroup="plan"
        param="utm_content"
      />,
    );
    expect(html).toContain('href="https://calendly.com/build-for-good/30min"');
  });
});
