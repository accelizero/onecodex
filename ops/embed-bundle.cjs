"use strict";

const fs = require("fs");
const path = require("path");
const { Arch } = require("builder-util");

function resolveArchName(arch) {
  if (typeof arch === "string") {
    return arch;
  }
  return Arch[arch];
}

function resolveTargetKey(context) {
  return process.env.ONECODEX_BUNDLE_TARGET || `${context.electronPlatformName}-${resolveArchName(context.arch)}`;
}

function copyTree(source, target) {
  fs.cpSync(source, target, { recursive: true, force: true });
}

function trimLocales(unpackedRoot) {
  const localesDir = path.join(unpackedRoot, "locales");
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

exports.default = async function embedBundle(context) {
  const targetKey = resolveTargetKey(context);
  const preparedBundle = path.join(__dirname, "..", "resources", "runtime-bundles", targetKey);
  const resourcesRoot = context.electronPlatformName === "darwin"
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(context.appOutDir, "resources");
  const engineRoot = path.join(resourcesRoot, "engine");
  const unpackedRoot = context.electronPlatformName === "darwin"
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Frameworks", `${context.packager.appInfo.productFilename} Helper.app`, "Contents", "Resources")
    : context.appOutDir;

  if (!fs.existsSync(preparedBundle)) {
    throw new Error(`bundle not prepared: ${preparedBundle}`);
  }

  fs.mkdirSync(engineRoot, { recursive: true });
  copyTree(path.join(preparedBundle, "node"), path.join(engineRoot, "node"));
  copyTree(path.join(preparedBundle, "service"), path.join(engineRoot, "service"));
  trimLocales(unpackedRoot);
  console.log(`[embed-bundle] attached ${targetKey}`);
};
