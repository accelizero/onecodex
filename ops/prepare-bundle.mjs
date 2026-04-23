import * as fs from "node:fs";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const cacheRoot = path.join(projectRoot, ".cache");
const bundleRoot = path.join(projectRoot, "resources", "runtime-bundles");
const sourceDefaults = {
  repo: "https://github.com/accelizero/codexUI.git",
  branch: "dev",
};

function parseArgs() {
  const options = {
    platform: process.platform,
    arch: process.arch,
  };
  const args = process.argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--platform" && args[index + 1]) {
      options.platform = args[index + 1];
      index += 1;
      continue;
    }
    if (token === "--arch" && args[index + 1]) {
      options.arch = args[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }

  if (!["darwin", "linux", "win32"].includes(options.platform)) {
    throw new Error(`unsupported platform ${options.platform}`);
  }
  if (!["x64", "arm64"].includes(options.arch)) {
    throw new Error(`unsupported arch ${options.arch}`);
  }
  return options;
}

function log(message) {
  process.stdout.write(`[prepare-bundle] ${message}\n`);
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: "inherit",
    ...options,
  });
}

function remove(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function ensureDirectory(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function copyTree(source, target) {
  fs.cpSync(source, target, { recursive: true, force: true });
}

function slug(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function detectCodexSpec(sourcePath) {
  const explicit = process.env.ONECODEX_CODEX_PACKAGE?.trim();
  if (explicit) {
    return explicit;
  }

  const candidate = path.join(sourcePath, "node_modules", "@openai", "codex", "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
    if (typeof pkg.version === "string" && pkg.version.trim()) {
      return `@openai/codex@${pkg.version.trim()}`;
    }
  } catch {}

  return "@openai/codex";
}

function resolveCodexVersion(specifier) {
  if (!specifier.startsWith("@openai/codex@")) {
    return "*";
  }
  return specifier.slice("@openai/codex@".length) || "*";
}

function checkoutDirectory(repo, branch) {
  return path.join(cacheRoot, "source-snapshots", `${slug(repo)}-${slug(branch)}`);
}

function ensureSourceCheckout(repo, branch) {
  const targetPath = checkoutDirectory(repo, branch);
  ensureDirectory(path.dirname(targetPath));

  if (!fs.existsSync(path.join(targetPath, ".git"))) {
    remove(targetPath);
    log(`cloning ${repo}#${branch}`);
    run("git", ["clone", "--depth", "1", "--branch", branch, repo, targetPath]);
    return targetPath;
  }

  log(`refreshing ${repo}#${branch}`);
  run("git", ["fetch", "origin", branch, "--depth", "1"], { cwd: targetPath });
  run("git", ["checkout", "--force", "FETCH_HEAD"], { cwd: targetPath });
  run("git", ["clean", "-fd"], { cwd: targetPath });
  return targetPath;
}

function buildSourceTree(sourcePath) {
  log(`building source ${sourcePath}`);
  run(npmCommand(), ["install"], { cwd: sourcePath });
  run(npmCommand(), ["run", "build"], { cwd: sourcePath });
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = (currentUrl) => {
      https.get(currentUrl, (response) => {
        if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400 && response.headers.location) {
          request(response.headers.location);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`failed to download ${currentUrl}: ${String(response.statusCode)}`));
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

function extractArchive(archivePath, destination) {
  ensureDirectory(destination);
  if (archivePath.endsWith(".tar.gz")) {
    run("tar", ["-xzf", archivePath, "-C", destination]);
    return;
  }
  try {
    run("unzip", ["-q", "-o", archivePath, "-d", destination]);
  } catch {
    run("tar", ["-xf", archivePath, "-C", destination]);
  }
}

function findNodeRoot(parentPath) {
  for (const entry of fs.readdirSync(parentPath)) {
    const candidate = path.join(parentPath, entry);
    if (fs.statSync(candidate).isDirectory() && entry.startsWith("node-v")) {
      return candidate;
    }
  }
  throw new Error(`node runtime extraction failed in ${parentPath}`);
}

async function stageNodeRuntime(targetPath, target) {
  const version = process.env.ONECODEX_NODE_VERSION || process.versions.node;
  const fileName = target.platform === "win32"
    ? `node-v${version}-win-${target.arch}.zip`
    : `node-v${version}-${target.platform}-${target.arch}.tar.gz`;
  const archivePath = path.join(cacheRoot, "node-downloads", fileName);
  const destination = path.join(targetPath, "node");

  ensureDirectory(path.dirname(archivePath));
  if (!fs.existsSync(archivePath)) {
    const url = `https://nodejs.org/dist/v${version}/${fileName}`;
    log(`downloading ${url}`);
    await download(url, archivePath);
  }

  const extractPath = path.join(os.tmpdir(), `onecodex-runtime-${target.platform}-${target.arch}`);
  remove(extractPath);
  extractArchive(archivePath, extractPath);
  const nodeRoot = findNodeRoot(extractPath);
  ensureDirectory(destination);

  if (target.platform === "win32") {
    fs.copyFileSync(path.join(nodeRoot, "node.exe"), path.join(destination, "node.exe"));
    return;
  }

  fs.copyFileSync(path.join(nodeRoot, "bin", "node"), path.join(destination, "node"));
  fs.chmodSync(path.join(destination, "node"), 0o755);
}

function writeServiceManifest(sourcePath, destination, codexSpecifier) {
  const sourcePackage = JSON.parse(fs.readFileSync(path.join(sourcePath, "package.json"), "utf8"));
  const manifest = {
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
      "@openai/codex": resolveCodexVersion(codexSpecifier),
    },
  };

  fs.writeFileSync(path.join(destination, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function installServiceDependencies(servicePath, target) {
  run(npmCommand(), [
    "install",
    "--omit=dev",
    `--os=${target.platform}`,
    `--cpu=${target.arch}`,
  ], { cwd: servicePath });
}

function pruneArtifacts(rootPath, target) {
  const nodeModulesPath = path.join(rootPath, "node_modules");
  const vendorPath = path.join(nodeModulesPath, "@openai");
  if (fs.existsSync(vendorPath)) {
    const keepToken = `${target.platform}-${target.arch}`;
    for (const entry of fs.readdirSync(vendorPath)) {
      if (entry.startsWith("codex-") && entry !== "codex" && !entry.includes(keepToken)) {
        remove(path.join(vendorPath, entry));
      }
    }
  }

  const ptyPrebuilds = path.join(nodeModulesPath, "node-pty", "prebuilds");
  if (fs.existsSync(ptyPrebuilds)) {
    const keepFolder = `${target.platform}-${target.arch}`;
    for (const entry of fs.readdirSync(ptyPrebuilds)) {
      if (entry !== keepFolder) {
        remove(path.join(ptyPrebuilds, entry));
      }
    }
  }

  remove(path.join(nodeModulesPath, "node-pty", "third_party"));

  const stack = [rootPath];
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
        entry.name.endsWith(".map") ||
        entry.name.endsWith(".pdb") ||
        entry.name.endsWith(".d.ts") ||
        entry.name.endsWith(".tsbuildinfo")
      ) {
        fs.unlinkSync(fullPath);
      }
    }
  }

  remove(path.join(rootPath, "package-lock.json"));
  remove(path.join(rootPath, "npm-shrinkwrap.json"));
}

function assembleServiceBundle(sourcePath, targetPath, target) {
  const servicePath = path.join(targetPath, "service");
  const codexSpecifier = detectCodexSpec(sourcePath);

  if (!fs.existsSync(path.join(sourcePath, "dist")) || !fs.existsSync(path.join(sourcePath, "dist-cli"))) {
    throw new Error(`missing build output in ${sourcePath}`);
  }

  ensureDirectory(servicePath);
  copyTree(path.join(sourcePath, "dist"), path.join(servicePath, "dist"));
  copyTree(path.join(sourcePath, "dist-cli"), path.join(servicePath, "dist-cli"));
  writeServiceManifest(sourcePath, servicePath, codexSpecifier);
  installServiceDependencies(servicePath, target);
  pruneArtifacts(servicePath, target);
}

async function main() {
  const target = parseArgs();
  const targetKey = `${target.platform}-${target.arch}`;
  const outputPath = path.join(bundleRoot, targetKey);
  const override = process.env.ONECODEX_SOURCE_DIR?.trim();
  const sourcePath = override || ensureSourceCheckout(
    process.env.ONECODEX_SOURCE_REPO?.trim() || sourceDefaults.repo,
    process.env.ONECODEX_SOURCE_BRANCH?.trim() || sourceDefaults.branch,
  );

  remove(outputPath);
  ensureDirectory(outputPath);

  if (!override) {
    buildSourceTree(sourcePath);
  }

  await stageNodeRuntime(outputPath, target);
  assembleServiceBundle(sourcePath, outputPath, target);
  log(`bundle ready at ${outputPath}`);
}

main().catch((error) => {
  process.stderr.write(`[prepare-bundle] ${error.stack || error.message}\n`);
  process.exit(1);
});
