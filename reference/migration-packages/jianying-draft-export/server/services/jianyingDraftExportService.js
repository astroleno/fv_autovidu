const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const { randomUUID, createHash } = require("crypto");
const archiver = require("archiver");
const config = require("../config");
const { probeVideo } = require("./videoPreprocess");
const {
  resolveSafeDraftTargetPath,
  resolveSafeProjectDir,
  findProductImageFile,
} = require("../utils/pathSafe");
const { resolveAssetPath } = require("../utils/assetPathResolver");
const variantDAO = require("../db/variantDAO");
const {
  buildSemanticDraftName,
  buildDraftId: buildSemanticDraftId,
} = require("../utils/draftNaming");

const EXPORT_MODE = "jianying_timeline_from_raw";
const DRAFT_PLACEHOLDER =
  "##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##";

function sortShotsForExport(outputs = []) {
  return [...outputs].sort((a, b) => {
    const startDelta =
      (a.timelineWindow?.timelineStartSec ?? Number.MAX_SAFE_INTEGER) -
      (b.timelineWindow?.timelineStartSec ?? Number.MAX_SAFE_INTEGER);
    if (startDelta !== 0) {
      return startDelta;
    }
    return String(a.shotId || "").localeCompare(String(b.shotId || ""));
  });
}

function resolveShotDurationSec(output) {
  if (typeof output?.timelineWindow?.targetDurationSec === "number") {
    return Math.max(output.timelineWindow.targetDurationSec, 0);
  }
  if (
    typeof output?.usableDurationSec === "number" &&
    output.usableDurationSec > 0
  ) {
    return output.usableDurationSec;
  }
  if (
    typeof output?.generatedDurationSec === "number" &&
    output.generatedDurationSec > 0
  ) {
    return output.generatedDurationSec;
  }
  return 8;
}

function ensureTimelineWindow(output, timelineStartSec) {
  if (
    output?.timelineWindow &&
    typeof output.timelineWindow.targetDurationSec === "number"
  ) {
    return {
      sourceStartSec: output.timelineWindow.sourceStartSec ?? 0,
      sourceEndSec:
        output.timelineWindow.sourceEndSec ??
        output.timelineWindow.sourceStartSec +
          output.timelineWindow.targetDurationSec,
      safeCutInSec: output.timelineWindow.safeCutInSec ?? 0,
      safeCutOutSec:
        output.timelineWindow.safeCutOutSec ??
        output.timelineWindow.targetDurationSec,
      eventStartSec: output.timelineWindow.eventStartSec ?? 0,
      eventPeakSec:
        output.timelineWindow.eventPeakSec ??
        output.timelineWindow.targetDurationSec / 2,
      eventResolveSec:
        output.timelineWindow.eventResolveSec ??
        output.timelineWindow.targetDurationSec,
      targetDurationSec: output.timelineWindow.targetDurationSec,
      observedDurationSec:
        output.timelineWindow.observedDurationSec ??
        resolveShotDurationSec(output),
      timelineStartSec:
        typeof output.timelineWindow.timelineStartSec === "number"
          ? output.timelineWindow.timelineStartSec
          : timelineStartSec,
      timelineEndSec:
        typeof output.timelineWindow.timelineEndSec === "number"
          ? output.timelineWindow.timelineEndSec
          : timelineStartSec + output.timelineWindow.targetDurationSec,
      retimeStrategy: output.timelineWindow.retimeStrategy ?? "export_fallback",
      peakDetectionStrategy:
        output.timelineWindow.peakDetectionStrategy ?? "export_fallback",
    };
  }

  const durationSec = resolveShotDurationSec(output);
  return {
    sourceStartSec: 0,
    sourceEndSec: durationSec,
    safeCutInSec: 0,
    safeCutOutSec: durationSec,
    eventStartSec: 0,
    eventPeakSec: durationSec / 2,
    eventResolveSec: durationSec,
    targetDurationSec: durationSec,
    observedDurationSec: durationSec,
    timelineStartSec,
    timelineEndSec: timelineStartSec + durationSec,
    retimeStrategy: "export_fallback",
    peakDetectionStrategy: "export_fallback",
  };
}

