"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TARGETS_ROOT = path.join(ROOT, "resources", "targets");
const CACHE_ROOT = path.join(ROOT, ".cache");
const DEFAULT_CODEXAPP_REPO = "https://github.com/accelizero/codexUI.git";
const DEFAULT_CODEXAPP_BRANCH = "dev";

function resolveCodexPackageSpec(sourceRoot) {
  const explicit = process.env.ONECLAW_CODEX_PACKAGE?.trim();
  if (explicit) {
    return explicit;
  }

  const candidates = [
    path.join(sourceRoot, "node_modules", "@openai", "codex", "package.json"),
    path.join(ROOT, "resources", "targets", `${process.platform}-${process.arch}`, "codexapp", "node_modules", "@openai", "codex", "package.json"),
  ];

  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (typeof pkg?.version === "string" && pkg.version.trim()) {
        return `@openai/codex@${pkg.version.trim()}`;
      }
    } catch {}
  }

  return "@openai/codex";
}

function toCodexDependencySpec(codexPackageSpec) {
  if (codexPackageSpec === "@openai/codex") {
    return "*";
  }
  if (codexPackageSpec.startsWith("@openai/codex@")) {
    return codexPackageSpec.slice("@openai/codex@".length) || "*";
  }
  return codexPackageSpec;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const options = {
    platform: process.platform,
    arch: process.arch,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--platform" && argv[index + 1]) {
      options.platform = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--arch" && argv[index + 1]) {
      options.arch = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!["darwin", "win32", "linux"].includes(options.platform)) {
    throw new Error(`unsupported platform: ${options.platform}`);
  }
  if (!["arm64", "x64"].includes(options.arch)) {
    throw new Error(`unsupported arch: ${options.arch}`);
  }
  return options;
}

function log(message) {
  process.stdout.write(`[package-resources] ${message}\n`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function rmDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function copyDirSync(source, target) {
  fs.cpSync(source, target, { recursive: true, force: true });
}

function removePath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function sanitizeRepoName(repoUrl) {
  return repoUrl.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function resolveCachedCodexAppRoot(repoUrl, branch) {
  return path.join(CACHE_ROOT, "codexui", `${sanitizeRepoName(repoUrl)}-${branch}`);
}

function execLogged(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: "inherit",
    ...options,
  });
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = (nextUrl) => {
      https.get(nextUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          request(response.headers.location);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`download failed: ${response.statusCode} ${nextUrl}`));
          return;
        }

        const file = fs.createWriteStream(destination);
        response.pipe(file);
        file.on("finish", () => {
          file.close(resolve);
        });
        file.on("error", reject);
      }).on("error", reject);
    };
    request(url);
  });
}

function findExtractedRoot(parentDir) {
  const names = fs.readdirSync(parentDir);
  for (const name of names) {
    const fullPath = path.join(parentDir, name);
    if (fs.statSync(fullPath).isDirectory() && name.startsWith("node-v")) {
      return fullPath;
    }
  }
  throw new Error(`failed to locate extracted runtime in ${parentDir}`);
}

function extractArchive(archivePath, destination) {
  ensureDir(destination);
  if (archivePath.endsWith(".tar.gz")) {
    execFileSync("tar", ["-xzf", archivePath, "-C", destination], { stdio: "inherit" });
    return;
  }

  try {
    execFileSync("unzip", ["-q", "-o", archivePath, "-d", destination], { stdio: "inherit" });
  } catch {
    execFileSync("tar", ["-xf", archivePath, "-C", destination], { stdio: "inherit" });
  }
}

async function prepareNodeRuntime(options, runtimeDir) {
  const version = process.env.ONECLAW_NODE_VERSION || process.versions.node;
  const archiveName = options.platform === "win32"
    ? `node-v${version}-win-${options.arch}.zip`
    : `node-v${version}-${options.platform}-${options.arch}.tar.gz`;
  const cacheDir = path.join(ROOT, ".cache", "node");
  const archivePath = path.join(cacheDir, archiveName);
  ensureDir(cacheDir);

  if (!fs.existsSync(archivePath)) {
    const url = `https://nodejs.org/dist/v${version}/${archiveName}`;
    log(`downloading ${url}`);
    await download(url, archivePath);
  }

  const extractDir = path.join(os.tmpdir(), `onecodex-runtime-${options.platform}-${options.arch}`);
  rmDir(extractDir);
  extractArchive(archivePath, extractDir);
  const extractedRoot = findExtractedRoot(extractDir);

  ensureDir(runtimeDir);
  if (options.platform === "win32") {
    fs.copyFileSync(path.join(extractedRoot, "node.exe"), path.join(runtimeDir, "node.exe"));
  } else {
    fs.copyFileSync(path.join(extractedRoot, "bin", "node"), path.join(runtimeDir, "node"));
    fs.chmodSync(path.join(runtimeDir, "node"), 0o755);
  }
}

function ensureCodexAppSource(repoUrl, branch) {
  const cachedRoot = resolveCachedCodexAppRoot(repoUrl, branch);
  ensureDir(path.dirname(cachedRoot));

  if (!fs.existsSync(path.join(cachedRoot, ".git"))) {
    removePath(cachedRoot);
    log(`cloning ${repoUrl}#${branch}`);
    execLogged("git", ["clone", "--depth", "1", "--branch", branch, repoUrl, cachedRoot]);
  } else {
    log(`updating ${repoUrl}#${branch}`);
    execLogged("git", ["fetch", "origin", branch, "--depth", "1"], { cwd: cachedRoot });
    execLogged("git", ["checkout", "-f", "FETCH_HEAD"], { cwd: cachedRoot });
    execLogged("git", ["clean", "-fd"], { cwd: cachedRoot });
  }

  return cachedRoot;
}

