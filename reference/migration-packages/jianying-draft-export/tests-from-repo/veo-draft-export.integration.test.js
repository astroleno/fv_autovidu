const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  createTestEnv,
  createFixture,
  startServer,
  stopServer,
  cleanupTestEnv,
} = require("../../../scripts/test/veoTestHarness");

const TEST_TIMEOUT = 120000;
const describeIfServerIntegration =
  process.env.RUN_SERVER_INTEGRATION === "1" ? describe : describe.skip;

async function getJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

function createMockClip(targetPath, ffmpegPath = "ffmpeg") {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  execFileSync(
    ffmpegPath,
    [
      "-f",
      "lavfi",
      "-i",
      "color=c=#445566:s=720x1280:r=24",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-y",
      targetPath,
    ],
    { stdio: "pipe" },
  );
}

function writeCompletedManifest({ testEnv, fixture }) {
  const runtimeDir = path.join(
    testEnv.publicDir,
    "project",
    fixture.projectId,
    "variants",
    fixture.variantId,
    "veo-shot-pipeline",
  );
  const rawDir = path.join(runtimeDir, "clips", "raw");
  const rawShot1 = path.join(rawDir, "shot_01.mp4");
  const rawShot2 = path.join(rawDir, "shot_02.mp4");
  createMockClip(rawShot1, testEnv.env.FFMPEG_PATH || "ffmpeg");
  createMockClip(rawShot2, testEnv.env.FFMPEG_PATH || "ffmpeg");

  const manifest = {
    projectId: fixture.projectId,
    variantId: fixture.variantId,
    templateId: fixture.templateId,
    templateClass: "supported",
    batchStatus: "completed",
    shotReferences: [],
    veoOutputs: [
      {
        shotId: "shot_01",
        status: "completed",
        rawClip: rawShot1,
        timelineWindow: {
          sourceStartSec: 0,
          sourceEndSec: 0.8,
          targetDurationSec: 0.8,
          timelineStartSec: 0,
          timelineEndSec: 0.8,
          observedDurationSec: 1,
        },
        generatedDurationSec: 1,
      },
      {
        shotId: "shot_02",
        status: "completed",
        rawClip: rawShot2,
        timelineWindow: {
          sourceStartSec: 0,
          sourceEndSec: 0.7,
          targetDurationSec: 0.7,
          timelineStartSec: 0.8,
          timelineEndSec: 1.5,
          observedDurationSec: 1,
        },
        generatedDurationSec: 1,
      },
    ],
  };

  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  return { runtimeDir };
}

describeIfServerIntegration("VEO Jianying draft export API integration", () => {
  let testEnv;
  let server;

  afterEach(async () => {
    await stopServer(server?.serverProcess, server?.logStream);
    if (testEnv) {
      await cleanupTestEnv(testEnv);
    }
    server = null;
    testEnv = null;
  });

  test(
    "GET jianying-draft returns 404 when manifest does not exist",
    async () => {
      testEnv = await createTestEnv("veo-draft-export-404");
      server = await startServer(testEnv);

      const result = await getJson(
        `${testEnv.baseUrl}/api/projects/project-missing/variants/variant-missing/veo-shot-pipeline/jianying-draft`,
      );

      expect(result.status).toBe(404);
      expect(result.body.error).toMatchObject({
        code: "variant_not_found",
        message: "变体不存在",
      });
    },
    TEST_TIMEOUT,
  );

  test(
    "POST jianying-draft returns 400 when both draftPath and createZip are empty",
    async () => {
      testEnv = await createTestEnv("veo-draft-export-400");
      const fixture = await createFixture({ env: testEnv.env, shotCount: 2 });
      writeCompletedManifest({ testEnv, fixture });
      server = await startServer(testEnv);

      const result = await postJson(
        `${testEnv.baseUrl}/api/projects/${fixture.projectId}/variants/${fixture.variantId}/veo-shot-pipeline/jianying-draft`,
        {},
      );

      expect(result.status).toBe(400);
      expect(result.body.error).toMatchObject({
        code: "validation_error",
        message: "请求验证失败",
      });
      expect(result.body.error.details).toEqual([
        {
          field: "draftPath",
          message: "至少提供 draftPath 或启用 createZip",
        },
      ]);
    },
    TEST_TIMEOUT,
  );

  test(
    "POST jianying-draft succeeds and persists draftExport into manifest",
    async () => {
      testEnv = await createTestEnv("veo-draft-export-success");
      const fixture = await createFixture({ env: testEnv.env, shotCount: 2 });
      const { runtimeDir } = writeCompletedManifest({ testEnv, fixture });
      server = await startServer(testEnv);

      const exportResult = await postJson(
        `${testEnv.baseUrl}/api/projects/${fixture.projectId}/variants/${fixture.variantId}/veo-shot-pipeline/jianying-draft`,
        { createZip: true },
      );

      expect(exportResult.status).toBe(200);
      expect(exportResult.body.meta).toMatchObject({
        message: "视频打包完成",
      });
      expect(exportResult.body.data).toMatchObject({
        status: "success",
        mode: "jianying_timeline_from_raw",
      });
      expect(exportResult.body.data.zipPath).toBeTruthy();

      const manifest = JSON.parse(
        fs.readFileSync(path.join(runtimeDir, "manifest.json"), "utf-8"),
      );

      expect(manifest.draftExport).toMatchObject({
        status: "success",
        mode: "jianying_timeline_from_raw",
      });
      expect(fs.existsSync(manifest.draftExport.zipPath)).toBe(true);

      const getResult = await getJson(
        `${testEnv.baseUrl}/api/projects/${fixture.projectId}/variants/${fixture.variantId}/veo-shot-pipeline/jianying-draft`,
      );
      expect(getResult.status).toBe(200);
      expect(getResult.body.data).toMatchObject({
        status: "success",
        mode: "jianying_timeline_from_raw",
      });
    },
    TEST_TIMEOUT,
  );

  test(
    "legacy export-jianying-draft route stays compatible",
    async () => {
      testEnv = await createTestEnv("veo-draft-export-legacy");
      const fixture = await createFixture({ env: testEnv.env, shotCount: 2 });
      writeCompletedManifest({ testEnv, fixture });
      server = await startServer(testEnv);

      const result = await getJson(
        `${testEnv.baseUrl}/api/projects/${fixture.projectId}/variants/${fixture.variantId}/veo-shot-pipeline/export-jianying-draft`,
      );

      expect(result.status).toBe(200);
      expect(result.body).toHaveProperty("data");
    },
    TEST_TIMEOUT,
  );
});