function collectExportableShots(manifest) {
  const outputs = Array.isArray(manifest?.veoOutputs)
    ? manifest.veoOutputs
    : [];
  const exportable = [];
  const missingShots = [];

  for (const output of outputs) {
    if (
      output?.status === "completed" &&
      (output?.rawClip || output?.trimmedClip)
    ) {
      exportable.push(output);
      continue;
    }

    if (output?.shotId) {
      missingShots.push(output.shotId);
    }
  }

  const sortedExportable = sortShotsForExport(exportable);
  let cursorSec = 0;
  const normalizedExportable = sortedExportable.map((output) => {
    const timelineWindow = ensureTimelineWindow(output, cursorSec);
    cursorSec = timelineWindow.timelineEndSec;
    return {
      ...output,
      timelineWindow,
    };
  });

  return {
    exportableShots: normalizedExportable,
    missingShots,
  };
}

async function ensureCleanDir(dirPath) {
  await fsp.rm(dirPath, { recursive: true, force: true });
  await fsp.mkdir(dirPath, { recursive: true });
}

async function linkOrCopyFile(sourcePath, targetPath) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fsp.link(sourcePath, targetPath);
    return "linked";
  } catch {
    await fsp.copyFile(sourcePath, targetPath);
    return "copied";
  }
}

function toAbsoluteRuntimePath(filePath) {
  return path.isAbsolute(filePath)
    ? filePath
    : resolveAssetPath(filePath);
}

async function createZipFromDirectory(sourceDir, zipPath) {
  await fsp.mkdir(path.dirname(zipPath), { recursive: true });

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function copyDirectoryIfExists(sourceDir, targetDir) {
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    return false;
  }

  if (!fs.statSync(sourceDir).isDirectory()) {
    return false;
  }

  await fsp.mkdir(path.dirname(targetDir), { recursive: true });
  await fsp.rm(targetDir, { recursive: true, force: true });
  await fsp.cp(sourceDir, targetDir, { recursive: true, force: true });
  return true;
}

async function copyFileIfExists(sourcePath, targetPath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return false;
  }

  if (!fs.statSync(sourcePath).isFile()) {
    return false;
  }

  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await fsp.copyFile(sourcePath, targetPath);
  return true;
}

function secondsToMicroseconds(seconds) {
  return Math.round(Number(seconds || 0) * 1_000_000);
}

function buildPlaceholderResourcePath(fileName) {
  return `${DRAFT_PLACEHOLDER}/Resources/${fileName}`;
}

function buildTrack() {
  return {
    id: randomUUID(),
    name: "",
    is_default_name: true,
    type: "video",
    segments: [],
  };
}

function buildDefaultCrop() {
  return {
    upper_left_x: 0,
    upper_left_y: 0,
    upper_right_x: 1,
    upper_right_y: 0,
    lower_left_x: 0,
    lower_left_y: 1,
    lower_right_x: 1,
    lower_right_y: 1,
  };
}

function buildSpeedMaterial() {
  return {
    id: randomUUID(),
    curve_speed: null,
    mode: 0,
    speed: 1,
    type: "speed",
  };
}

function normalizeShotId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^shot[_-]?/, "");
}

function resolveStoryboardSubtitleText(manifest, shotId) {
  const variant = manifest?.variantId
    ? variantDAO.getVariant(manifest.variantId)
    : null;
  const storyboard = variant?.storyboard;
  if (!Array.isArray(storyboard?.blocks)) {
    return null;
  }

  const targetShotId = normalizeShotId(shotId);
  for (const block of storyboard.blocks) {
    if (!Array.isArray(block?.shots)) {
      continue;
    }
    for (const shot of block.shots) {
      if (normalizeShotId(shot?.shot_id) !== targetShotId) {
        continue;
      }
      const content =
        typeof shot?.audio?.content === "string" ? shot.audio.content : "";
      if (content.trim()) {
        return content.trim();
      }
    }
  }

  return null;
}

