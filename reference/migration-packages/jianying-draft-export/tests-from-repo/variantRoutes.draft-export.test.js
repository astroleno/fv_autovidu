const fs = require("fs");
const os = require("os");
const path = require("path");

jest.mock("../db/projectDAO", () => ({ findById: jest.fn() }));
jest.mock("../db/variantDAO", () => ({
  getVariant: jest.fn(),
  getVariantsByProject: jest.fn(),
  getVariantsByProjectWithFilters: jest.fn(),
  updateVariant: jest.fn(),
  updateProjectFission: jest.fn(),
  correctCompletedCount: jest.fn(),
  deleteVariant: jest.fn(),
}));
jest.mock("../services/pipelineOrchestrator", () => ({
  retryVariant: jest.fn(),
}));
jest.mock("../utils/strategyBriefState", () => ({
  parseStrategyBriefPayload: jest.fn(),
  hasUsableStrategyBrief: jest.fn(),
}));
jest.mock("../services/regionalLocalization", () => ({
  getRegionalLocalizationGuide: jest.fn(),
}));
jest.mock("../services/storyboardPackService", () => ({
  checkStaleStatus: jest.fn(),
  normalizePackMode: jest.fn((value) => (value === "veo3" ? "veo3" : "classic")),
  resolveStyleOptions: jest.fn(() => ({ region: "US" })),
  buildPromptDrafts: jest.fn(() => ["prompt-1"]),
  getPromptOverrides: jest.fn(() => ({})),
  getManifest: jest.fn(),
  savePromptOverride: jest.fn(() => ({ prompt: "saved prompt" })),
  updateVariantSummary: jest.fn(),
}));
jest.mock("../services/storyboardPackPlanner", () => ({
  isStoryboardPackEligible: jest.fn(),
}));
jest.mock("../services/jianyingDraftExportService", () => ({
  exportDraft: jest.fn(),
}));
jest.mock("../services/veoShotPipelineService", () => ({
  prepareReferences: jest.fn(),
  ensureVoiceWarmupManifest: jest.fn(),
  getPipelineStatus: jest.fn(),
  getRuntimeManifest: jest.fn(),
  saveRuntimeManifest: jest.fn(),
  savePromptOverride: jest.fn(),
  getRuntimeDir: jest.fn(),
  rebuildShotReference: jest.fn(),
  addShotReferenceAsset: jest.fn(),
  removeShotReferenceAsset: jest.fn(),
  retryShotReferenceAsset: jest.fn(),
  addCustomShotReferenceAsset: jest.fn(),
}));
jest.mock("../services/veoVideoProvider", () => ({
  buildRequest: jest.fn(),
  processSingleShot: jest.fn(),
}));
jest.mock("../services/veoPostprocessService", () => ({
  processAll: jest.fn(),
}));
jest.mock("../services/elevenLabsService", () => ({
  isConfigured: jest.fn(),
  ELEVENLABS_CONFIG_ERROR: "ElevenLabs API 未配置",
}));
jest.mock("../services/voiceChangerPipelineService", () => ({
  initVoiceDesign: jest.fn(),
  runVoiceDesign: jest.fn(),
  createVoiceFromDesign: jest.fn(),
  updateVoiceDesignConfig: jest.fn(),
  processShotDub: jest.fn(),
  queueDubUpdate: jest.fn(),
  getDubStatus: jest.fn(),
}));
jest.mock("../queue", () => ({
  add: jest.fn(),
  submit: jest.fn(),
}));

const projectDAO = require("../db/projectDAO");
const variantDAO = require("../db/variantDAO");
const pipelineOrchestrator = require("../services/pipelineOrchestrator");
const {
  parseStrategyBriefPayload,
  hasUsableStrategyBrief,
} = require("../utils/strategyBriefState");
const storyboardPackService = require("../services/storyboardPackService");
const storyboardPackPlanner = require("../services/storyboardPackPlanner");
const jianyingDraftExportService = require("../services/jianyingDraftExportService");
const veoShotPipelineService = require("../services/veoShotPipelineService");
const veoVideoProvider = require("../services/veoVideoProvider");
const veoPostprocessService = require("../services/veoPostprocessService");
const elevenLabsService = require("../services/elevenLabsService");
const voiceChangerPipelineService = require("../services/voiceChangerPipelineService");
const router = require("./variantRoutes");

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    downloadArgs: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    download(filePath, fileName) {
      this.downloadArgs = { filePath, fileName };
      return this;
    },
  };
}

