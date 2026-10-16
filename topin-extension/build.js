// Bundles popup.js and runner.js (both import the firebase SDK) into single
// browser-loadable ES module files under dist/. content-topin.js needs no
// bundling — it has zero imports — and is loaded directly from src/ per
// manifest.json.
import { build } from "esbuild";

await build({
  entryPoints: ["src/popup.js", "src/runner.js"],
  bundle: true,
  format: "esm",
  outdir: "dist",
  target: "chrome110",
});

console.log("Built dist/popup.js and dist/runner.js");
