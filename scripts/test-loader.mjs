import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function withTs(fileUrl) {
  if (!fileUrl.startsWith("file:")) return fileUrl;
  if (/\.(ts|js|mjs|cjs|json)$/.test(fileUrl)) return fileUrl;
  const asTs = fileUrl + ".ts";
  try {
    if (existsSync(fileURLToPath(asTs))) return asTs;
  } catch {
    return fileUrl;
  }
  return fileUrl;
}

export async function resolve(specifier, context, nextResolve) {
  let spec = specifier;
  if (spec.startsWith("@/")) {
    spec = pathToFileURL(join(root, "src", spec.slice(2))).href;
    spec = withTs(spec);
    return { url: spec, shortCircuit: true };
  }
  if (spec.startsWith(".") && context.parentURL) {
    spec = withTs(new URL(spec, context.parentURL).href);
    if (spec.endsWith(".ts")) return { url: spec, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
