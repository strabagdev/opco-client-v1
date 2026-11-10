import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Local, parser-blocking script respects script-src 'self'; no inline JS or network preference. */
export async function prepareThemeAssets(repoRoot, distRoot, html) {
  const source = await readFile(join(repoRoot, "src/theme/tokens.ts"), "utf8");
  const palettes = JSON.parse(source.match(/export const themes = (\{[\s\S]*?\}) as const;/)[1]);
  const declarations = p => Object.entries(p).map(([role, value]) => `--opco-${role}:${value}`).join(";");
  const css = `:root{${declarations(palettes.light)};color-scheme:light}:root[data-opco-theme="dark"]{${declarations(palettes.dark)};color-scheme:dark}html,body,#root{background:var(--opco-canvas);color:var(--opco-text)}input,select,textarea{accent-color:var(--opco-primary)}input::placeholder,textarea::placeholder{color:var(--opco-textQuiet);opacity:1}`;
  const bootstrap = `window.__opcoThemeCanvases=${JSON.stringify({ light: palettes.light.canvas, dark: palettes.dark.canvas })};\n` + await readFile(join(repoRoot, "public/theme-controller.js"), "utf8");
  const name = `theme-init-${createHash("sha256").update(css).update(bootstrap).digest("hex").slice(0, 16)}.js`;
  await writeFile(join(distRoot, name), bootstrap);
  return html.replace("</head>", `<style id="opco-theme">${css}</style><script src="/${name}"></script></head>`);
}
