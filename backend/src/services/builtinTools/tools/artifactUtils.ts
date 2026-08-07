import path from "node:path";

export function resolveSandboxedPath(allowedConvDir: string, ...subpaths: string[]): string {
  const targetPath = path.resolve(allowedConvDir, ...subpaths);
  const relative = path.relative(allowedConvDir, targetPath);
  const isSafe = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (!isSafe) {
    throw new Error("Security Error: Path traversal attempt detected.");
  }
  return targetPath;
}