function normalizeSubtitleText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  return normalized || null;
}

function resolveSubtitleText(manifest, output) {
  return (
    normalizeSubtitleText(output?.subtitleText) ||
    normalizeSubtitleText(output?.dub?.sourceText) ||
    resolveStoryboardSubtitleText(manifest, output?.shotId)
  );
}

function buildSubtitleMaterialContent(text) {
  return JSON.stringify(
    {
      styles: [
        {
          fill: {
            alpha: 1,
            content: {
              render_type: "solid",
              solid: {
                alpha: 1,
                color: [1, 1, 1],
              },
            },
          },
          range: [0, text.length],
          size: 6.8,
          bold: true,
          italic: false,
          underline: false,
          strokes: [
            {
              content: {
                solid: {
                  alpha: 1,
                  color: [0, 0, 0],
                },
              },
              width: 0.08,
            },
          ],
        },
      ],
      text,
    },
    null,
    0,
  );
}

function buildSubtitleMaterial(text) {
  return {
    id: randomUUID(),
    content: buildSubtitleMaterialContent(text),
    text,
    typesetting: 0,
    alignment: 1,
    letter_spacing: 0,
    line_spacing: 0.02,
    line_feed: 1,
    line_max_width: 0.82,
    force_apply_line_max_width: false,
    check_flag: 15,
    type: "subtitle",
    global_alpha: 1,
  };
}

function buildSubtitleSegment(materialId, output) {
  return {
    id: randomUUID(),
    enable_adjust: true,
    enable_color_correct_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    last_nonzero_volume: 1,
    reverse: false,
    render_index: 15000,
    track_attribute: 0,
    track_render_index: 0,
    visible: true,
    material_id: materialId,
    source_timerange: null,
    target_timerange: {
      start: secondsToMicroseconds(output.timelineWindow?.timelineStartSec ?? 0),
      duration: secondsToMicroseconds(
        output.timelineWindow?.targetDurationSec ?? resolveShotDurationSec(output),
      ),
    },
    common_keyframes: [],
    keyframe_refs: [],
    extra_material_refs: [],
    clip: {
      alpha: 1,
      flip: {
        horizontal: false,
        vertical: false,
      },
      rotation: 0,
      scale: {
        x: 1,
        y: 1,
      },
      transform: {
        x: 0,
        y: -0.25,
      },
    },
    uniform_scale: {
      on: true,
      value: 1,
    },
  };
}

function buildSubtitleProtocolEntries(manifest, outputs) {
  return outputs
    .map((output) => {
      const text = resolveSubtitleText(manifest, output);
      if (!text) {
        return null;
      }

      const material = buildSubtitleMaterial(text);
      const segment = buildSubtitleSegment(material.id, output);
      return {
        shotId: output.shotId,
        text,
        material,
        segment,
      };
    })
    .filter(Boolean);
}

function buildAudioSegment({
  segmentId,
  materialId,
  timelineStartUs,
  targetDurationUs,
  sourceStartUs,
  audioDurationUs,
}) {
  const boundedSourceStartUs = Math.max(sourceStartUs || 0, 0);
  const availableSourceDurationUs =
    Math.max(audioDurationUs - boundedSourceStartUs, 0) || targetDurationUs;

  return {
    id: segmentId,
    enable_adjust: true,
    enable_color_correct_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    last_nonzero_volume: 1,
    reverse: false,
    render_index: 0,
    track_attribute: 0,
    track_render_index: 0,
    visible: true,
    material_id: materialId,
    target_timerange: {
      start: timelineStartUs,
      duration: Math.min(
        Math.max(targetDurationUs, 0),
        Math.max(availableSourceDurationUs, 0),
      ),
    },
    source_timerange: {
      start: boundedSourceStartUs,
      duration: Math.max(availableSourceDurationUs, targetDurationUs, 0),
    },
    common_keyframes: [],
    keyframe_refs: [],
    speed: 1,
    volume: 1,
    extra_material_refs: [],
    is_tone_modify: false,
    clip: null,
    hdr_settings: null,
  };
}

