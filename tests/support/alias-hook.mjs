/**
 * The smallest possible module resolver for the test run.
 *
 * Two jobs, and nothing else:
 *
 *   1. `@/x`        → `<repo>/x`, the path alias tsconfig.json and Next.js
 *                     understand and Node does not.
 *   2. `./x`        → `./x.ts`, because the source is TypeScript and written
 *                     extensionless, the way the rest of the codebase is.
 *
 * Deliberately hand-rolled rather than pulled from a package: it is thirty
 * lines, and every dependency added to this repository is one more thing that
 * can end up in a customer-facing build.
 */
const ROOT = new URL("../../", import.meta.url).href;

const SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

async function tryAll(base, context, nextResolve) {
  let lastError;
  for (const suffix of SUFFIXES) {
    try {
      return await nextResolve(base + suffix, context);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return tryAll(ROOT + specifier.slice(2), context, nextResolve);
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    try {
      return await nextResolve(specifier, context);
    } catch {
      return tryAll(specifier, context, nextResolve);
    }
  }

  return nextResolve(specifier, context);
}