function buildCodexAppSource(sourceRoot) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  log(`building codexapp from ${sourceRoot}`);
  execLogged(npmCommand, ["install"], { cwd: sourceRoot });
  execLogged(npmCommand, ["run", "build"], { cwd: sourceRoot });
}

function createCodexAppManifest(sourceRoot, targetRoot, codexPackageSpec) {
  const sourcePackage = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
  const nextPackage = {
    name: sourcePackage.name,
    version: sourcePackage.version,
    type: sourcePackage.type,
    bin: sourcePackage.bin,
    license: sourcePackage.license,
    author: sourcePackage.author,
    repository: sourcePackage.repository,
    homepage: sourcePackage.homepage,
    bugs: sourcePackage.bugs,
    engines: sourcePackage.engines,
    dependencies: {
      ...(sourcePackage.dependencies || {}),
      "@openai/codex": toCodexDependencySpec(codexPackageSpec),
    },
  };

  fs.writeFileSync(
    path.join(targetRoot, "package.json"),
    `${JSON.stringify(nextPackage, null, 2)}\n`,
    "utf8",
  );
}

function copyCodexAppBuild(sourceRoot, targetRoot) {
  const distDir = path.join(sourceRoot, "dist");
  const cliDir = path.join(sourceRoot, "dist-cli");

  if (!fs.existsSync(distDir) || !fs.existsSync(cliDir)) {
    throw new Error(`codexapp build output missing in ${sourceRoot}; build the codexapp source before packaging`);
  }

  ensureDir(targetRoot);
  copyDirSync(distDir, path.join(targetRoot, "dist"));
  copyDirSync(cliDir, path.join(targetRoot, "dist-cli"));
}

function installCodexAppDependencies(targetRoot, options) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(npmCommand, [
    "install",
    "--omit=dev",
    `--os=${options.platform}`,
    `--cpu=${options.arch}`,
  ], {
    cwd: targetRoot,
    stdio: "inherit",
  });
}

function pruneCodexPackages(nodeModulesRoot, options) {
  const openAiRoot = path.join(nodeModulesRoot, "@openai");
  if (!fs.existsSync(openAiRoot)) {
    return;
  }

  const keepTag = `${options.platform}-${options.arch}`;
  for (const entry of fs.readdirSync(openAiRoot)) {
    if (!entry.startsWith("codex-")) {
      continue;
    }
    if (entry === "codex") {
      continue;
    }
    if (!entry.includes(keepTag)) {
      removePath(path.join(openAiRoot, entry));
    }
  }
}

function pruneNodePty(nodeModulesRoot, options) {
  const prebuildsRoot = path.join(nodeModulesRoot, "node-pty", "prebuilds");
  if (!fs.existsSync(prebuildsRoot)) {
    return;
  }

  const keepDir = `${options.platform}-${options.arch}`;
  for (const entry of fs.readdirSync(prebuildsRoot)) {
    if (entry !== keepDir) {
      removePath(path.join(prebuildsRoot, entry));
    }
  }
}

function pruneDebugArtifacts(rootDir) {
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (
        entry.name.endsWith(".map")
        || entry.name.endsWith(".pdb")
        || entry.name.endsWith(".d.ts")
        || entry.name.endsWith(".tsbuildinfo")
      ) {
        fs.unlinkSync(fullPath);
      }
    }
  }
}

function prunePackageLocks(rootDir) {
  for (const filename of ["package-lock.json", "npm-shrinkwrap.json"]) {
    removePath(path.join(rootDir, filename));
  }
}

function pruneCodexAppRuntime(targetRoot, options) {
  const nodeModulesRoot = path.join(targetRoot, "node_modules");
  pruneCodexPackages(nodeModulesRoot, options);
  pruneNodePty(nodeModulesRoot, options);
  removePath(path.join(nodeModulesRoot, "node-pty", "third_party", "conpty", "1.23.251008001", "win10-arm64"));
  pruneDebugArtifacts(targetRoot);
  prunePackageLocks(targetRoot);
}

async function main() {
  const options = parseArgs();
  const targetId = `${options.platform}-${options.arch}`;
  const targetBase = path.join(TARGETS_ROOT, targetId);
  const runtimeDir = path.join(targetBase, "runtime");
  const codexappDir = path.join(targetBase, "codexapp");
  const sourceOverride = process.env.ONECLAW_CODEXAPP_SOURCE?.trim();
  const sourceRoot = sourceOverride || ensureCodexAppSource(
    process.env.ONECODEX_CODEXAPP_REPO?.trim() || DEFAULT_CODEXAPP_REPO,
    process.env.ONECODEX_CODEXAPP_BRANCH?.trim() || DEFAULT_CODEXAPP_BRANCH,
  );
  const codexPackageSpec = resolveCodexPackageSpec(sourceRoot);

  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`codexapp source not found: ${sourceRoot}`);
  }

  log(`preparing ${targetId}`);
  rmDir(targetBase);
  ensureDir(targetBase);

  if (!sourceOverride) {
    buildCodexAppSource(sourceRoot);
  }
  await prepareNodeRuntime(options, runtimeDir);
  copyCodexAppBuild(sourceRoot, codexappDir);
  createCodexAppManifest(sourceRoot, codexappDir, codexPackageSpec);
  installCodexAppDependencies(codexappDir, options);
  pruneCodexAppRuntime(codexappDir, options);
  log(`ready: ${targetBase}`);
}

main().catch((error) => {
  process.stderr.write(`[package-resources] ${error.stack || error.message}\n`);
  process.exit(1);
});
