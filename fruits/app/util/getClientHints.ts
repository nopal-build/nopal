export type ClientHints = {
  sysColorSchemePref: string | null;
  colorSchemePref: string | null;
};

export function getClientHints(req: Request) {
  const sysColorSchemePref = req.headers.get("sec-ch-prefers-color-scheme");
  const colorSchemePref = req.headers.get("nopal-prefers-color-scheme");
  return { sysColorSchemePref, colorSchemePref };
}
