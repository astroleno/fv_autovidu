/**
 * 视频预处理服务（videoPreprocess.js）
 *
 * 负责对标视频的探测、压缩、裁剪，确保符合 Seedance 2 模型输入要求。
 * 目标约束：≤30s 时长，≤10MB 大小，≤1080p 分辨率
 *
 * 依赖：ffmpeg-static / @ffprobe-installer/ffprobe 提供的静态二进制（通过 child_process 调用）
 * 静态二进制缺失时优雅降级（报错提示而非崩溃）
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const config = require("../config");

// 引入静态二进制文件路径
const ffmpegPath = require("ffmpeg-static");
const { path: ffprobePath } = require("@ffprobe-installer/ffprobe");

const execFileAsync = promisify(execFile);

// ============================================================
// 常量配置
// ============================================================

/** 最大时长（秒） */
const MAX_DURATION_SEC = 30;

/** 最大文件大小（MB），10MB 确保 base64 后（约 13.3MB）+ prompt 仍低于云雾 20MB 限制 */
const MAX_SIZE_MB = 10;

/** 最大分辨率（宽度） */
const MAX_WIDTH = 1080;

/** 最大分辨率（高度） */
const MAX_HEIGHT = 1920;

// ============================================================
// ffmpeg 可用性检测
// ============================================================

/**
 * 检测 ffmpeg/ffprobe 静态文件是否存在
 * @returns {Promise<boolean>}
 */
async function checkFfmpegAvailable() {
  if (fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath)) {
    return true;
  }
  console.warn("[videoPreprocess] 静态 FFmpeg/FFprobe 文件缺失");
  return false;
}

/**
 * 获取 ffmpeg 不可用时的友好错误信息
 * @returns {string}
 */
function getFfmpegUnavailableMessage() {
  return "FFmpeg/FFprobe 静态文件缺失，请运行 pnpm install 重新安装依赖";
}

// ============================================================
// 核心函数
// ============================================================

/**
 * 探测视频元数据
 *
 * 使用 ffprobe 获取视频的时长、文件大小、分辨率、编码等信息。
 *
 * @param {string} inputPath - 原始视频文件路径
 * @returns {Promise<{duration: number, size: number, width: number, height: number, codec: string}>}
 */
async function probeVideo(inputPath) {
  const available = await checkFfmpegAvailable();
  if (!available) {
    throw new Error(getFfmpegUnavailableMessage());
  }

  if (!fs.existsSync(inputPath)) {
    throw new Error(`视频文件不存在: ${inputPath}`);
  }

  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      inputPath,
    ]);

    const data = JSON.parse(stdout);

    // 获取视频流信息
    const videoStream =
      data.streams?.find((s) => s.codec_type === "video") || {};
    const format = data.format || {};

    const duration = parseFloat(format.duration || videoStream.duration || 0);
    const size = parseInt(format.size || 0, 10);
    const width = parseInt(videoStream.width || 0, 10);
    const height = parseInt(videoStream.height || 0, 10);
    const codec = videoStream.codec_name || format.format_name || "unknown";

    return {
      duration,
      size,
      width,
      height,
      codec,
    };
  } catch (err) {
    throw new Error(`视频探测失败: ${err.message}`);
  }
}

/**
 * 压缩/裁剪视频
 *
 * 目标：≤30s 时长，≤10MB 大小，≤1080p 分辨率
 * ffmpeg 参数：-c:v libx264 -crf 28 -preset fast
 *
 * @param {string} inputPath  - 原始视频路径
 * @param {string} outputPath - 输出视频路径
 * @param {Object} options   - { maxDuration: 30, maxSizeMB: 10 }
 * @returns {Promise<{outputPath: string, duration: number, size: number}>}
 */
async function compressVideo(inputPath, outputPath, options = {}) {
  const available = await checkFfmpegAvailable();
  if (!available) {
    throw new Error(getFfmpegUnavailableMessage());
  }

  const maxDuration = options.maxDuration ?? MAX_DURATION_SEC;
  const maxSizeMB = options.maxSizeMB ?? MAX_SIZE_MB;

  // 确保输出目录存在
  const outputDir = path.dirname(outputPath);
  await fsPromises.mkdir(outputDir, { recursive: true });

  // scale 表达式：限制最大 1080p，保持宽高比
  const scaleFilter = `scale='min(${MAX_WIDTH},iw)':'min(${MAX_HEIGHT},ih)':force_original_aspect_ratio=decrease`;

  // 目标 10MB：30s × 2.5Mbps ≈ 9.4MB 视频 + 64k 音频 ≈ 9.6MB
  const targetBitrateMbps = 2.5;
  const args = [
    "-i",
    inputPath,
    "-t",
    String(maxDuration),
    "-c:v",
    "libx264",
    "-b:v",
    `${targetBitrateMbps}M`,
    "-maxrate",
    `${targetBitrateMbps}M`,
    "-bufsize",
    `${targetBitrateMbps * 2}M`,
    "-preset",
    "fast",
    "-vf",
    scaleFilter,
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  ];

  try {
    await execFileAsync(ffmpegPath, args);

    const stat = await fsPromises.stat(outputPath);
    const probe = await probeVideo(outputPath);

    return {
      outputPath,
      duration: probe.duration,
      size: stat.size,
    };
  } catch (err) {
    if (fs.existsSync(outputPath)) {
      await fsPromises.unlink(outputPath).catch(() => {});
    }
    throw new Error(`视频压缩失败: ${err.message}`);
  }
}

