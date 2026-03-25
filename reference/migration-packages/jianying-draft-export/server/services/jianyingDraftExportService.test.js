const fs = require("fs");
const os = require("os");
const path = require("path");
const variantDAO = require("../db/variantDAO");

jest.mock("./videoPreprocess", () => ({
  probeVideo: jest.fn(async () => ({
    duration: 8,
    width: 720,
    height: 1280,
    codec: "h264",
  })),
}));

const {
  exportDraft,
  collectExportableShots,
} = require("./jianyingDraftExportService");

describe("jianyingDraftExportService", () => {
  let tempDir;
  let baseDir;
  let rawDir;
  let trimmedDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ugcflow-jianying-draft-"));
    baseDir = path.join(tempDir, "veo-shot-pipeline");
    rawDir = path.join(baseDir, "clips", "raw");
    trimmedDir = path.join(baseDir, "clips", "trimmed");
    fs.mkdirSync(rawDir, { recursive: true });
    fs.mkdirSync(trimmedDir, { recursive: true });
    fs.writeFileSync(path.join(rawDir, "shot_01.mp4"), "raw-01");
    fs.writeFileSync(path.join(rawDir, "shot_02.mp4"), "raw-02");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  test("collectExportableShots separates missing shots", () => {
    const { exportableShots, missingShots } = collectExportableShots({
      veoOutputs: [
        {
          shotId: "shot_01",
          status: "completed",
          rawClip: "a.mp4",
          timelineWindow: { targetDurationSec: 3.2, timelineStartSec: 0 },
        },
        {
          shotId: "shot_02",
          status: "failed",
          rawClip: null,
          timelineWindow: null,
        },
      ],
    });

    expect(exportableShots).toHaveLength(1);
    expect(exportableShots[0].shotId).toBe("shot_01");
    expect(missingShots).toEqual(["shot_02"]);
  });

  test("collectExportableShots synthesizes timeline windows for completed raw clips", () => {
    const { exportableShots, missingShots } = collectExportableShots({
      veoOutputs: [
        {
          shotId: "shot_01",
          status: "completed",
          rawClip: "a.mp4",
          generatedDurationSec: 8,
          timelineWindow: null,
        },
        {
          shotId: "shot_02",
          status: "completed",
          rawClip: "b.mp4",
          usableDurationSec: 5.5,
          timelineWindow: null,
        },
      ],
    });

    expect(missingShots).toEqual([]);
    expect(exportableShots).toHaveLength(2);
    expect(exportableShots[0].timelineWindow).toMatchObject({
      timelineStartSec: 0,
      timelineEndSec: 8,
      targetDurationSec: 8,
    });
    expect(exportableShots[1].timelineWindow).toMatchObject({
      timelineStartSec: 8,
      timelineEndSec: 13.5,
      targetDurationSec: 5.5,
    });
  });

  test("exportDraft writes protocol draft files, resources, and zip", async () => {
    const manifest = {
      projectId: "project-1",
      variantId: "variant-1",
      templateId: "0211-1",
      veoOutputs: [
        {
          shotId: "shot_01",
          status: "completed",
          rawClip: path.join(rawDir, "shot_01.mp4"),
          timelineWindow: {
            sourceStartSec: 0,
            sourceEndSec: 3.2,
            targetDurationSec: 3.2,
            timelineStartSec: 0,
            timelineEndSec: 3.2,
            observedDurationSec: 8,
          },
          generatedDurationSec: 8,
        },
        {
          shotId: "shot_02",
          status: "completed",
          rawClip: path.join(rawDir, "shot_02.mp4"),
          timelineWindow: {
            sourceStartSec: 0,
            sourceEndSec: 2.8,
            targetDurationSec: 2.8,
            timelineStartSec: 3.2,
            timelineEndSec: 6,
            observedDurationSec: 8,
          },
          generatedDurationSec: 8,
        },
      ],
    };

    const targetRoot = path.join(tempDir, "exports");
    fs.mkdirSync(targetRoot, { recursive: true });

    const result = await exportDraft({
      manifest,
      baseDir,
      draftPath: targetRoot,
      createZip: true,
    });

    expect(fs.existsSync(path.join(result.stagingDir, "draft_info.json"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(result.stagingDir, "draft_content.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(result.stagingDir, "draft_meta_info.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(result.stagingDir, "draft_virtual_store.json")),
    ).toBe(true);
    const exportedResources = fs.readdirSync(
      path.join(result.stagingDir, "Resources"),
    );
    expect(exportedResources).toHaveLength(2);
    expect(
      exportedResources.some((name) => name.endsWith("_shot_01.mp4")),
    ).toBe(true);
    expect(fs.existsSync(result.draftDir)).toBe(true);
    expect(fs.existsSync(result.zipPath)).toBe(true);
    expect(result.missingShots).toEqual([]);

    const content = JSON.parse(
      fs.readFileSync(path.join(result.stagingDir, "draft_info.json"), "utf-8"),
    );
    expect(content.tracks[0].segments).toHaveLength(2);
    expect(content.tracks[0].segments[1]).toMatchObject({
      speed: 1,
      target_timerange: {
        start: 3200000,
        duration: 2800000,
      },
    });
    expect(content.tracks[0].segments[0].source_timerange).toMatchObject({
      start: 0,
      duration: 8000000,
    });
    expect(content.materials.videos[0]).toMatchObject({
      duration: 8000000,
      crop_ratio: "free",
      type: "video",
    });
    expect(content.materials.videos[0].path).toContain(
      path.join(result.draftDir, "Resources"),
    );
    expect(content.materials.videos[0].remote_url).toBe(
      content.materials.videos[0].path,
    );

    const meta = JSON.parse(
      fs.readFileSync(
        path.join(result.stagingDir, "draft_meta_info.json"),
        "utf-8",
      ),
    );
    expect(meta.draft_materials[0].value).toHaveLength(2);
    expect(meta.draft_materials[0].value[0].duration).toBe(8000000);
    expect(meta.draft_materials[0].value[0].file_Path).toContain(
      path.join(result.draftDir, "Resources"),
    );
    expect(meta.draft_materials[0].value[0].remote_url).toBe(
      meta.draft_materials[0].value[0].file_Path,
    );

    const virtualStore = JSON.parse(
      fs.readFileSync(
        path.join(result.stagingDir, "draft_virtual_store.json"),
        "utf-8",
      ),
    );
    expect(virtualStore.draft_virtual_store[1].value).toHaveLength(2);
  });

  test("exportDraft falls back to trimmed clip when raw file is missing", async () => {
    fs.writeFileSync(path.join(trimmedDir, "shot_01.mp4"), "trimmed-01");
    fs.rmSync(path.join(rawDir, "shot_01.mp4"));
    fs.mkdirSync(path.join(baseDir, "shot-references"), { recursive: true });
    fs.mkdirSync(path.join(baseDir, "source-grids"), { recursive: true });
    fs.mkdirSync(path.join(baseDir, "result"), { recursive: true });
    fs.writeFileSync(
      path.join(baseDir, "shot-references", "shot_01.png"),
      "ref-image",
    );
    fs.writeFileSync(path.join(baseDir, "source-grids", "grid_01.png"), "grid");
    fs.writeFileSync(path.join(baseDir, "result", "final.mp4"), "final-video");

    const manifest = {
      projectId: "project-1",
      variantId: "variant-1",
      templateId: "0211-1",
      veoOutputs: [
        {
          shotId: "shot_01",
          status: "completed",
          rawClip: path.join(rawDir, "shot_01.mp4"),
          timelineWindow: {
            sourceStartSec: 0,
            sourceEndSec: 3.2,
            targetDurationSec: 3.2,
            timelineStartSec: 0,
            timelineEndSec: 3.2,
            observedDurationSec: 8,
          },
          generatedDurationSec: 8,
        },
      ],
    };

    const result = await exportDraft({
      manifest,
      baseDir,
      createZip: true,
    });

    expect(fs.existsSync(result.zipPath)).toBe(true);
    expect(result.warning).toContain("shot_01");
    expect(fs.existsSync(path.join(result.bundleDir, "draft"))).toBe(true);
    expect(
      fs.existsSync(path.join(result.bundleDir, "sources", "trimmed", "shot_01.mp4")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(result.bundleDir, "images", "shot-references", "shot_01.png"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(result.bundleDir, "images", "source-grids", "grid_01.png")),
    ).toBe(true);
    expect(fs.existsSync(path.join(result.bundleDir, "result", "final.mp4"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(result.bundleDir, "manifest", "bundle_manifest.json")),
    ).toBe(true);
  });

  // ==================== P0-3: 剪映导出边界测试 ====================

  describe("边界场景测试", () => {
    test("rawClip 为 undefined 时跳过该 shot 并记录 missing", () => {
      const { exportableShots, missingShots } = collectExportableShots({
        veoOutputs: [
          {
            shotId: "shot_01",
            status: "completed",
            rawClip: undefined, // 边界情况
            timelineWindow: { targetDurationSec: 3.2 },
          },
          {
            shotId: "shot_02",
            status: "completed",
            rawClip: "valid.mp4",
            timelineWindow: { targetDurationSec: 5 },
          },
        ],
      });

      // rawClip undefined 的 shot 不应被导出
      expect(exportableShots).toHaveLength(1);
      expect(exportableShots[0].shotId).toBe("shot_02");
      expect(missingShots).toContain("shot_01");
    });

    test("rawClip 为 null 时不被收集", () => {
      const { exportableShots, missingShots } = collectExportableShots({
        veoOutputs: [
          {
            shotId: "shot_01",
            status: "completed",
            rawClip: null,
          },
        ],
      });

      expect(exportableShots).toHaveLength(0);
      expect(missingShots).toContain("shot_01");
    });

    test("status 非 completed 时不被收集", () => {
      const { exportableShots, missingShots } = collectExportableShots({
        veoOutputs: [
          {
            shotId: "shot_01",
            status: "running",
            rawClip: "file.mp4",
          },
          {
            shotId: "shot_02",
            status: "failed",
            rawClip: "file2.mp4",
          },
          {
            shotId: "shot_03",
            status: "completed",
            rawClip: "file3.mp4",
          },
        ],
      });

      expect(exportableShots).toHaveLength(1);
      expect(exportableShots[0].shotId).toBe("shot_03");
      expect(missingShots).toEqual(
        expect.arrayContaining(["shot_01", "shot_02"]),
      );
    });

    test("probeVideo 返回空对象时使用默认宽高", async () => {
      const { probeVideo } = require("./videoPreprocess");
      probeVideo.mockResolvedValueOnce({}); // 空对象

      const manifest = {
        projectId: "project-1",
        variantId: "variant-1",
        veoOutputs: [
          {
            shotId: "shot_01",
            status: "completed",
            rawClip: path.join(rawDir, "shot_01.mp4"),
            timelineWindow: { targetDurationSec: 5, timelineStartSec: 0 },
          },
        ],
      };

      const result = await exportDraft({ manifest, baseDir });

      const content = JSON.parse(
        fs.readFileSync(
          path.join(result.stagingDir, "draft_info.json"),
          "utf-8",
        ),
      );

      // 宽高为 0 时使用默认值 720x1280
      expect(content.canvas_config.width).toBe(720);
      expect(content.canvas_config.height).toBe(1280);
    });

    test("时长为 0 时保持为 0（代码实际行为）", () => {
      // 注意：当 targetDurationSec 显式为 0 时，代码会使用 0
      // 因为 typeof 0 === "number" 为 true
      const { exportableShots } = collectExportableShots({
        veoOutputs: [
          {
            shotId: "shot_01",
            status: "completed",
            rawClip: "file.mp4",
            timelineWindow: { targetDurationSec: 0 },
          },
        ],
      });

      expect(exportableShots).toHaveLength(1);
      // 代码实际行为：targetDurationSec 为 0 时保持为 0
      expect(exportableShots[0].timelineWindow.targetDurationSec).toBe(0);
    });

    test("无 timelineWindow 时使用默认 8 秒", () => {
      const { exportableShots } = collectExportableShots({
        veoOutputs: [
          {
            shotId: "shot_01",
            status: "completed",
            rawClip: "file.mp4",
            // 无 timelineWindow，应使用默认值
            usableDurationSec: 0,
            generatedDurationSec: 0,
          },
        ],
      });

      expect(exportableShots).toHaveLength(1);
      // 无 timelineWindow 时使用 resolveShotDurationSec 默认值 8
      expect(exportableShots[0].timelineWindow.targetDurationSec).toBe(8);
    });

    test("manifest 为 null 时抛出明确错误", async () => {
      await expect(exportDraft({ manifest: null, baseDir })).rejects.toThrow(
        "manifest is required",
      );
    });

    test("manifest 为 undefined 时抛出明确错误", async () => {
      await expect(
        exportDraft({ manifest: undefined, baseDir }),
      ).rejects.toThrow("manifest is required");
    });

    test("baseDir 为空时抛出明确错误", async () => {
      const manifest = { veoOutputs: [] };
      await expect(exportDraft({ manifest, baseDir: null })).rejects.toThrow(
        "baseDir is required",
      );
    });

    test("无可导出 shots 时抛出错误", async () => {
      const manifest = {
        projectId: "project-1",
        variantId: "variant-1",
        veoOutputs: [{ shotId: "shot_01", status: "failed", rawClip: null }],
      };

      await expect(exportDraft({ manifest, baseDir })).rejects.toThrow(
        "没有可导出的已完成 shots",
      );
    });

    test("支持中文路径", async () => {
      const { probeVideo } = require("./videoPreprocess");
      probeVideo.mockResolvedValueOnce({
        duration: 8,
        width: 720,
        height: 1280,
      });

      // 创建中文目录
      const chineseDir = path.join(baseDir, "中文视频", "素材");
      fs.mkdirSync(chineseDir, { recursive: true });
      const chineseFile = path.join(chineseDir, "镜头一.mp4");
      fs.writeFileSync(chineseFile, "chinese-content");

      const manifest = {
        projectId: "项目一",
        variantId: "变体一",
        veoOutputs: [
          {
            shotId: "镜头一",
            status: "completed",
            rawClip: chineseFile,
            timelineWindow: { targetDurationSec: 5, timelineStartSec: 0 },
          },
        ],
      };

      const result = await exportDraft({ manifest, baseDir });

      expect(result.draftId).toBeDefined();
      expect(result.totalSegments).toBe(1);

      // 验证文件被正确复制
      const resources = fs.readdirSync(
        path.join(result.stagingDir, "Resources"),
      );
      expect(resources).toHaveLength(1);
    });
  });

  // ==================== 语义化命名测试 ====================

  describe("语义化命名", () => {
    test("使用语义化名称生成 draft_name", async () => {
      const manifest = {
        projectId: "project-1",
        variantId: "variant-1",
        templateId: "0211-1",
        productName: "美白精华",
        templateName: "护肤模板",
        variantDimensions: {
          audience: "年轻女性",
          scene: "居家",
          tone: "温馨",
        },
        veoOutputs: [
          {
            shotId: "shot_01",
            status: "completed",
            rawClip: path.join(rawDir, "shot_01.mp4"),
            timelineWindow: { targetDurationSec: 5, timelineStartSec: 0 },
          },
        ],
      };

      const result = await exportDraft({ manifest, baseDir });

      // 验证 draft_meta_info.json 中的 draft_name
      const meta = JSON.parse(
        fs.readFileSync(
          path.join(result.stagingDir, "draft_meta_info.json"),
          "utf-8",
        ),
      );
      expect(meta.draft_name).toBe("美白精华-护肤模板-年轻女性-居家-温馨");

      // 验证 draftId 包含语义化名称
      expect(result.draftId).toMatch(
        /^美白精华-护肤模板-年轻女性-居家-温馨-\d+$/,
      );
    });

    test("缺少语义数据时回退到旧格式", async () => {
      const manifest = {
        projectId: "project-1",
        variantId: "variant-1",
        templateId: "0211-1",
        // 无 productName，应回退
        veoOutputs: [
          {
            shotId: "shot_01",
            status: "completed",
            rawClip: path.join(rawDir, "shot_01.mp4"),
            timelineWindow: { targetDurationSec: 5, timelineStartSec: 0 },
          },
        ],
      };

      const result = await exportDraft({ manifest, baseDir });

      const meta = JSON.parse(
        fs.readFileSync(
          path.join(result.stagingDir, "draft_meta_info.json"),
          "utf-8",
        ),
      );
      // 回退格式
      expect(meta.draft_name).toBe("0211-1-variant-1");
    });

    test("清理特殊字符", async () => {
      const manifest = {
        projectId: "project-1",
        variantId: "variant-1",
        templateId: "0211-1",
        productName: "美白/精华:护肤", // 包含特殊字符
        templateName: "模板*名称",
        variantDimensions: {
          audience: '年轻"女性"',
          scene: "居<家>",
          tone: "温|馨",
        },
        veoOutputs: [
          {
            shotId: "shot_01",
            status: "completed",
            rawClip: path.join(rawDir, "shot_01.mp4"),
            timelineWindow: { targetDurationSec: 5, timelineStartSec: 0 },
          },
        ],
      };

      const result = await exportDraft({ manifest, baseDir });

      const meta = JSON.parse(
        fs.readFileSync(
          path.join(result.stagingDir, "draft_meta_info.json"),
          "utf-8",
        ),
      );
      // 特殊字符应被清理
      expect(meta.draft_name).not.toMatch(/[\\/:*?"<>|]/);
      expect(meta.draft_name).toBe("美白精华护肤-模板名称-年轻女性-居家-温馨");
    });

    test("截断超长名称到 50 字符", async () => {
      const manifest = {
        projectId: "project-1",
        variantId: "variant-1",
        templateId: "0211-1",
        productName: "超长商品名称测试产品一二三四五六七八九十",
        templateName: "模板名称测试模板",
        variantDimensions: {
          audience: "目标客群测试人群",
          scene: "场景测试场景",
          tone: "调性测试调性",
        },
        veoOutputs: [
          {
            shotId: "shot_01",
            status: "completed",
            rawClip: path.join(rawDir, "shot_01.mp4"),
            timelineWindow: { targetDurationSec: 5, timelineStartSec: 0 },
          },
        ],
      };

      const result = await exportDraft({ manifest, baseDir });

      const meta = JSON.parse(
        fs.readFileSync(
          path.join(result.stagingDir, "draft_meta_info.json"),
          "utf-8",
        ),
      );
      expect(meta.draft_name.length).toBeLessThanOrEqual(50);
    });
  });

  // ==================== Voice Changer 音频导出测试 ====================

  describe("buildAudioProtocolEntry", () => {
    const { buildAudioProtocolEntry } = require("./jianyingDraftExportService");

    test("returns null when no dub audioPath", async () => {
      const result = await buildAudioProtocolEntry({
        output: {
          shotId: "shot_01",
          dub: null,
        },
        resourcesDir: tempDir,
        draftId: "test-draft",
        targetDir: null,
      });

      expect(result).toBeNull();
    });

    test("returns null when dub mode is original", async () => {
      const result = await buildAudioProtocolEntry({
        output: {
          shotId: "shot_01",
          dub: {
            mode: "original",
            status: "completed",
            audioPath: "dubs/converted/shot_01.mp3",
            durationSec: 5,
          },
        },
        resourcesDir: tempDir,
        draftId: "test-draft",
        targetDir: null,
      });

      expect(result).toBeNull();
    });

    test("returns null when dub mode is off", async () => {
      const result = await buildAudioProtocolEntry({
        output: {
          shotId: "shot_01",
          dub: {
            mode: "off",
            status: "completed",
            audioPath: "dubs/converted/shot_01.mp3",
            durationSec: 5,
          },
        },
        resourcesDir: tempDir,
        draftId: "test-draft",
        targetDir: null,
      });

      expect(result).toBeNull();
    });

    test("returns null when dub status is not completed", async () => {
      const result = await buildAudioProtocolEntry({
        output: {
          shotId: "shot_01",
          dub: {
            mode: "sts",
            status: "pending",
            audioPath: "dubs/converted/shot_01.mp3",
            durationSec: 5,
          },
        },
        resourcesDir: tempDir,
        draftId: "test-draft",
        targetDir: null,
      });

      expect(result).toBeNull();
    });
  });

  describe("audio track export", () => {
    test("includes audio track when dub is present", async () => {
      const { probeVideo } = require("./videoPreprocess");
      probeVideo.mockResolvedValue({
        duration: 8,
        width: 720,
        height: 1280,
        codec: "h264",
      });

      // 创建测试音频文件
      const audioDir = path.join(baseDir, "dubs", "converted");
      fs.mkdirSync(audioDir, { recursive: true });
      const audioFile = path.join(audioDir, "shot_01.mp3");
      fs.writeFileSync(audioFile, "fake audio content");

      const manifest = {
        projectId: "project-1",
        variantId: "variant-1",
        templateId: "0211-1",
        veoOutputs: [
          {
            shotId: "shot_01",
            status: "completed",
            rawClip: path.join(rawDir, "shot_01.mp4"),
            timelineWindow: { targetDurationSec: 5, timelineStartSec: 0 },
            dub: {
              provider: "elevenlabs",
              mode: "sts",
              status: "completed",
              audioPath: audioFile,
              durationSec: 8,
            },
          },
        ],
      };

      const result = await exportDraft({ manifest, baseDir });

      const content = JSON.parse(
        fs.readFileSync(
          path.join(result.stagingDir, "draft_info.json"),
          "utf-8",
        ),
      );

      // 验证音频材料被添加
      expect(content.materials.audios).toBeDefined();
      expect(content.materials.audios).toHaveLength(1);
      expect(content.materials.audios[0]).toMatchObject({
        type: "extract_music",
        name: "dub_shot_01",
      });

      // 验证音频轨道被添加
      expect(content.tracks).toHaveLength(2);
      const audioTrack = content.tracks.find((t) => t.type === "audio");
      expect(audioTrack).toBeDefined();
      expect(audioTrack.segments).toHaveLength(1);
      expect(audioTrack.segments[0]).toMatchObject({
        target_timerange: {
          start: 0,
          duration: 5000000,
        },
        source_timerange: {
          start: 0,
          duration: 8000000,
        },
        clip: null,
        hdr_settings: null,
      });
    });

    test("mutes original video when dub mode is sts", async () => {
      const { probeVideo } = require("./videoPreprocess");
      probeVideo.mockResolvedValue({
        duration: 8,
        width: 720,
        height: 1280,
        codec: "h264",
      });

      // 创建测试音频文件
      const audioDir = path.join(baseDir, "dubs", "converted");
      fs.mkdirSync(audioDir, { recursive: true });
      const audioFile = path.join(audioDir, "shot_01.mp3");
      fs.writeFileSync(audioFile, "fake audio content");

      const manifest = {
        projectId: "project-1",
        variantId: "variant-1",
        templateId: "0211-1",
        veoOutputs: [
          {
            shotId: "shot_01",
            status: "completed",
            rawClip: path.join(rawDir, "shot_01.mp4"),
            timelineWindow: { targetDurationSec: 5, timelineStartSec: 0 },
            dub: {
              provider: "elevenlabs",
              mode: "sts",
              status: "completed",
              audioPath: audioFile,
              durationSec: 4.8,
            },
          },
        ],
      };

      const result = await exportDraft({ manifest, baseDir });

      const content = JSON.parse(
        fs.readFileSync(
          path.join(result.stagingDir, "draft_info.json"),
          "utf-8",
        ),
      );

      // 验证视频轨道的 volume 被设为 0
      const videoTrack = content.tracks.find((t) => t.type === "video");
      expect(videoTrack).toBeDefined();
      expect(videoTrack.segments[0].volume).toBe(0);
    });

    test("keeps original video audio when dub mode is original", async () => {
      const { probeVideo } = require("./videoPreprocess");
      probeVideo.mockResolvedValue({
        duration: 8,
        width: 720,
        height: 1280,
        codec: "h264",
      });

      const manifest = {
        projectId: "project-1",
        variantId: "variant-1",
        templateId: "0211-1",
        veoOutputs: [
          {
            shotId: "shot_01",
            status: "completed",
            rawClip: path.join(rawDir, "shot_01.mp4"),
            timelineWindow: { targetDurationSec: 5, timelineStartSec: 0 },
            dub: {
              mode: "original",
              status: "completed",
            },
          },
        ],
      };

      const result = await exportDraft({ manifest, baseDir });

      const content = JSON.parse(
        fs.readFileSync(
          path.join(result.stagingDir, "draft_info.json"),
          "utf-8",
        ),
      );

      // 验证视频轨道的 volume 保持为 1
      const videoTrack = content.tracks.find((t) => t.type === "video");
      expect(videoTrack).toBeDefined();
      expect(videoTrack.segments[0].volume).toBe(1);

      // 无音频轨道
      expect(content.tracks).toHaveLength(1);
    });
  });

  describe("subtitle track export", () => {
    test("includes subtitle text track when dub sourceText is present", async () => {
      const manifest = {
        projectId: "project-1",
        variantId: "variant-1",
        templateId: "0211-1",
        veoOutputs: [
          {
            shotId: "shot_01",
            status: "completed",
            rawClip: path.join(rawDir, "shot_01.mp4"),
            timelineWindow: {
              targetDurationSec: 5,
              timelineStartSec: 0,
            },
            dub: {
              sourceText: "字幕测试文案",
            },
          },
        ],
      };

      const result = await exportDraft({ manifest, baseDir });
      const content = JSON.parse(
        fs.readFileSync(
          path.join(result.stagingDir, "draft_info.json"),
          "utf-8",
        ),
      );

      expect(content.materials.texts).toHaveLength(1);
      expect(content.materials.texts[0]).toMatchObject({
        text: "字幕测试文案",
        type: "subtitle",
        alignment: 1,
      });

      const textTrack = content.tracks.find((track) => track.type === "text");
      expect(textTrack).toBeDefined();
      expect(textTrack.segments).toHaveLength(1);
      expect(textTrack.segments[0]).toMatchObject({
        target_timerange: {
          start: 0,
          duration: 5000000,
        },
        clip: {
          transform: {
            x: 0,
            y: -0.25,
          },
        },
      });
    });

    test("falls back to storyboard audio.content when dub sourceText is absent", async () => {
      jest.spyOn(variantDAO, "getVariant").mockReturnValue({
        storyboard: {
          blocks: [
            {
              shots: [
                {
                  shot_id: "shot_01",
                  audio: {
                    content: "来自 storyboard 的字幕",
                  },
                },
              ],
            },
          ],
        },
      });

      const manifest = {
        projectId: "project-1",
        variantId: "variant-1",
        templateId: "0211-1",
        veoOutputs: [
          {
            shotId: "shot_01",
            status: "completed",
            rawClip: path.join(rawDir, "shot_01.mp4"),
            timelineWindow: {
              targetDurationSec: 3.2,
              timelineStartSec: 0,
            },
          },
        ],
      };

      const result = await exportDraft({ manifest, baseDir });
      const content = JSON.parse(
        fs.readFileSync(
          path.join(result.stagingDir, "draft_info.json"),
          "utf-8",
        ),
      );

      expect(content.materials.texts).toHaveLength(1);
      expect(content.materials.texts[0].text).toBe("来自 storyboard 的字幕");
      expect(content.tracks.some((track) => track.type === "text")).toBe(true);
    });
  });
});