function createBaseDraftInfo({ draftId, width, height, durationUs }) {
  return {
    canvas_config: {
      width,
      height,
      ratio: "original",
    },
    duration: durationUs,
    render_index_track_mode_on: true,
    config: {
      maintrack_adsorb: false,
    },
    color_space: 0,
    fps: 30,
    id: draftId,
    materials: {
      videos: [],
      texts: [],
      audios: [],
      stickers: [],
      speeds: [],
      effects: [],
      video_effects: [],
      placeholders: [],
      transitions: [],
      material_animations: [],
    },
    tracks: [],
  };
}

function createBaseDraftMetaInfo({ draftName }) {
  return {
    draft_materials: [
      { type: 0, value: [] },
      { type: 1, value: [] },
      { type: 2, value: [] },
    ],
    draft_name: draftName,
  };
}

function createBaseDraftVirtualStore() {
  return {
    draft_materials: [],
    draft_virtual_store: [
      {
        type: 0,
        value: [
          {
            creation_time: Math.floor(Date.now() / 1000),
            display_name: "",
            filter_type: 0,
            id: "",
            import_time: Math.floor(Date.now() / 1000),
            import_time_us: Date.now() * 1000,
            sort_sub_type: 0,
            sort_type: 0,
          },
        ],
      },
      {
        type: 1,
        value: [],
      },
      {
        type: 2,
        value: [],
      },
    ],
  };
}

function buildMaterialName(output, fileName) {
  return output.shotId || fileName;
}

function toProtocolFileName(shotId, rawAbsPath) {
  const ext = path.extname(rawAbsPath) || ".mp4";
  const hash = createHash("md5").update(rawAbsPath).digest("hex").slice(0, 8);
  return `${hash}_${shotId}${ext}`;
}

function resolveExistingVideoSource({ output, baseDir }) {
  const candidates = [];

  if (output?.rawClip) {
    candidates.push({
      path: toAbsoluteRuntimePath(output.rawClip),
      sourceType: "raw",
    });
  }

  if (output?.trimmedClip) {
    candidates.push({
      path: toAbsoluteRuntimePath(output.trimmedClip),
      sourceType: "trimmed_manifest",
    });
  }

  if (baseDir && output?.shotId) {
    candidates.push({
      path: path.join(baseDir, "clips", "trimmed", `${output.shotId}.mp4`),
      sourceType: "trimmed_runtime",
    });
  }

  for (const candidate of candidates) {
    if (candidate.path && fs.existsSync(candidate.path)) {
      return candidate;
    }
  }

  const preferredMissingPath = candidates[0]?.path || String(output?.rawClip || "");
  throw new Error(`视频文件不存在: ${preferredMissingPath}`);
}

function buildBundleManifest({
  draftId,
  draftName,
  manifest,
  protocolEntries,
  missingShots,
  warning,
}) {
  return {
    bundleType: "veo_export_bundle",
    draftId,
    draftName,
    projectId: manifest?.projectId || null,
    variantId: manifest?.variantId || null,
    createdAt: new Date().toISOString(),
    warning: warning || null,
    missingShots,
    shots: protocolEntries.map((entry) => ({
      shotId: entry.shotId,
      sourceType: entry.sourceType,
      sourceClip: entry.rawClip || null,
      bundledVideoFile: entry.fileName,
      bundledAudioFile: entry.audioFileName || null,
    })),
    includedFolders: [
      "draft",
      "sources/raw",
      "sources/trimmed",
      "images/shot-references",
      "images/source-grids",
      "images/product",
      "result",
      "audio/dubs",
      "manifest",
    ],
  };
}

