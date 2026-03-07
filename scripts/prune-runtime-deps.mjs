import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const runtimeDir = path.join(
  rootDir,
  "node_modules",
  "onnxruntime-node",
  "bin",
  "napi-v3"
);

const platform = process.platform;
const arch = process.arch;

const allowedTargets = new Set(
  [
    platform === "darwin" || platform === "linux" || platform === "win32"
      ? path.join(runtimeDir, platform, arch)
      : null,
  ].filter(Boolean)
);

const pruneTargets = [
  path.join(runtimeDir, "darwin"),
  path.join(runtimeDir, "linux"),
  path.join(runtimeDir, "win32"),
];

async function main() {
  await Promise.all(
    pruneTargets.map(async (target) => {
      if (!existsSync(target)) {
        return;
      }

      const nestedTargets = ["arm64", "x64"].map((cpu) => path.join(target, cpu));

      await Promise.all(
        nestedTargets.map(async (nestedTarget) => {
          if (!existsSync(nestedTarget) || allowedTargets.has(nestedTarget)) {
            return;
          }

          await rm(nestedTarget, { recursive: true, force: true });
        })
      );
    })
  );
}

main().catch((error) => {
  console.error("Failed to prune optional runtime dependencies:", error);
  process.exitCode = 1;
});
