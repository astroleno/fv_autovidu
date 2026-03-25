const path = require("path");
const config = require("../config");

function normalizeAssetPathSlashes(input) {
  return String(input || "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^(?:\.\/)+/, "");
}

function isWindowsAbsolutePath(inputPath) {
  return /^[A-Za-z]:[\\/]/.test(String(inputPath || ""));
}

function isRemoteAssetPath(inputPath) {
  const value = String(inputPath || "");
  if (isWindowsAbsolutePath(value)) {
    return false;
  }
  return /^[A-Za-z][A-Za-z\d+.-]*:/.test(value);
}

function buildAssetRootMappings() {
  const publicDir = config.PUBLIC_DIR || path.join(config.ROOT_DIR, "public");
  const mappings = [
    {
      rootDir: path.resolve(config.PROJECT_STORAGE_DIR),
      urlPrefix: "public/project",
    },
    {
      rootDir: path.resolve(publicDir),
      urlPrefix: "public",
    },
    {
      rootDir: path.resolve(
        config.ROOT_DIR,
        "server/data/canonical-templates/assets",
      ),
      urlPrefix: "server/data/canonical-templates/assets",
    },
    {
      rootDir: path.resolve(config.ROOT_DIR, "server/data/global-template-assets"),
      urlPrefix: "server/data/global-template-assets",
    },
  ];

  return mappings
    .filter((entry) => entry.rootDir && entry.urlPrefix)
    .sort((a, b) => b.rootDir.length - a.rootDir.length);
}

const ASSET_ROOT_MAPPINGS = buildAssetRootMappings();
const ALLOWED_ASSET_ROOTS = ASSET_ROOT_MAPPINGS.map((entry) => entry.rootDir);

function resolveAbsolutePathMapping(absolutePath) {
  return ASSET_ROOT_MAPPINGS.find((entry) => {
    const relative = path.relative(entry.rootDir, absolutePath);
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  });
}

function resolveUrlPathMapping(assetPath) {
  const normalized = normalizeAssetPathSlashes(assetPath);
  return ASSET_ROOT_MAPPINGS.find(
    (entry) =>
      normalized === entry.urlPrefix ||
      normalized.startsWith(`${entry.urlPrefix}/`),
  );
}

function splitAssetUrlPath(assetPath) {
  const normalized = normalizeAssetPathSlashes(assetPath);
  const mapping = resolveUrlPathMapping(normalized);
  if (!mapping) {
    return null;
  }

  const relativePath = normalized
    .slice(mapping.urlPrefix.length)
    .replace(/^\/+/, "");

  return {
    mapping,
    relativePath,
  };
}

function decodeAssetPath(rawPath) {
  if (!rawPath || typeof rawPath !== "string") {
    throw new Error("asset path 不能为空");
  }

  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    throw new Error("asset path 编码不合法");
  }

  const normalized = decoded.replace(/\\/g, "/");
  if (!normalized) {
    throw new Error("asset path 不能为空");
  }

  return normalized;
}

function isInsideAllowedRoots(absolutePath) {
  return Boolean(resolveAbsolutePathMapping(absolutePath));
}

function resolveAssetPath(rawPath) {
  const decodedPath = decodeAssetPath(rawPath);
  if (
    path.isAbsolute(decodedPath) ||
    isWindowsAbsolutePath(decodedPath) ||
    decodedPath.startsWith("/")
  ) {
    throw new Error("asset path 必须为项目内相对路径");
  }

  const resolved = splitAssetUrlPath(decodedPath);
  if (!resolved) {
    throw new Error("asset path 超出允许的目录范围");
  }

  const absolutePath = resolved.relativePath
    ? path.resolve(resolved.mapping.rootDir, resolved.relativePath)
    : resolved.mapping.rootDir;
  if (!isInsideAllowedRoots(absolutePath)) {
    throw new Error("asset path 超出允许的目录范围");
  }

  return absolutePath;
}

/**
 * 将仓库根目录下的绝对路径转为「可写入 manifest / 拼到 /api/assets/ 前」的相对路径字符串。
 *
 * Windows 上 path.relative 会产出反斜杠，直接进 JSON 会导致前端 URL 非法、图片裂图；
 * 此处统一转为正斜杠，与 decodeAssetPath 的请求侧规范化一致。
 *
 * 若应用根与文件不在同一盘符（path.relative 得到绝对路径），则抛错，避免写入无法被
 * `/api/assets` 解析的 manifest 字段；部署上应同盘同根，见 docs/windows-asset-preview-reliability。
 *
 * @param {string} absolutePath - 磁盘上的绝对路径（应落在项目根下）
 * @returns {string} 相对 ROOT_DIR 的路径，仅含 /
 * @throws {Error} 跨盘或无法相对化时
 */
function toAssetUrlPath(absolutePath) {
  try {
    if (!absolutePath || typeof absolutePath !== "string") {
      throw new Error("toAssetUrlPath: absolutePath 不能为空");
    }
    const resolved = path.resolve(absolutePath);
    const mapping = resolveAbsolutePathMapping(resolved);
    if (!mapping) {
      throw new Error(
        "toAssetUrlPath: 无法将路径转为受支持的资产路径（常见原因：应用与数据目录布局不符合预期）。请确保 PUBLIC_DIR/PROJECT_STORAGE_DIR 与模板资产目录使用受支持的资源根，参见 docs/windows-asset-path-root-mapping.md",
      );
    }

    const rel = path.relative(mapping.rootDir, resolved);
    const normalizedRel = normalizeAssetPathSlashes(rel);
    return normalizedRel
      ? `${mapping.urlPrefix}/${normalizedRel}`
      : mapping.urlPrefix;
  } catch (err) {
    console.error("[assetPathResolver] toAssetUrlPath 失败:", err.message, {
      absolutePath,
    });
    throw err;
  }
}

function normalizeStoredAssetPath(rawPath) {
  if (typeof rawPath !== "string") {
    return rawPath;
  }

  const trimmed = rawPath.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (
    isRemoteAssetPath(trimmed) ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:")
  ) {
    return trimmed;
  }

  if (trimmed.startsWith("/api/assets/")) {
    return normalizeStoredAssetPath(trimmed.slice("/api/assets/".length));
  }

  if (trimmed.startsWith("/api/")) {
    return trimmed;
  }

  const normalized = normalizeAssetPathSlashes(trimmed);
  const logical = splitAssetUrlPath(normalized);
  if (logical) {
    return logical.relativePath
      ? `${logical.mapping.urlPrefix}/${logical.relativePath}`
      : logical.mapping.urlPrefix;
  }

  const shouldResolveRelativeToRoot =
    normalized.startsWith("../") || normalized.startsWith("./");
  const looksAbsolute =
    path.isAbsolute(trimmed) || isWindowsAbsolutePath(trimmed);

  if (looksAbsolute || shouldResolveRelativeToRoot) {
    try {
      const absolutePath = looksAbsolute
        ? path.resolve(trimmed)
        : path.resolve(config.ROOT_DIR, normalized);
      return toAssetUrlPath(absolutePath);
    } catch {
      return normalized;
    }
  }

  try {
    return toAssetUrlPath(path.resolve(config.ROOT_DIR, normalized));
  } catch {
    return normalized;
  }
}

module.exports = {
  ASSET_ROOT_MAPPINGS,
  ALLOWED_ASSET_ROOTS,
  decodeAssetPath,
  resolveAssetPath,
  isInsideAllowedRoots,
  normalizeStoredAssetPath,
  toAssetUrlPath,
};