function getFinalRouteHandler(path, method) {
  const layer = router.stack.find(
    (item) =>
      item.route &&
      item.route.path === path &&
      item.route.methods?.[method.toLowerCase()],
  );
  if (!layer) {
    throw new Error(`route not found: ${method} ${path}`);
  }
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function invoke(handler, req) {
  const res = createMockRes();
  let nextErr = null;
  try {
    await handler(req, res, (err) => {
      nextErr = err;
    });
  } catch (err) {
    nextErr = err;
  }
  if (nextErr) {
    throw nextErr;
  }
  return res;
}

describe("variantRoutes draft export", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    veoShotPipelineService.getRuntimeDir.mockReturnValue("/tmp/runtime");
    veoShotPipelineService.saveRuntimeManifest.mockResolvedValue();
    veoShotPipelineService.prepareReferences.mockResolvedValue({
      batchStatus: "prepared",
      shotReferences: [],
      veoOutputs: [],
    });
    veoShotPipelineService.ensureVoiceWarmupManifest.mockResolvedValue({
      batchStatus: "idle",
      shotReferences: [],
      veoOutputs: [],
      voiceDesign: null,
    });
    veoShotPipelineService.getPipelineStatus.mockResolvedValue({
      batchStatus: "prepared",
      shotReferences: [],
    });
    veoShotPipelineService.getRuntimeManifest.mockResolvedValue({
      batchStatus: "prepared",
      shotReferences: [],
      veoOutputs: [],
    });
    veoShotPipelineService.rebuildShotReference.mockResolvedValue({
      cropKeepCenterRatio: 0.5,
    });
    veoShotPipelineService.savePromptOverride.mockResolvedValue({
      prompt: "saved veo prompt",
      updatedShotIds: ["shot_01"],
      manifest: null,
    });
    veoShotPipelineService.addShotReferenceAsset.mockResolvedValue({
      shotReferences: [],
    });
    veoShotPipelineService.removeShotReferenceAsset.mockResolvedValue({
      shotReferences: [],
    });
    veoShotPipelineService.retryShotReferenceAsset.mockResolvedValue({
      shotReferences: [],
    });
    veoShotPipelineService.addCustomShotReferenceAsset.mockResolvedValue({
      shotReferences: [],
    });
    veoVideoProvider.buildRequest.mockResolvedValue({
      model: "veo-test",
      prompt: "shot prompt",
      primaryImage: "/tmp/ref.png",
      auxImages: [],
      uploadedAssets: [],
    });
    veoVideoProvider.processSingleShot.mockResolvedValue();
    veoPostprocessService.processAll.mockResolvedValue();
    elevenLabsService.isConfigured.mockReturnValue(true);
    voiceChangerPipelineService.initVoiceDesign.mockResolvedValue();
    voiceChangerPipelineService.runVoiceDesign.mockResolvedValue({
      generatedVoiceId: "generated-voice-1",
      previews: [],
    });
    voiceChangerPipelineService.createVoiceFromDesign.mockResolvedValue({
      voiceId: "voice-123",
      name: "UGC_Auto_variant-1",
    });
    voiceChangerPipelineService.updateVoiceDesignConfig.mockResolvedValue({
      voiceDescription: null,
    });
    voiceChangerPipelineService.processShotDub.mockResolvedValue({
      status: "completed",
      audioPath: "/tmp/dub.mp3",
    });
    voiceChangerPipelineService.queueDubUpdate.mockResolvedValue();
    projectDAO.findById.mockReturnValue({
      id: "project-1",
      name: "Demo",
      pipeline_status: "running",
      fission_config: JSON.stringify({ durationTarget: 15 }),
    });
    storyboardPackService.getManifest.mockResolvedValue(null);
    storyboardPackService.checkStaleStatus.mockResolvedValue({
      stale: false,
      reason: null,
    });
    storyboardPackPlanner.isStoryboardPackEligible.mockReturnValue({
      eligible: true,
      totalShots: 3,
      reason: null,
    });
  });

  test("GET /:id/variants reconciles legacy completed states and project pipeline status", async () => {
    variantDAO.getVariantsByProjectWithFilters.mockReturnValue([
      {
        id: "variant-1",
        project_id: "project-1",
        status: "interrupted",
        storyboard: {
          total_duration_sec: 15,
          total_shot_count: 3,
          storyboard_pack_summary: { status: "completed" },
        },
      },
      {
        id: "variant-2",
        project_id: "project-1",
        status: "failed",
        storyboard: null,
      },
    ]);
    projectDAO.findById
      .mockReturnValueOnce({
        id: "project-1",
        name: "Demo",
        pipeline_status: "running",
        total_variants: 2,
        completed_variants: 0,
        fission_config: JSON.stringify({ durationTarget: 15 }),
      })
      .mockReturnValueOnce({
        id: "project-1",
        name: "Demo",
        pipeline_status: "completed",
        total_variants: 2,
        completed_variants: 1,
        fission_config: JSON.stringify({ durationTarget: 15 }),
      });
    storyboardPackService.checkStaleStatus.mockResolvedValue({
      stale: true,
      reason: "storyboard changed",
    });

    const handler = getFinalRouteHandler("/:id/variants", "get");
    const res = await invoke(handler, {
      params: { id: "project-1" },
      query: { minShotCount: "3" },
    });

    expect(variantDAO.getVariantsByProjectWithFilters).toHaveBeenCalledWith(
      "project-1",
      { minShotCount: 3 },
    );
    expect(variantDAO.updateVariant).toHaveBeenCalledWith("variant-1", {
      status: "completed",
      completed_at: expect.any(Number),
    });
    expect(variantDAO.correctCompletedCount).toHaveBeenCalledWith("project-1");
    expect(variantDAO.updateProjectFission).toHaveBeenCalledWith("project-1", {
      pipeline_status: "completed",
    });
    expect(res.body.project).toMatchObject({
      pipeline_status: "completed",
      completed_variants: 1,
    });
    expect(res.body.variants[0].storyboard.storyboard_pack_summary).toMatchObject(
      { stale: true },
    );
  });

  test("POST retry returns 409 while variant is already generating", async () => {
    variantDAO.getVariant.mockReturnValue({
      id: "variant-1",
      project_id: "project-1",
    });
    pipelineOrchestrator.retryVariant.mockRejectedValue(
      new Error("当前变体正在生成中"),
    );

    const handler = getFinalRouteHandler("/:id/variants/:variantId/retry", "post");
    const res = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { durationTarget: 20 },
    });

    expect(pipelineOrchestrator.retryVariant).toHaveBeenCalledWith("variant-1", {
      durationTarget: 20,
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "当前变体正在生成中" });
  });

  test("PATCH strategy brief text skips update when strategy brief is unusable", async () => {
    variantDAO.getVariant.mockReturnValue({
      id: "variant-1",
      project_id: "project-1",
      strategy_brief: null,
    });
    parseStrategyBriefPayload.mockReturnValue({});
    hasUsableStrategyBrief.mockReturnValue(false);

    const handler = getFinalRouteHandler(
      "/:id/variants/:variantId/strategy-brief-text",
      "patch",
    );
    const res = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { text: "new summary" },
    });

    expect(res.body).toEqual({ success: true, skipped: true });
    expect(variantDAO.updateVariant).not.toHaveBeenCalled();
  });

  test("GET storyboard-pack returns manifest, summary, and prompt drafts", async () => {
    variantDAO.getVariant.mockReturnValue({
      id: "variant-1",
      project_id: "project-1",
      target_audience: "runners",
      scene: "gym",
      tone: "direct",
      storyboard: {
        total_shot_count: 3,
        storyboard_pack_summary: {
          status: "completed",
          last_generated_at: 1,
        },
      },
    });
    storyboardPackService.getManifest.mockResolvedValue({ pages: [1, 2] });
    storyboardPackService.checkStaleStatus.mockResolvedValue({
      stale: true,
      reason: "prompt changed",
    });

    const handler = getFinalRouteHandler(
      "/:id/variants/:variantId/storyboard-pack",
      "get",
    );
    const res = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      query: { aspectRatio: "16:9", packMode: "classic" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      eligible: true,
      manifest: { pages: [1, 2] },
      stale: true,
      staleReason: "prompt changed",
      promptDrafts: ["prompt-1"],
    });
  });

  test("GET veo-shot-pipeline returns runtime manifest status", async () => {
    veoShotPipelineService.getPipelineStatus.mockResolvedValue({
      batchStatus: "running",
      shotReferences: [{ shotId: "shot-1" }],
    });

    const handler = getFinalRouteHandler(
      "/:id/variants/:variantId/veo-shot-pipeline",
      "get",
    );
    const res = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
    });

    expect(res.body).toEqual({
      batchStatus: "running",
      shotReferences: [{ shotId: "shot-1" }],
    });
  });

  test("POST veo-shot-pipeline/run prepares references and returns startup payload", async () => {
    const manifest = {
      batchStatus: "prepared",
      shotReferences: [
        {
          shotId: "shot-1",
          prompt: "show product",
          referenceImage: "/tmp/ref.png",
          auxReferences: [],
        },
      ],
      veoOutputs: [],
    };
    veoShotPipelineService.prepareReferences.mockResolvedValue(manifest);
    veoShotPipelineService.getRuntimeManifest.mockResolvedValue(manifest);

    const handler = getFinalRouteHandler(
      "/:id/variants/:variantId/veo-shot-pipeline/run",
      "post",
    );
    const res = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: {
        aspectRatio: "16:9",
        veoModePreference: "frames",
        videoConcurrency: 2,
      },
    });

    expect(veoShotPipelineService.prepareReferences).toHaveBeenCalledWith({
      projectId: "project-1",
      variantId: "variant-1",
      track: undefined,
      aspectRatio: "16:9",
      veoModePreference: "frames",
      requireSourceGrid: true,
    });
    expect(res.body).toMatchObject({
      status: "prepared",
      manifest,
    });
  });

  test("POST veo-shot-pipeline/run keeps other shots running when one buildRequest fails", async () => {
    let runtimeManifest = {
      batchStatus: "prepared",
      shotReferences: [
        {
          shotId: "shot-fail",
          prompt: "fail this shot",
          referenceImage: "/tmp/fail.png",
          auxReferences: [],
        },
        {
          shotId: "shot-ok",
          prompt: "keep this shot running",
          referenceImage: "/tmp/ok.png",
          auxReferences: [],
        },
      ],
      veoOutputs: [
        { shotId: "shot-fail", status: "pending" },
        { shotId: "shot-ok", status: "pending" },
      ],
      veoRequests: [],
    };

    veoShotPipelineService.prepareReferences.mockResolvedValue(runtimeManifest);
    veoShotPipelineService.getRuntimeManifest.mockImplementation(async () =>
      JSON.parse(JSON.stringify(runtimeManifest)),
    );
    veoShotPipelineService.saveRuntimeManifest.mockImplementation(
      async (_projectId, _variantId, manifest) => {
        runtimeManifest = JSON.parse(JSON.stringify(manifest));
      },
    );
    veoVideoProvider.buildRequest.mockImplementation(async ({ prompt }) => {
      if (prompt.includes("fail")) {
        throw new Error("mock build failure");
      }
      return {
        model: "veo-test",
        prompt,
        primaryImage: "/tmp/ref.png",
        auxImages: [],
        uploadedAssets: [],
      };
    });
    veoVideoProvider.processSingleShot.mockImplementation(
      async ({ shotRef, onUpdate }) => {
        const nextManifest = JSON.parse(JSON.stringify(runtimeManifest));
        nextManifest.veoOutputs = (nextManifest.veoOutputs || []).map((item) =>
          item.shotId === shotRef.shotId
            ? { ...item, status: "completed", rawClip: `/tmp/${shotRef.shotId}.mp4` }
            : item,
        );
        await onUpdate(nextManifest);
      },
    );

    const handler = getFinalRouteHandler(
      "/:id/variants/:variantId/veo-shot-pipeline/run",
      "post",
    );
    const res = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: {
        aspectRatio: "16:9",
        veoModePreference: "frames",
        videoConcurrency: 2,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("prepared");

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(veoVideoProvider.buildRequest).toHaveBeenCalledTimes(2);
    expect(veoVideoProvider.processSingleShot).toHaveBeenCalledTimes(1);
    expect(veoPostprocessService.processAll).toHaveBeenCalledTimes(1);
    expect(runtimeManifest.veoOutputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          shotId: "shot-fail",
          status: "failed",
          error: "mock build failure",
        }),
        expect.objectContaining({
          shotId: "shot-ok",
          status: "completed",
          rawClip: "/tmp/shot-ok.mp4",
        }),
      ]),
    );
  });

  test("POST veo-shot-pipeline/run auto-prepares voice and triggers STS after shot completion", async () => {
    variantDAO.getVariant.mockReturnValue({
      id: "variant-1",
      project_id: "project-1",
      target_audience: "年轻妈妈",
      scene: "gym",
      scene_detail: "家庭晨间收纳与通勤切换",
      tone: "direct",
      tone_detail: "像闺蜜经验分享一样自然真诚",
    });
    projectDAO.findById.mockReturnValue({
      id: "project-1",
      name: "Demo",
      pipeline_status: "running",
      fission_config: JSON.stringify({
        durationTarget: 15,
        audienceDetails: {
          年轻妈妈: "注重精致育儿与高效通勤的城市宝妈",
        },
      }),
    });

    let runtimeManifest = {
      batchStatus: "prepared",
      shotReferences: [
        {
          shotId: "shot-ok",
          prompt: "keep this shot running",
          referenceImage: "/tmp/ok.png",
          auxReferences: [],
        },
      ],
      veoOutputs: [{ shotId: "shot-ok", status: "pending" }],
      veoRequests: [],
      variantDimensions: {
        audience: "年轻妈妈",
      },
    };

    veoShotPipelineService.prepareReferences.mockResolvedValue(runtimeManifest);
    veoShotPipelineService.getRuntimeManifest.mockImplementation(async () =>
      JSON.parse(JSON.stringify(runtimeManifest)),
    );
    veoShotPipelineService.saveRuntimeManifest.mockImplementation(
      async (_projectId, _variantId, manifest) => {
        runtimeManifest = JSON.parse(JSON.stringify(manifest));
      },
    );
    veoVideoProvider.processSingleShot.mockImplementation(
      async ({ shotRef, onUpdate }) => {
        const nextManifest = JSON.parse(JSON.stringify(runtimeManifest));
        nextManifest.veoOutputs = (nextManifest.veoOutputs || []).map((item) =>
          item.shotId === shotRef.shotId
            ? { ...item, status: "completed", rawClip: `/tmp/${shotRef.shotId}.mp4` }
            : item,
        );
        await onUpdate(nextManifest);
      },
    );

    const handler = getFinalRouteHandler(
      "/:id/variants/:variantId/veo-shot-pipeline/run",
      "post",
    );
    const res = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: {
        aspectRatio: "16:9",
        veoModePreference: "frames",
      },
    });

    expect(res.statusCode).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(voiceChangerPipelineService.runVoiceDesign).toHaveBeenCalledWith(
      "project-1",
      "variant-1",
      "客群：年轻妈妈；客群说明：注重精致育儿与高效通勤的城市宝妈，场景详情：家庭晨间收纳与通勤切换，场景：gym，语气详情：像闺蜜经验分享一样自然真诚，语气：direct",
    );
    expect(
      voiceChangerPipelineService.createVoiceFromDesign,
    ).toHaveBeenCalledWith(
      "project-1",
      "variant-1",
      "generated-voice-1",
      "UGC_Auto_variant-",
    );
    expect(voiceChangerPipelineService.processShotDub).toHaveBeenCalledWith(
      "project-1",
      "variant-1",
      "shot-ok",
      {
        voiceId: "voice-123",
        mode: "sts",
      },
    );
  });

  test("POST voice-design/auto starts background warmup and returns designing state", async () => {
    variantDAO.getVariant.mockReturnValue({
      id: "variant-1",
      project_id: "project-1",
      target_audience: "年轻妈妈",
    });
    projectDAO.findById.mockReturnValue({
      id: "project-1",
      name: "Demo",
      pipeline_status: "running",
      fission_config: JSON.stringify({
        audienceDetails: {
          年轻妈妈: "注重精致育儿与高效通勤的城市宝妈",
        },
      }),
    });
    let runtimeManifest = {
      batchStatus: "idle",
      shotReferences: [],
      veoOutputs: [],
      voiceDesign: null,
      variantDimensions: {
        audience: "年轻妈妈",
      },
      variantDimensionDetails: {
        audience: "注重精致育儿与高效通勤的城市宝妈",
      },
    };
    veoShotPipelineService.ensureVoiceWarmupManifest.mockResolvedValue(runtimeManifest);
    veoShotPipelineService.getRuntimeManifest.mockImplementation(async () =>
      JSON.parse(JSON.stringify(runtimeManifest)),
    );
    veoShotPipelineService.saveRuntimeManifest.mockImplementation(
      async (_projectId, _variantId, manifest) => {
        runtimeManifest = JSON.parse(JSON.stringify(manifest));
      },
    );

    const handler = getFinalRouteHandler(
      "/:id/variants/:variantId/voice-design/auto",
      "post",
    );
    const res = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("designing");

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(voiceChangerPipelineService.runVoiceDesign).toHaveBeenCalledWith(
      "project-1",
      "variant-1",
      "客群：年轻妈妈；客群说明：注重精致育儿与高效通勤的城市宝妈",
    );
    expect(voiceChangerPipelineService.createVoiceFromDesign).toHaveBeenCalled();
  });

  test("POST retry-shot returns 400/404 validation errors and success payload", async () => {
    const handler = getFinalRouteHandler(
      "/:id/variants/:variantId/veo-shot-pipeline/retry-shot",
      "post",
    );

    const missingShotId = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: {},
    });
    expect(missingShotId.statusCode).toBe(400);

    veoShotPipelineService.getRuntimeManifest.mockResolvedValueOnce(null);
    const missingManifest = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { shotId: "shot-1" },
    });
    expect(missingManifest.statusCode).toBe(404);

    veoShotPipelineService.getRuntimeManifest.mockResolvedValueOnce({
      shotReferences: [],
      veoOutputs: [],
    });
    const missingShot = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { shotId: "shot-404" },
    });
    expect(missingShot.statusCode).toBe(404);

    const manifest = {
      shotReferences: [
        {
          shotId: "shot-1",
          prompt: "show product",
          referenceImage: "/tmp/ref.png",
          auxReferences: [],
        },
      ],
      veoOutputs: [{ shotId: "shot-1", status: "failed" }],
      veoRequests: [],
      result: { stale: false },
      veoModePreference: "auto",
    };
    veoShotPipelineService.getRuntimeManifest
      .mockResolvedValueOnce(manifest)
      .mockResolvedValueOnce(manifest)
      .mockResolvedValueOnce(manifest);

    const success = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { shotId: "shot-1" },
    });

    expect(success.statusCode).toBe(200);
    expect(success.body).toMatchObject({
      shotId: "shot-1",
      status: "pending",
    });
    expect(veoShotPipelineService.saveRuntimeManifest).toHaveBeenCalled();
  });

  test("PUT veo-shot-pipeline/prompt saves prompt override", async () => {
    const handler = getFinalRouteHandler(
      "/:id/variants/:variantId/veo-shot-pipeline/prompt",
      "put",
    );

    variantDAO.getVariant.mockReturnValue({
      id: "variant-1",
      project_id: "project-1",
      storyboard: { blocks: [{ shots: [{ shot_id: "shot_01", prompt: "demo" }] }] },
    });

    const success = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: {
        shotId: "shot_01",
        promptType: "veo_video",
        prompt: "custom veo prompt",
        aspectRatio: "9:16",
      },
    });

    expect(success.statusCode).toBe(200);
    expect(veoShotPipelineService.savePromptOverride).toHaveBeenCalledWith({
      projectId: "project-1",
      variantId: "variant-1",
      shotId: "shot_01",
      promptType: "veo_video",
      prompt: "custom veo prompt",
      aspectRatio: "9:16",
    });
    expect(success.body).toMatchObject({
      success: true,
      shotId: "shot_01",
      promptType: "veo_video",
      prompt: "saved veo prompt",
      updatedShotIds: ["shot_01"],
    });
  });

  test("POST rebuild-reference validates input and translates known not-found errors", async () => {
    const handler = getFinalRouteHandler(
      "/:id/variants/:variantId/veo-shot-pipeline/rebuild-reference",
      "post",
    );

    const missingShot = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { keepCenterRatio: 0.4 },
    });
    expect(missingShot.statusCode).toBe(400);

    const missingRatio = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { shotId: "shot-1" },
    });
    expect(missingRatio.statusCode).toBe(400);

    veoShotPipelineService.rebuildShotReference.mockRejectedValueOnce(
      new Error("Shot 不存在"),
    );
    const notFound = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { shotId: "shot-404", keepCenterRatio: 0.6 },
    });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.body).toEqual({ error: "Shot 不存在" });

    veoShotPipelineService.rebuildShotReference.mockResolvedValueOnce({
      cropKeepCenterRatio: 0.75,
      shotId: "shot-1",
    });
    const success = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { shotId: "shot-1", keepCenterRatio: 0.75 },
    });
    expect(success.body).toEqual({
      shotId: "shot-1",
      keepCenterRatio: 0.75,
      manifest: { cropKeepCenterRatio: 0.75, shotId: "shot-1" },
    });
  });

  test("POST reference-assets add/remove/retry validates input and returns payload", async () => {
    const addHandler = getFinalRouteHandler(
      "/:id/variants/:variantId/veo-shot-pipeline/reference-assets/add",
      "post",
    );
    const removeHandler = getFinalRouteHandler(
      "/:id/variants/:variantId/veo-shot-pipeline/reference-assets/remove",
      "post",
    );
    const retryHandler = getFinalRouteHandler(
      "/:id/variants/:variantId/veo-shot-pipeline/reference-assets/retry",
      "post",
    );

    const missingRole = await invoke(addHandler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { shotId: "shot-1" },
    });
    expect(missingRole.statusCode).toBe(400);

    veoShotPipelineService.addShotReferenceAsset.mockRejectedValueOnce(
      new Error("Shot 不存在"),
    );
    const addNotFound = await invoke(addHandler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { shotId: "shot-404", role: "product" },
    });
    expect(addNotFound.statusCode).toBe(404);

    veoShotPipelineService.addShotReferenceAsset.mockResolvedValueOnce({
      batchStatus: "prepared",
    });
    const addSuccess = await invoke(addHandler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { shotId: "shot-1", role: "product" },
    });
    expect(addSuccess.body).toEqual({
      shotId: "shot-1",
      role: "product",
      manifest: { batchStatus: "prepared" },
    });

    veoShotPipelineService.removeShotReferenceAsset.mockResolvedValueOnce({
      batchStatus: "prepared",
    });
    const removeSuccess = await invoke(removeHandler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { shotId: "shot-1", role: "end_frame" },
    });
    expect(removeSuccess.body).toEqual({
      shotId: "shot-1",
      role: "end_frame",
      manifest: { batchStatus: "prepared" },
    });

    veoShotPipelineService.retryShotReferenceAsset.mockResolvedValueOnce({
      batchStatus: "prepared",
    });
    const retrySuccess = await invoke(retryHandler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { shotId: "shot-1", role: "start_frame" },
    });
    expect(retrySuccess.body).toEqual({
      shotId: "shot-1",
      role: "start_frame",
      manifest: { batchStatus: "prepared" },
    });
  });

  test("POST reference-assets/custom validates input and returns payload", async () => {
    const handler = getFinalRouteHandler(
      "/:id/variants/:variantId/veo-shot-pipeline/reference-assets/custom",
      "post",
    );

    const missingBody = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { shotId: "shot-1", role: "start_frame" },
    });
    expect(missingBody.statusCode).toBe(400);

    veoShotPipelineService.addCustomShotReferenceAsset.mockResolvedValueOnce({
      batchStatus: "prepared",
    });
    const success = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: {
        shotId: "shot-1",
        role: "start_frame",
        filename: "custom.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,ZmFrZQ==",
      },
    });
    expect(success.body).toMatchObject({
      shotId: "shot-1",
      role: "start_frame",
      manifest: { batchStatus: "prepared" },
    });
  });

  test("DELETE variant removes record and refreshes completed count", async () => {
    variantDAO.getVariant.mockReturnValue({
      id: "variant-1",
      project_id: "project-1",
    });

    const handler = getFinalRouteHandler("/:id/variants/:variantId", "delete");
    const res = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
    });

    expect(variantDAO.deleteVariant).toHaveBeenCalledWith("variant-1");
    expect(variantDAO.correctCompletedCount).toHaveBeenCalledWith("project-1");
    expect(res.body).toEqual({ success: true });
  });

  test("POST jianying-draft returns translated validation error for invalid draftPath", async () => {
    const manifest = { projectId: "project-1", variantId: "variant-1" };
    veoShotPipelineService.getRuntimeManifest.mockImplementation(() =>
      Promise.resolve(manifest),
    );
    jianyingDraftExportService.exportDraft.mockRejectedValue(
      new Error("Draft target path contains invalid characters"),
    );

    const handler = getFinalRouteHandler(
      "/:id/variants/:variantId/veo-shot-pipeline/jianying-draft",
      "post",
    );
    const res = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { draftPath: "/tmp/bad:*path", createZip: false },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: "validation_error",
        message: "请求验证失败",
        details: [
          {
            field: "draftPath",
            message: "draftPath 包含非法字符",
          },
        ],
      },
    });
    expect(veoShotPipelineService.saveRuntimeManifest).toHaveBeenCalledTimes(2);
    expect(veoShotPipelineService.saveRuntimeManifest).toHaveBeenLastCalledWith(
      "project-1",
      "variant-1",
      expect.objectContaining({
        draftExport: expect.objectContaining({
          status: "error",
          error: "Draft target path contains invalid characters",
        }),
      }),
    );
  });

  test("POST jianying-draft returns 422 when no shots can be exported", async () => {
    const manifest = { projectId: "project-1", variantId: "variant-1" };
    veoShotPipelineService.getRuntimeManifest.mockResolvedValue(manifest);
    jianyingDraftExportService.exportDraft.mockRejectedValue(
      new Error("没有可导出的已完成 shots"),
    );

    const handler = getFinalRouteHandler(
      "/:id/variants/:variantId/veo-shot-pipeline/jianying-draft",
      "post",
    );
    const res = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { createZip: true },
    });

    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({
      error: {
        code: "no_exportable_shots",
        message: "没有可导出的已完成镜头",
      },
    });
  });

  test("POST jianying-draft returns success payload and persists manifest", async () => {
    const manifest = { projectId: "project-1", variantId: "variant-1" };
    veoShotPipelineService.getRuntimeManifest.mockResolvedValue(manifest);
    jianyingDraftExportService.exportDraft.mockResolvedValue({
      draftId: "draft-1",
      draftDir: "/tmp/draft-1",
      zipPath: "/tmp/draft-1.zip",
      exportedAt: 123456,
      mode: "jianying_timeline_from_raw",
      targetPath: "/tmp",
      missingShots: [],
      warning: null,
    });

    const handler = getFinalRouteHandler(
      "/:id/variants/:variantId/veo-shot-pipeline/jianying-draft",
      "post",
    );
    const res = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { createZip: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      data: expect.objectContaining({
        status: "success",
        draftId: "draft-1",
        zipPath: "/tmp/draft-1.zip",
        mode: "jianying_timeline_from_raw",
      }),
      meta: {
        message: "视频打包完成",
      },
    });
    expect(veoShotPipelineService.saveRuntimeManifest).toHaveBeenCalledTimes(2);
    expect(manifest.draftExport).toMatchObject({
      status: "success",
      draftId: "draft-1",
      zipPath: "/tmp/draft-1.zip",
    });
  });

  test("POST jianying-draft returns zip-specific failure message for zip-only export", async () => {
    const manifest = { projectId: "project-1", variantId: "variant-1" };
    veoShotPipelineService.getRuntimeManifest.mockResolvedValue(manifest);
    jianyingDraftExportService.exportDraft.mockRejectedValue(
      new Error("unexpected zip failure"),
    );

    const handler = getFinalRouteHandler(
      "/:id/variants/:variantId/veo-shot-pipeline/jianying-draft",
      "post",
    );
    const res = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
      body: { createZip: true },
    });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: {
        code: "export_failed",
        message: "视频打包失败",
      },
    });
  });

  test("GET zip download route returns res.download for existing zip", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ugcflow-zip-download-"));
    const runtimeDir = path.join(tempDir, "runtime");
    const exportDir = path.join(runtimeDir, "draft-export");
    const zipPath = path.join(exportDir, "demo.zip");
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(zipPath, "zip");

    veoShotPipelineService.getRuntimeDir.mockReturnValue(runtimeDir);
    veoShotPipelineService.getRuntimeManifest.mockResolvedValue({
      draftExport: {
        zipPath,
      },
    });

    const handler = getFinalRouteHandler(
      "/:id/variants/:variantId/veo-shot-pipeline/jianying-draft/download-zip",
      "get",
    );
    const res = await invoke(handler, {
      params: { id: "project-1", variantId: "variant-1" },
    });

    expect(res.downloadArgs).toEqual({
      filePath: zipPath,
      fileName: "demo.zip",
    });

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
