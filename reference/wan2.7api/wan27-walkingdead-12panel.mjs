/**
 * 万相 Wan 2.7：行尸走肉主题 — 多参考图按序传入 + 十二镜叙事组图（竖幅 1080×1920）。
 *
 * 参考图顺序（与 `public/assets/行尸走肉/` 内文件对应，文首仅 image1…image8 指代）：
 *   image1=汽车内部 → image2=达里尔 → image3=格雷·金斯顿 → image4=卡尔 →
 *   image5=汽车 → image6=监狱外围 → image7=格伦 → image8=行尸
 *
 * `content`：先按上列顺序追加各 `image`，最后一条为 `text`（主提示词）。
 * 输出：`output/wan27-walkingdead-runs/<时间戳>/`，不覆盖历史。
 *
 * 计时：从「开始构建请求」到「全部下载完成」打印秒数，并给出与 5 张组图的粗略倍数参考。
 *
 * 可选环境变量：
 *   - `WAN27_TWD_MAX_EDGE`：默认在 macOS 下将参考图最长边缩至 1280px（`sips`），减小 Base64 体积、避免上传阶段 Headers 超时；设为 `0` 则原图上传。
 *   - `WAN27_TWD_USE_ORIGINAL_PROMPT=1`：使用原版分镜文案（更易触发内容审核）。
 *   - `WAN27_TWD_OMIT_REF8=1`：仅上传前 7 张参考图，不传第 8 张（若仍因远景「行尸」参考触审可试）。
 *   - `WAN27_REF_5PANEL_SEC`：与 5 张组图耗时对比时的基准秒数（默认 140）。
 *
 * 用法：
 *   npm run build && node --env-file=.env scripts/wan27-walkingdead-12panel.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  Wan27Client,
  extractImageUrlsFromTaskResponse,
  loadDashscopeApiKeyFromEnv,
  resolveDashscopeBaseUrl,
} from "../dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

/** 供 `catch` 打印失败前总耗时（毫秒时间戳） */
let runStartMs = 0;

const ASSET_DIR = join(REPO_ROOT, "public", "assets", "行尸走肉");

/**
 * 参考图文件路径（顺序固定，与文首 image1…image8 一致）。
 * 说明：卡罗尔无单独素材，由模型依剧情推断。
 */
const REF_FILES = [
  join(ASSET_DIR, "汽车内部.png"),
  join(ASSET_DIR, "达里尔.png"),
  join(ASSET_DIR, "格雷·金斯顿.png"),
  join(ASSET_DIR, "卡尔.png"),
  join(ASSET_DIR, "汽车.png"),
  join(ASSET_DIR, "监狱外围.png"),
  join(ASSET_DIR, "格伦.jpg"),
  join(ASSET_DIR, "行尸.png"),
];

const SIZE = "1080*1920";

/**
 * 审核友好默认文案：十二镜结构不变，弱化血腥、武器直述、惊悚词；场景用语中性化。
 * 原版分镜见 `PROMPT_ORIGINAL`（`WAN27_TWD_USE_ORIGINAL_PROMPT=1`）。
 */
const HEADER_REF_8 = `参考（与上传顺序一致）：image1=车内环境，image2=驾驶员形象，image3=女性乘客，image4=少年乘客，image5=车辆外观，image6=围合设施外景，image7=接应人员形象，image8=旷野远景氛围。

电影感竖幅叙事组图共 12 张，9:16，无字幕、无画面内文字。整体风格克制、写实、偏文艺末世，避免过度刺激画面。【竖构图】竖屏全屏、纵向层次为主。`;

const HEADER_REF_7 = `参考（与上传顺序一致，共 7 张）：image1=车内环境，image2=驾驶员形象，image3=女性乘客，image4=少年乘客，image5=车辆外观，image6=围合设施外景，image7=接应人员形象。

电影感竖幅叙事组图共 12 张，9:16，无字幕、无画面内文字。整体风格克制、写实、偏文艺末世。【竖构图】竖屏全屏、纵向层次为主。`;

