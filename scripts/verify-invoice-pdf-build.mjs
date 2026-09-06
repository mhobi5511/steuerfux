import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromScript = createRequire(import.meta.url);
const tracePath = path.join(
  projectRoot,
  ".next",
  "server",
  "app",
  "api",
  "invoices",
  "[id]",
  "pdf",
  "route.js.nft.json"
);

assert.ok(existsSync(tracePath), `Invoice PDF route trace not found: ${tracePath}`);

const trace = JSON.parse(readFileSync(tracePath, "utf8"));
const normalizedTraceFiles = trace.files.map((file) => file.replaceAll("\\", "/"));
const standardFontFiles = normalizedTraceFiles.filter((file) =>
  file.includes("/node_modules/pdfkit/js/standard-fonts/")
);
const requiredFontFiles = [
  "Helvetica.cjs",
  "Helvetica.mjs",
  "HelveticaBold.cjs",
  "HelveticaBold.mjs"
];

for (const [subpath, filename] of [
  ["pdfkit/standard-fonts/Helvetica", "Helvetica.cjs"],
  ["pdfkit/standard-fonts/HelveticaBold", "HelveticaBold.cjs"]
]) {
  const resolvedFile = requireFromScript.resolve(subpath);
  assert.equal(path.basename(resolvedFile), filename);
  assert.ok(existsSync(resolvedFile), `PDFKit export does not resolve on disk: ${subpath}`);
}

for (const filename of requiredFontFiles) {
  const tracedFile = trace.files.find((file) =>
    file.replaceAll("\\", "/").endsWith(`/node_modules/pdfkit/js/standard-fonts/${filename}`)
  );
  assert.ok(tracedFile, `PDFKit standard font is missing from the route trace: ${filename}`);
  assert.ok(
    existsSync(path.resolve(path.dirname(tracePath), tracedFile)),
    `Traced PDFKit standard font does not exist on disk: ${filename}`
  );
}

assert.ok(
  standardFontFiles.length >= requiredFontFiles.length,
  "The invoice PDF route trace does not contain the PDFKit standard-font directory."
);

for (const filename of ["node_modules/react/index.js", "node_modules/react/package.json"]) {
  assert.ok(
    normalizedTraceFiles.some((file) => file.endsWith(`/${filename}`)),
    `The external React runtime is missing from the invoice PDF route trace: ${filename}`
  );
}

const routeBundlePath = tracePath.replace(/\.nft\.json$/, "");
const routeBundle = readFileSync(routeBundlePath, "utf8");
const runtimeMarkerIndex = routeBundle.indexOf("invoice-pdf-runtime-probe");
const renderMarkerIndex = routeBundle.indexOf("renderToBuffer starting", runtimeMarkerIndex);
const rendererModuleStart = routeBundle.lastIndexOf(":(a,b,c)=>", runtimeMarkerIndex);
assert.ok(runtimeMarkerIndex >= 0, "The PDF React runtime assertion is missing from the route bundle.");
assert.ok(renderMarkerIndex > runtimeMarkerIndex, "The PDF renderer is missing from the route bundle.");
assert.ok(rendererModuleStart >= 0, "The bundled PDF renderer module could not be identified.");

const bundledRenderer = routeBundle.slice(rendererModuleStart, renderMarkerIndex);
assert.ok(
  bundledRenderer.includes("createRequire") && bundledRenderer.includes("createElement"),
  "The PDF renderer is not using the external React element factory."
);
assert.ok(
  !bundledRenderer.includes("ReactJsxRuntime") && !bundledRenderer.includes(".jsx"),
  "The PDF renderer was compiled with Next.js's incompatible RSC JSX runtime."
);

console.info(
  `[invoice-pdf] verified the external React element factory and ${standardFontFiles.length} traced PDFKit standard-font assets.`
);