/**
 * 完整预处理流程（探测 → 判断 short/medium/long → 按需压缩/裁剪 → 保存 reference_meta.json）
 *
 * @param {string} projectId  - 项目 ID
 * @param {string} inputPath   - 上传的原始视频路径
 * @returns {Promise<{
 *   type: 'short'|'medium'|'long',
 *   duration: number,
 *   originalDuration: number,
 *   filePath: string,
 *   compressed: boolean,
 *   trimmed: boolean,
 *   sizeMB: number,
 *   metaPath: string
 * }>}
 */
async function preprocessVideo(projectId, inputPath) {
  const available = await checkFfmpegAvailable();
  if (!available) {
    throw new Error(getFfmpegUnavailableMessage());
  }

  const projectDir = path.join(config.PROJECT_STORAGE_DIR, projectId);
  await fsPromises.mkdir(projectDir, { recursive: true });

  // 1. 探测原始视频
  const probe = await probeVideo(inputPath);
  const originalDuration = probe.duration;
  const originalSizeMB = probe.size / (1024 * 1024);
  const compressedPath = path.join(projectDir, "reference_compressed.mp4");
  const legacyOriginalPath = path.join(projectDir, "reference_original.mp4");

  // 新规则：项目目录内只保留压缩后的视频。
  if (
    path.resolve(inputPath) !== path.resolve(legacyOriginalPath) &&
    fs.existsSync(legacyOriginalPath)
  ) {
    await fsPromises.unlink(legacyOriginalPath).catch(() => {});
  }

  // 2. 判断类型并决定是否压缩/裁剪
  // short: ≤15s
  // medium: 15s < 时长 ≤ 30s
  // long: > 30s（需裁剪到 30s）
  let type = "short";
  if (originalDuration > MAX_DURATION_SEC) {
    type = "long";
  } else if (originalDuration > 15) {
    type = "medium";
  }

  const needCompress = originalSizeMB > MAX_SIZE_MB;
  const needTrim = originalDuration > MAX_DURATION_SEC;

  let outputPath = compressedPath;
  let compressed = false;
  let trimmed = false;

  if (needCompress || needTrim) {
    await compressVideo(inputPath, compressedPath, {
      maxDuration: MAX_DURATION_SEC,
      maxSizeMB: MAX_SIZE_MB,
    });
    compressed = needCompress;
    trimmed = needTrim;
  } else {
    // 无需压缩时，复制一份作为 reference_compressed（保持接口一致）
    if (path.resolve(inputPath) !== path.resolve(compressedPath)) {
      await fsPromises.copyFile(inputPath, compressedPath);
    }
  }

  const finalProbe = await probeVideo(outputPath);
  const finalStat = await fsPromises.stat(outputPath);
  const sizeMB = finalStat.size / (1024 * 1024);

  // 4. 保存 reference_meta.json
  const meta = {
    projectId,
    type,
    duration: finalProbe.duration,
    originalDuration,
    filePath: `reference_compressed.mp4`,
    compressed,
    trimmed,
    sizeMB,
    width: finalProbe.width,
    height: finalProbe.height,
    codec: finalProbe.codec,
    processedAt: new Date().toISOString(),
  };

  const metaPath = path.join(projectDir, "reference_meta.json");
  await fsPromises.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");

  console.log(
    `[videoPreprocess] 项目 ${projectId} 预处理完成: type=${type}, duration=${meta.duration}s, sizeMB=${sizeMB.toFixed(2)}`,
  );

  return {
    type,
    duration: meta.duration,
    originalDuration,
    filePath: outputPath,
    compressed,
    trimmed,
    sizeMB,
    metaPath,
  };
}

module.exports = {
  probeVideo,
  compressVideo,
  preprocessVideo,
  checkFfmpegAvailable,
  getFfmpegUnavailableMessage,
};