async function buildShotProtocolEntry({
  output,
  baseDir,
  resourcesDir,
  draftId,
  targetDir,
}) {
  const sourceVideo = resolveExistingVideoSource({ output, baseDir });
  const rawAbsPath = sourceVideo.path;
  const fileName = toProtocolFileName(output.shotId, rawAbsPath);
  const resourcePath = path.join(resourcesDir, fileName);
  const metadata = await probeVideo(rawAbsPath);
  const copyMode = await linkOrCopyFile(rawAbsPath, resourcePath);

  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const targetDurationUs = secondsToMicroseconds(
    output.timelineWindow.targetDurationSec,
  );
  const timelineStartUs = secondsToMicroseconds(
    output.timelineWindow.timelineStartSec,
  );
  const sourceStartUs = secondsToMicroseconds(
    output.timelineWindow.sourceStartSec,
  );
  const observedDurationUs = secondsToMicroseconds(
    metadata.duration ||
      output.timelineWindow.observedDurationSec ||
      output.generatedDurationSec ||
      0,
  );
  const rawSourceEndUs = secondsToMicroseconds(
    output.timelineWindow.sourceEndSec ??
      output.timelineWindow.sourceStartSec +
        output.timelineWindow.targetDurationSec,
  );
  const boundedSourceEndUs =
    observedDurationUs > 0
      ? Math.min(Math.max(rawSourceEndUs, sourceStartUs), observedDurationUs)
      : Math.max(rawSourceEndUs, sourceStartUs);
  const sourceDurationUs =
    Math.max(boundedSourceEndUs - sourceStartUs, 0) || targetDurationUs;

  const materialId = randomUUID();
  const speedId = randomUUID();
  const segmentId = randomUUID();
  const placeholderPath = buildPlaceholderResourcePath(fileName);
  const finalFilePath = targetDir
    ? path.join(targetDir, "Resources", fileName)
    : resourcePath;

  // 判断是否需要静音原视频（当 dub.mode !== "original" 时）
  const shouldMuteOriginal =
    output?.dub?.mode &&
    output.dub.mode !== "original" &&
    output.dub.status === "completed";

  return {
    shotId: output.shotId,
    fileName,
    rawClip: output.rawClip,
    sourceType: sourceVideo.sourceType,
    copyMode,
    width,
    height,
    observedDurationUs,
    placeholderPath,
    finalFilePath,
    material: {
      id: materialId,
      local_material_id: materialId,
      material_id: materialId,
      remote_url: finalFilePath,
      path: finalFilePath,
      duration: observedDurationUs,
      width,
      height,
      crop: buildDefaultCrop(),
      crop_ratio: "free",
      crop_scale: 1,
      check_flag: 63487,
      material_name: buildMaterialName(output, fileName),
      category_name: "local",
      type: "video",
    },
    speed: {
      id: speedId,
      curve_speed: null,
      mode: 0,
      speed: 1,
      type: "speed",
    },
    segment: {
      id: segmentId,
      material_id: materialId,
      target_timerange: {
        start: timelineStartUs,
        duration: targetDurationUs,
      },
      // source_timerange.duration 使用视频完整长度，让用户可以在剪映里拉长
      source_timerange: {
        start: sourceStartUs,
        duration: Math.max(
          observedDurationUs - sourceStartUs,
          targetDurationUs,
        ),
      },
      speed: 1,
      reverse: false,
      visible: true,
      // 当有 dub 且 mode !== "original" 时，静音原视频
      volume: shouldMuteOriginal ? 0 : 1,
      extra_material_refs: [speedId],
    },
    metaInfo: {
      id: randomUUID(),
      create_time: Math.floor(Date.now() / 1000),
      duration: observedDurationUs,
      extra_info: buildMaterialName(output, fileName),
      file_Path: finalFilePath,
      height,
      import_time: Math.floor(Date.now() / 1000),
      import_time_ms: Date.now() * 1000,
      metetype: "video",
      type: 0,
      width,
      remote_url: finalFilePath,
    },
  };
}