const PROMPT_ORIGINAL = `参考：image1=汽车内部，image2=达里尔，image3=格雷·金斯顿，image4=卡尔，image5=汽车，image6=监狱外围，image7=格伦，image8=行尸。

电影感竖幅叙事组图共 12 张，9:16，无字幕、无画面内文字。【竖构图】竖屏全屏、纵向层次为主。

场景一：汽车内部（行驶中）

Shot 1（车内全景/中景）：破旧的越野车在颠簸的土路上快速行驶，车厢内剧烈摇晃。坐在驾驶座上的达里尔双手紧握方向盘，目光直视前方，脸上的表情冷峻而麻木。

Shot 2（后排近景/特写）：坐在汽车后排的格雷正满头大汗地处理大腿上的撕裂伤。她双手紧紧抓着一件沾着污渍的衬衫，用力将其缠绕在流血的伤口上充当止血带。

Shot 3（卡尔近景/特写）：坐在格雷身旁的卡尔转过头注视着她。卡尔看着格雷狼狈却坚韧的动作，嘴角微微上扬，轻轻摇了摇头。

Shot 4（格雷近景/特写）：格雷猛地拉紧腿上的衬衫打成死结。她紧咬牙关，眉头痛苦地皱起，身体因为剧痛而微微颤抖，但硬生生地憋回了痛苦的表情。

Shot 5（卡尔中景）：卡尔将视线从格雷身上移开，转头望向车窗外。他脸上的笑容逐渐消失，眼神变得异常严肃，并抬起手臂指向前方的某个目标。

Shot 6（格雷中景）：格雷顺着卡尔手指的方向，将上半身缓缓探向车窗。她的视线穿过满是灰尘的玻璃，专心地望向道路尽头的远方。

场景二：监狱外围（连续）

Shot 7（主观视角/远景）：远处的地平线上出现了一座宏伟而压抑的监狱建筑群。高耸的铁丝网围墙和坚固的瞭望塔映入眼帘，格雷因震惊而不由自主地瞪大了双眼。

Shot 8（室外全景）：越野车卷起一阵尘土，径直驶向监狱外围紧闭的铁网大门。在车外开阔的荒野中，几只衣衫褴褛的丧尸正漫无目的地在远处游荡。

Shot 9（门内中景）：在监狱大门内部的空地上，格伦和卡罗尔正保持着高度戒备的状态。两人各自紧握着手中的步枪与近战武器，神情紧张地向着大门的方向快步走来。

Shot 10（车窗近景）：卡尔迅速摇下身侧的车窗。他将大半个身子探出窗外，用力地挥动着右臂，向铁网另一侧的同伴发送安全抵达的信号。

Shot 11（格伦动作特写/中景）：确认来人身份后，格伦立刻收起武器，转身跑向大门旁的控制装置。他双臂发力，用力拉动粗糙的滑轮组绳索，缓缓开启沉重的第一道铁丝网门。

Shot 12（室外全景）：随着第一道铁门完全开启，达里尔踩下油门。沾满泥污的越野车伴随着低沉的发动机轰鸣声，平稳地驶入监狱内部的安全区域。`;

/**
 * 十二镜正文（与 HEADER_REF_8 / HEADER_REF_7 拼接）。刻意避免：直写枪械、流血、丧尸、监狱等易触审词。
 */
const PROMPT_COMPLIANCE_BODY = `

场景一：汽车内部（行驶中）

Shot 1（车内全景/中景）：旧越野车在颠簸土路上行驶，车厢随路面起伏。驾驶座男性（气质参考 image2）双手扶稳方向盘，目视前方，神情沉稳专注。

Shot 2（后排近景/特写）：后排女性（气质参考 image3）正低头处理腿部不适，用一件旧衬衫在腿部打结固定，动作急促但克制，额角有汗。

Shot 3（少年近景/特写）：邻座少年（气质参考 image4）侧头看她，目光温和，嘴角轻扬、微微摇头，带一点无奈与认可。

Shot 4（女性近景/特写）：她将布结再收紧一圈，蹙眉忍耐，肩背微僵，仍保持安静不喧哗。

Shot 5（少年中景）：少年收回目光望向窗外，表情渐收，抬手指向前方远处某个方向。

Shot 6（女性中景）：她顺着指向将上身探近车窗，透过尘污玻璃望向道路尽头天际线。

场景二：围合设施外围（连续）

Shot 7（主观视角/远景）：地平线上出现大型围合式建筑群，铁丝网与瞭望结构清晰可见，女性（气质参考 image3）因景象震撼而睁大眼。

Shot 8（室外全景）：车辆卷尘驶向设施外铁网大门；旷野远处有模糊、缓慢移动的小小人影（氛围参考 image8），保持远景虚化，不强调细节。

Shot 9（门内中景）：门内空地上，两名同伴（其一气质参考 image7，另一为女性同伴）快步迎向大门，手持随身行囊与工具，神情关切警惕。

Shot 10（车窗近景）：少年（气质参考 image4）摇下车窗，探身挥手，向网另一侧传递「已抵达」的示意。

Shot 11（接应动作特写/中景）：接应人员（气质参考 image7）确认身份后，将随身长形工具收起别好，跑向门侧手动装置，拉动绳索，缓慢开启第一道铁网门。

Shot 12（室外全景）：铁门完全打开，驾驶员（气质参考 image2）平稳给油，车辆驶入围合区内的安全停车带，尘土渐落，氛围趋于安定。`;

