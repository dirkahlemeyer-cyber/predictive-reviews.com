import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(root, "public");
if (output !== path.join(root, "public")) throw new Error("Invalid output path");

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "assets"), { recursive: true });

for (const name of ["index.html", "robots.txt", "sitemap.xml"]) {
  await cp(path.join(root, name), path.join(output, name));
}
for (const name of ["datenschutz", "faq", "impressum"]) {
  await cp(path.join(root, name), path.join(output, name), { recursive: true });
}
await cp(path.join(root, "assets", "site.css"), path.join(output, "assets", "site.css"));

await build({
  entryPoints: [path.join(root, "assets", "voice-agent.js")],
  outfile: path.join(output, "assets", "voice-agent.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});