/**
 * 构建音频轨道协议条目
 *
 * @param {Object} params
 * @param {Object} params.output - VeoOutput 对象
 * @param {string} params.resourcesDir - 资源目录
 * @param {string} params.draftId - 草稿 ID
 * @param {string|null} params.targetDir - 目标目录
 * @returns {Promise<Object|null>} - 音频协议条目，如果无 dub 则返回 null
 */
async function buildAudioProtocolEntry({
  output,
  resourcesDir,
  draftId,
  targetDir,
}) {
  // 检查是否有有效的 dub
  if (
    !output?.dub?.audioPath ||
    output.dub.mode === "original" ||
    output.dub.mode === "off" ||
    output.dub.status !== "completed"
  ) {
    return null;
  }

  try {
    const audioAbsPath = toAbsoluteRuntimePath(output.dub.audioPath);
    const ext = path.extname(audioAbsPath) || ".mp3";
    const hash = createHash("md5")
      .update(audioAbsPath)
      .digest("hex")
      .slice(0, 8);
    const fileName = `${hash}_${output.shotId}${ext}`;
    const resourcePath = path.join(resourcesDir, fileName);

    await linkOrCopyFile(audioAbsPath, resourcePath);

    const audioDurationUs = secondsToMicroseconds(output.dub.durationSec || 0);
    const timelineStartUs = secondsToMicroseconds(
      output.timelineWindow?.timelineStartSec ?? 0,
    );
    const targetDurationUs = secondsToMicroseconds(
      output.timelineWindow?.targetDurationSec ?? output.dub.durationSec ?? 0,
    );
    const sourceStartUs = 0;

    const materialId = randomUUID();
    const segmentId = randomUUID();
    const finalFilePath = targetDir
      ? path.join(targetDir, "Resources", fileName)
      : resourcePath;

    return {
      shotId: output.shotId,
      fileName,
      material: {
        id: materialId,
        local_material_id: materialId,
        material_id: materialId,
        music_id: materialId,
        path: finalFilePath,
        remote_url: finalFilePath,
        duration: audioDurationUs,
        type: "extract_music",
        name: `dub_${output.shotId}`,
        material_name: `dub_${output.shotId}`,
        category_name: "local",
        category_id: "",
        check_flag: 3,
        copyright_limit_type: "none",
        effect_id: "",
        formula_id: "",
        source_platform: 0,
        wave_points: [],
      },
      segment: buildAudioSegment({
        segmentId,
        materialId,
        timelineStartUs,
        targetDurationUs,
        sourceStartUs,
        audioDurationUs,
      }),
    };
  } catch (error) {
    console.warn(
      `[jianyingDraftExport] 构建 audio protocol 条目失败 (${output.shotId}): ${error.message}`,
    );
    return null;
  }
}

async function copyDirectory(sourceDir, targetDir) {
  await fsp.mkdir(path.dirname(targetDir), { recursive: true });
  await fsp.rm(targetDir, { recursive: true, force: true });
  await fsp.cp(sourceDir, targetDir, { recursive: true, force: true });
}