function resolvePrompt() {
  if (process.env.WAN27_TWD_USE_ORIGINAL_PROMPT === "1") {
    return PROMPT_ORIGINAL;
  }
  const omit8 = process.env.WAN27_TWD_OMIT_REF8 === "1";
  const header = omit8 ? HEADER_REF_7 : HEADER_REF_8;
  let body = PROMPT_COMPLIANCE_BODY;
  if (omit8) {
    body = body.replace(
      "（氛围参考 image8），保持远景虚化，不强调细节。",
      "，远景虚化、人影极淡，不强调细节。",
    );
  }
  return header + body;
}

/**
 * 在 macOS 下用 `sips -Z` 限制最长边，避免 8 张高清图 Base64 过大导致异步创建请求长时间无响应头（Undici HeadersTimeout）。
 * @returns {{ path: string, cleanup: (() => void) | null }}
 */
function prepareImageForApi(absPath) {
  const raw = process.env.WAN27_TWD_MAX_EDGE;
  if (raw === "0") {
    return { path: absPath, cleanup: null };
  }
  const edge =
    raw === undefined || raw === "" ? 1280 : Number(raw);
  if (!Number.isFinite(edge) || edge < 256) {
    return { path: absPath, cleanup: null };
  }
  if (process.platform !== "darwin") {
    console.warn(
      `[wan27-twd] 当前非 macOS，跳过长边 ${edge}px 压缩；可设 WAN27_TWD_MAX_EDGE=0 消除本提示`,
    );
    return { path: absPath, cleanup: null };
  }
  const tmpDir = mkdtempSync(join(tmpdir(), "wan27-twd-"));
  const outPath = join(tmpDir, `resized${extname(absPath)}`);
  execFileSync("/usr/bin/sips", ["-Z", String(edge), absPath, "--out", outPath], {
    stdio: "pipe",
  });
  return {
    path: outPath,
    cleanup: () => rmSync(tmpDir, { recursive: true, force: true }),
  };
}

async function fileToDataUrl(absPath) {
  const buf = await readFile(absPath);
  const ext = extname(absPath).toLowerCase();
  const mime =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : ext === ".bmp"
          ? "image/bmp"
          : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function downloadToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, buf);
}

function resolveRunOutputDir() {
  const custom = process.env.WAN27_TWD_RUN_ID?.trim();
  if (custom) {
    return join(REPO_ROOT, "output", "wan27-walkingdead-runs", custom);
  }
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return join(REPO_ROOT, "output", "wan27-walkingdead-runs", stamp);
}

