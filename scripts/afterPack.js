"use strict";

const fs = require("fs");
const path = require("path");
const { Arch } = require("builder-util");

function resolveArchName(arch) {
  if (typeof arch === "string") {
    return arch;
  }
  const resolved = Arch[arch];
  if (typeof resolved !== "string") {
    throw new Error(`unknown arch: ${String(arch)}`);
  }
  return resolved;
}

function resolveTargetId(context) {
  return process.env.ONECLAW_TARGET || `${context.electronPlatformName}-${resolveArchName(context.arch)}`;
}

function copyDirSync(source, target) {
  fs.cpSync(source, target, { recursive: true, force: true });
}

function pruneLocales(unpackedAppDir) {
  const localesDir = path.join(unpackedAppDir, "locales");
  if (!fs.existsSync(localesDir)) {
    return;
  }

  const keep = new Set(["en-US.pak", "zh-CN.pak"]);
  for (const entry of fs.readdirSync(localesDir)) {
    if (!keep.has(entry)) {
      fs.rmSync(path.join(localesDir, entry), { recursive: true, force: true });
    }
  }
}

exports.default = async function afterPack(context) {
  const targetId = resolveTargetId(context);
  const sourceBase = path.join(__dirname, "..", "resources", "targets", targetId);
  const unpackedAppDir = context.electronPlatformName === "darwin"
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : context.appOutDir;
  const resourcesDir = context.electronPlatformName === "darwin"
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(context.appOutDir, "resources");
  const targetBase = path.join(resourcesDir, "resources");

  if (!fs.existsSync(sourceBase)) {
    throw new Error(`missing packaged resources: ${sourceBase}`);
  }

  fs.mkdirSync(targetBase, { recursive: true });
  copyDirSync(path.join(sourceBase, "runtime"), path.join(targetBase, "runtime"));
  copyDirSync(path.join(sourceBase, "codexapp"), path.join(targetBase, "codexapp"));
  pruneLocales(unpackedAppDir);
  console.log(`[afterPack] injected resources for ${targetId}`);
};