async function buildZipBundle({
  manifest,
  baseDir,
  stagingDir,
  runtimeExportRoot,
  draftId,
  draftName,
  protocolEntries,
  missingShots,
  warning,
}) {
  const bundleDir = path.join(runtimeExportRoot, `${draftId}__bundle`);
  await ensureCleanDir(bundleDir);

  await copyDirectory(stagingDir, path.join(bundleDir, "draft"));
  await copyDirectoryIfExists(
    path.join(baseDir, "clips", "raw"),
    path.join(bundleDir, "sources", "raw"),
  );
  await copyDirectoryIfExists(
    path.join(baseDir, "clips", "trimmed"),
    path.join(bundleDir, "sources", "trimmed"),
  );
  await copyDirectoryIfExists(
    path.join(baseDir, "shot-references"),
    path.join(bundleDir, "images", "shot-references"),
  );
  await copyDirectoryIfExists(
    path.join(baseDir, "source-grids"),
    path.join(bundleDir, "images", "source-grids"),
  );
  await copyDirectoryIfExists(
    path.join(baseDir, "dubs"),
    path.join(bundleDir, "audio", "dubs"),
  );
  await copyDirectoryIfExists(
    path.join(baseDir, "result"),
    path.join(bundleDir, "result"),
  );

  if (manifest?.projectId) {
    const projectDir = resolveSafeProjectDir(manifest.projectId);
    const productImage = findProductImageFile(projectDir);
    if (productImage?.filePath) {
      await copyFileIfExists(
        productImage.filePath,
        path.join(bundleDir, "images", "product", productImage.filename),
      );
    }
  }

  await fsp.mkdir(path.join(bundleDir, "manifest"), { recursive: true });
  await fsp.writeFile(
    path.join(bundleDir, "manifest", "bundle_manifest.json"),
    JSON.stringify(
      buildBundleManifest({
        draftId,
        draftName,
        manifest,
        protocolEntries,
        missingShots,
        warning,
      }),
      null,
      2,
    ),
    "utf-8",
  );

  return bundleDir;
}

function finalizeDraftMetaInfo(draftMetaInfo, protocolEntries) {
  draftMetaInfo.draft_materials[0].value = protocolEntries.map(
    (entry) => entry.metaInfo,
  );
  return draftMetaInfo;
}

function finalizeDraftVirtualStore(draftVirtualStore, protocolEntries) {
  draftVirtualStore.draft_virtual_store[1].value = protocolEntries.map(
    (entry) => ({
      child_id: entry.metaInfo.id,
      parent_id: "",
    }),
  );
  return draftVirtualStore;
}

