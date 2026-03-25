const path = require("path");
const config = require("../config");
const fs = require("fs");
const PRODUCT_IMAGE_REGEX = /^product\.(png|jpg|jpeg|webp)$/i;

function getImageMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  return mimeTypes[ext] || "image/png";
}

/**
 * Safely resolves a project ID to a directory within PROJECT_STORAGE_DIR (public/project).
 * Prevents path traversal attacks.
 *
 * @param {string} projectId - The project ID to resolve.
 * @param {boolean} [checkExists=false] - Whether to check if the directory exists.
 * @returns {string} The absolute path to the project directory.
 * @throws {Error} If projectId is invalid or path traversal is detected.
 */
function resolveSafeProjectDir(projectId, checkExists = false) {
  if (!projectId) {
    throw new Error("Project ID is required");
  }

  // 1. Strict format check: alphanumeric, hyphen, underscore only
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error("Invalid project ID format (alphanumeric, -, _ only)");
  }

  // 2. Path resolution and boundary check（使用 PROJECT_STORAGE_DIR = public/project）
  const projectStorageDir = path.resolve(config.PROJECT_STORAGE_DIR);
  const targetPath = path.resolve(projectStorageDir, projectId);

  const rel = path.relative(projectStorageDir, targetPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path traversal detected");
  }

  // 3. Optional existence check
  if (checkExists && !fs.existsSync(targetPath)) {
    throw new Error("Project directory does not exist");
  }

  return targetPath;
}

/**
 * 返回项目目录中最新的产品图片文件信息。
 * 若存在历史残留的多个 product.* 文件，优先选择最近修改的一张。
 *
 * @param {string} projectDir - 项目目录路径
 * @returns {{ filename: string, filePath: string, mimeType: string } | null}
 */
function findProductImageFile(projectDir) {
  if (!fs.existsSync(projectDir)) {
    return null;
  }

  const productFiles = fs
    .readdirSync(projectDir)
    .filter((filename) => PRODUCT_IMAGE_REGEX.test(filename))
    .map((filename) => {
      const filePath = path.join(projectDir, filename);
      const stat = fs.statSync(filePath);
      return { filename, filePath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.filename.localeCompare(b.filename));

  if (productFiles.length === 0) {
    return null;
  }

  const current = productFiles[0];
  return {
    filename: current.filename,
    filePath: current.filePath,
    mimeType: getImageMimeType(current.filename),
  };
}

/**
 * 删除项目目录内旧的产品图，保留指定文件。
 *
 * @param {string} projectDir - 项目目录路径
 * @param {string | null} keepFilename - 需要保留的文件名
 */
function removeStaleProductImages(projectDir, keepFilename = null) {
  if (!fs.existsSync(projectDir)) {
    return;
  }

  for (const filename of fs.readdirSync(projectDir)) {
    if (!PRODUCT_IMAGE_REGEX.test(filename) || filename === keepFilename) {
      continue;
    }
    fs.unlinkSync(path.join(projectDir, filename));
  }
}

/**
 * 删除遗留的 product_base64.json。
 *
 * @param {string} projectDir - 项目目录路径
 */
function removeLegacyProductBase64File(projectDir) {
  if (!fs.existsSync(projectDir)) {
    return;
  }

  const legacyPath = path.join(projectDir, "product_base64.json");
  if (fs.existsSync(legacyPath)) {
    fs.unlinkSync(legacyPath);
  }
}

/**
 * 从项目目录中读取产品图片并转换为 base64
 * 不再依赖 product_base64.json，直接从图片文件读取
 *
 * @param {string} projectDir - 项目目录路径
 * @returns {{ base64: string, mimeType: string } | null}
 */
function getProductImageBase64(projectDir) {
  const productImage = findProductImageFile(projectDir);
  if (!productImage) {
    return null;
  }

  const buffer = fs.readFileSync(productImage.filePath);
  return {
    base64: `data:${productImage.mimeType};base64,${buffer.toString("base64")}`,
    mimeType: productImage.mimeType,
  };
}

function isWindowsAbsolutePath(inputPath) {
  return /^[a-zA-Z]:[\\/]/.test(inputPath);
}

function isLocalAbsolutePath(inputPath) {
  return path.isAbsolute(inputPath) || isWindowsAbsolutePath(inputPath);
}

function normalizeLocalAbsolutePath(inputPath) {
  if (isWindowsAbsolutePath(inputPath)) {
    return path.win32.normalize(inputPath);
  }
  return path.normalize(inputPath);
}

function isSafeDraftTargetPrefix(normalizedPath) {
  const unixSensitivePrefixes = ["/etc", "/System", "/usr", "/bin", "/sbin"];
  const windowsSensitivePrefixes = [
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
  ];

  if (isWindowsAbsolutePath(normalizedPath)) {
    return !windowsSensitivePrefixes.some(
      (prefix) =>
        normalizedPath === prefix || normalizedPath.startsWith(`${prefix}\\`),
    );
  }

  return !unixSensitivePrefixes.some(
    (prefix) =>
      normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
  );
}

function assertPathAndParentsAreNotSymlinks(normalizedPath) {
  const trustedSymlinkPaths = new Set(["/var", "/tmp"]);
  let currentPath = normalizedPath;

  while (currentPath) {
    if (fs.existsSync(currentPath)) {
      const stat = fs.lstatSync(currentPath);
      if (stat.isSymbolicLink() && !trustedSymlinkPaths.has(currentPath)) {
        throw new Error("Draft target path cannot be a symbolic link");
      }
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }
}

function resolveSafeDraftTargetPath(targetPath) {
  if (typeof targetPath !== "string" || targetPath.trim().length === 0) {
    throw new Error("Draft target path is required");
  }

  if (targetPath.includes("\0")) {
    throw new Error("Draft target path contains invalid characters");
  }

  const trimmed = targetPath.trim();
  if (!isLocalAbsolutePath(trimmed)) {
    throw new Error("Draft target path must be absolute");
  }

  const normalized = normalizeLocalAbsolutePath(trimmed);

  if (
    normalized === path.parse(normalized).root ||
    normalized === path.win32.parse(normalized).root
  ) {
    throw new Error("Draft target path cannot be a filesystem root");
  }

  if (!isSafeDraftTargetPrefix(normalized)) {
    throw new Error("Draft target path cannot be in a system directory");
  }

  assertPathAndParentsAreNotSymlinks(normalized);

  return normalized;
}

module.exports = {
  findProductImageFile,
  removeStaleProductImages,
  removeLegacyProductBase64File,
  resolveSafeProjectDir,
  getProductImageBase64,
  resolveSafeDraftTargetPath,
};