async function main() {
  const tStart = Date.now();
  runStartMs = tStart;

  const apiKey = loadDashscopeApiKeyFromEnv();
  const client = new Wan27Client({
    apiKey,
    baseUrl: resolveDashscopeBaseUrl(),
  });

  const omitRef8 = process.env.WAN27_TWD_OMIT_REF8 === "1";
  const refFiles = omitRef8 ? REF_FILES.slice(0, 7) : REF_FILES;

  const promptText = resolvePrompt();
  const content = [];
  const maxEdgeEnv = process.env.WAN27_TWD_MAX_EDGE;
  const resizeHint =
    maxEdgeEnv === "0"
      ? "原图上传"
      : process.platform === "darwin"
        ? `macOS 缩边 ${maxEdgeEnv || "1280"}px`
        : "未缩边（非 macOS）";
  console.log(`参考图上传策略: ${resizeHint}`);
  if (omitRef8) {
    console.log("已启用 WAN27_TWD_OMIT_REF8：仅上传前 7 张参考图（不含第 8 张）");
  }

  for (const p of refFiles) {
    const prep = prepareImageForApi(p);
    try {
      content.push({ image: await fileToDataUrl(prep.path) });
    } finally {
      prep.cleanup?.();
    }
  }
  content.push({ text: promptText });

  const charCount = [...promptText].length;
  if (charCount > 5000) {
    console.error(`提示词过长（${charCount}），请删减。`);
    process.exit(1);
  }

  console.log(`参考图顺序（共 ${refFiles.length} 张）:`);
  refFiles.forEach((p, i) => console.log(`  image${i + 1}: ${p}`));
  console.log(
    `提示词: ${process.env.WAN27_TWD_USE_ORIGINAL_PROMPT === "1" ? "原版（易触审）" : "审核友好十二镜（默认）"}`,
  );
  console.log(`提示词字符数: ${charCount}`);
  console.log(`尺寸 ${SIZE}，组图 n=12，异步提交…`);

  const body = Wan27Client.buildBody("wan2.7-image-pro", content, {
    enable_sequential: true,
    n: 12,
    size: SIZE,
    watermark: false,
    thinking_mode: true,
  });

  const tAfterBuild = Date.now();
  console.log(`[计时] 构建请求（读图+编码）耗时: ${((tAfterBuild - tStart) / 1000).toFixed(2)}s`);

  const created = await client.createAsyncTask(body);
  const taskId = created.output?.task_id;
  console.log("创建任务:", JSON.stringify(created, null, 2));
  if (!taskId) {
    process.exit(1);
  }

  const tPollStart = Date.now();
  const done = await client.pollTaskUntilDone(taskId, {
    intervalMs: 3000,
    timeoutMs: 1_200_000,
  });
  const tPollEnd = Date.now();

  const urls = extractImageUrlsFromTaskResponse(done);
  console.log(`生成 ${urls.length} 张，usage:`, JSON.stringify(done.usage ?? {}, null, 2));
  console.log(
    `[计时] 异步排队+生成（轮询至成功）: ${((tPollEnd - tPollStart) / 1000).toFixed(2)}s`,
  );

  const outDir = resolveRunOutputDir();
  console.log("输出目录:", outDir);

  const tDlStart = Date.now();
  for (let i = 0; i < urls.length; i++) {
    const fp = join(outDir, `twd-shot-${String(i + 1).padStart(2, "0")}.png`);
    await downloadToFile(urls[i], fp);
    console.log("已保存:", fp);
  }
  const tEnd = Date.now();

  const totalSec = (tEnd - tStart) / 1000;
  const dlSec = (tEnd - tDlStart) / 1000;
  console.log(`[计时] 下载 ${urls.length} 张: ${dlSec.toFixed(2)}s`);
  console.log(`[计时] 全流程总耗时（起：开始读图 → 止：全部落盘）: ${totalSec.toFixed(2)}s`);

  /** 往期林晚五镜约 128–156s 量级，若与张数近似线性，12 张约 2.4× */
  const ref5Sec = Number(process.env.WAN27_REF_5PANEL_SEC ?? "140");
  const ratioExpected = 12 / 5;
  const linearGuess = ref5Sec * ratioExpected;
  console.log(
    `[对比] 若 5 张组图约 ${ref5Sec}s（可用 WAN27_REF_5PANEL_SEC 覆盖），按张数线性粗算 12 张约 ${linearGuess.toFixed(0)}s（≈ ${ratioExpected.toFixed(2)}×）；本次实际 ${totalSec.toFixed(2)}s，倍数相对 5 张基准 ≈ ${(totalSec / ref5Sec).toFixed(2)}×`,
  );
}

main().catch((e) => {
  console.error(e);
  if (runStartMs > 0) {
    console.error(
      `[计时] 异常结束，已耗时: ${((Date.now() - runStartMs) / 1000).toFixed(2)}s`,
    );
  }
  process.exit(1);
});