async function exportDraft({
  manifest,
  baseDir,
  draftPath = null,
  createZip = false,
}) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("exportDraft: manifest is required");
  }
  if (!baseDir) {
    throw new Error("exportDraft: baseDir is required");
  }

  const { exportableShots, missingShots } = collectExportableShots(manifest);
  if (exportableShots.length === 0) {
    throw new Error("没有可导出的已完成 shots");
  }

  // 使用语义化命名
  const draftId = buildSemanticDraftId(manifest);
  const draftName = buildSemanticDraftName(manifest);
  const runtimeExportRoot = path.join(baseDir, "draft-export");
  const stagingDir = path.join(runtimeExportRoot, draftId);
  const resourcesDir = path.join(stagingDir, "Resources");
  await ensureCleanDir(resourcesDir);

  let targetDir = stagingDir;
  let targetPathResolved = null;
  if (draftPath) {
    targetPathResolved = resolveSafeDraftTargetPath(draftPath);
    targetDir = path.join(targetPathResolved, draftId);
  }

  const protocolEntries = [];
  for (const output of exportableShots) {
    protocolEntries.push(
      await buildShotProtocolEntry({
        output,
        baseDir,
        resourcesDir,
        draftId,
        targetDir,
      }),
    );
  }

  // 处理音频轨道（Voice Changer 功能）
  const audioProtocolEntries = [];
  for (const output of exportableShots) {
    const audioEntry = await buildAudioProtocolEntry({
      output,
      resourcesDir,
      draftId,
      targetDir,
    });
    if (audioEntry) {
      audioProtocolEntries.push(audioEntry);
    }
  }
  const subtitleProtocolEntries = buildSubtitleProtocolEntries(
    manifest,
    exportableShots,
  );

  const totalDurationUs = protocolEntries.reduce((maxDuration, entry) => {
    const segmentEnd =
      entry.segment.target_timerange.start +
      entry.segment.target_timerange.duration;
    return Math.max(maxDuration, segmentEnd);
  }, 0);
  const canvasWidth = protocolEntries[0]?.width || 720;
  const canvasHeight = protocolEntries[0]?.height || 1280;

  const draftInfo = createBaseDraftInfo({
    draftId,
    width: canvasWidth,
    height: canvasHeight,
    durationUs: totalDurationUs,
  });
  const track = buildTrack();
  track.segments = protocolEntries.map((entry) => entry.segment);
  draftInfo.tracks = [track];
  draftInfo.materials.videos = protocolEntries.map((entry) => entry.material);
  draftInfo.materials.speeds = protocolEntries.map((entry) => entry.speed);

  // 添加音频轨道（如果有 dub 音频）
  if (audioProtocolEntries.length > 0) {
    draftInfo.materials.audios = audioProtocolEntries.map(
      (entry) => entry.material,
    );

    const audioTrack = buildTrack();
    audioTrack.type = "audio";
    audioTrack.segments = audioProtocolEntries.map((entry) => entry.segment);
    draftInfo.tracks.push(audioTrack);
  }

  if (subtitleProtocolEntries.length > 0) {
    draftInfo.materials.texts = subtitleProtocolEntries.map(
      (entry) => entry.material,
    );

    const textTrack = buildTrack();
    textTrack.type = "text";
    textTrack.segments = subtitleProtocolEntries.map((entry) => entry.segment);
    draftInfo.tracks.push(textTrack);
  }

  const draftMetaInfo = finalizeDraftMetaInfo(
    createBaseDraftMetaInfo({ draftName }),
    protocolEntries,
  );
  const draftVirtualStore = finalizeDraftVirtualStore(
    createBaseDraftVirtualStore(),
    protocolEntries,
  );

  await fsp.writeFile(
    path.join(stagingDir, "draft_info.json"),
    JSON.stringify(draftInfo, null, 2),
    "utf-8",
  );
  await fsp.writeFile(
    path.join(stagingDir, "draft_content.json"),
    JSON.stringify(draftInfo, null, 2),
    "utf-8",
  );
  await fsp.writeFile(
    path.join(stagingDir, "draft_meta_info.json"),
    JSON.stringify(draftMetaInfo, null, 2),
    "utf-8",
  );
  await fsp.writeFile(
    path.join(stagingDir, "draft_virtual_store.json"),
    JSON.stringify(draftVirtualStore, null, 2),
    "utf-8",
  );

  if (draftPath) {
    await copyDirectory(stagingDir, targetDir);
  }

  const trimmedFallbackShots = protocolEntries
    .filter((entry) => entry.sourceType !== "raw")
    .map((entry) => entry.shotId);
  const warning =
    trimmedFallbackShots.length > 0
      ? `以下镜头的 raw 源文件缺失，已自动回退为 trimmed 片段导出: ${trimmedFallbackShots.join(", ")}`
      : null;

  for (const entry of protocolEntries) {
    const audioEntry = audioProtocolEntries.find(
      (candidate) => candidate.shotId === entry.shotId,
    );
    entry.audioFileName = audioEntry?.fileName || null;
  }

  let zipPath = null;
  let bundleDir = null;
  if (createZip) {
    bundleDir = await buildZipBundle({
      manifest,
      baseDir,
      stagingDir,
      runtimeExportRoot,
      draftId,
      draftName,
      protocolEntries,
      missingShots,
      warning,
    });
    zipPath = path.join(runtimeExportRoot, `${draftId}.zip`);
    await createZipFromDirectory(bundleDir, zipPath);
  }

  return {
    draftId,
    draftDir: targetDir,
    stagingDir,
    bundleDir,
    zipPath,
    mode: EXPORT_MODE,
    targetPath: targetPathResolved,
    missingShots,
    exportedAt: new Date().toISOString(),
    totalSegments: protocolEntries.length,
    warning,
  };
}

module.exports = {
  EXPORT_MODE,
  DRAFT_PLACEHOLDER,
  collectExportableShots,
  buildAudioProtocolEntry,
  exportDraft,
};
