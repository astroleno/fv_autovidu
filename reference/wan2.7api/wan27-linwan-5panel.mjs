/**
 * 万相 Wan 2.7：双参考图（先林晚、后公寓客厅）+ 五镜叙事组图，竖幅 1080×1920。
 *
 * 参考图路径（仓库内）：
 *   - `public/assets/林晚.jpg` — 角色一致性
 *   - `public/assets/公寓客厅.jpg` — 场景一致性
 *
 * `content` 顺序与 API 要求：先 image 林晚，再 image 客厅，最后 text（单轮 messages）。
 * 输出写入 `output/wan27-linwan-runs/<时间戳>/`，不覆盖历史目录。
 *
 * 用法：
 *   npm run build && node --env-file=.env scripts/wan27-linwan-5panel.mjs
 */

import { readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Wan27Client,
  extractImageUrlsFromTaskResponse,
  loadDashscopeApiKeyFromEnv,
  resolveDashscopeBaseUrl,
} from "../dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

/** 角色参考（须先于场景图传入） */
const REF_LINWAN = join(REPO_ROOT, "public", "assets", "林晚.jpg");
/** 场景参考 */
const REF_ROOM = join(REPO_ROOT, "public", "assets", "公寓客厅.jpg");

/** 竖屏 9:16，1080P 竖幅常用写法：宽*高 */
const SIZE = "1080*1920";

/**
 * 五镜分镜：参考图仅在文首用 image1/image2 指代（具体内容以传入的参考图为准），不写冗长描述。
 */
const PROMPT = `参考：image1=林晚，image2=公寓客厅。电影感竖幅叙事组图共 5 张，9:16，深夜、冷色调、压抑安静，无字幕、无画面内文字。

【竖构图】竖屏全屏、纵向层次为主。

shot1: 深夜死寂的公寓客厅沙发区，林晚身着简约居家服疲惫地蜷缩在沙发中心，周遭死寂压抑。虚化的咖啡杯边缘位于左下角，背景墙面深处阴影中，隐约可见侧后方的时钟。

shot2: 昏暗的公寓客厅内，林晚低头看着手机，手机屏幕散发的冷蓝色微光近距离照亮她憔悴而警觉的面庞。

shot3: 公寓客厅林晚侧后方的墙面上，挂墙时钟盘面在阴影中闪现微光，指针指向凌晨02:58，呈现规律而惊悚的滴答运动。

shot4: 深夜的公寓客厅内，只有手机屏幕发出幽冷的蓝光，林晚穿着简约居家服坐在沙发边缘，百无聊赖地滑动着手机，茶几横在她身前，客厅被大片阴影笼罩。

shot5: 公寓客厅内，手机的光线从下方映射在林晚脸上，林晚揉了揉太阳穴，嘴角露出一丝疲惫而紧绷的苦涩，轻声低语。`;

/**
 * 本地图片转 data URL，供 DashScope 多模态输入。
 */
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
  const custom = process.env.WAN27_LINWAN_RUN_ID?.trim();
  if (custom) {
    return join(REPO_ROOT, "output", "wan27-linwan-runs", custom);
  }
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return join(REPO_ROOT, "output", "wan27-linwan-runs", stamp);
}

async function main() {
  const apiKey = loadDashscopeApiKeyFromEnv();
  const client = new Wan27Client({
    apiKey,
    baseUrl: resolveDashscopeBaseUrl(),
  });

  /** 先林晚，后客厅 — 与用户需求一致 */
  const imgLin = await fileToDataUrl(REF_LINWAN);
  const imgRoom = await fileToDataUrl(REF_ROOM);
  const content = [{ image: imgLin }, { image: imgRoom }, { text: PROMPT }];

  const charCount = [...PROMPT].length;
  if (charCount > 5000) {
    console.error(`提示词过长（${charCount}），请删减。`);
    process.exit(1);
  }

  console.log("参考图顺序: 1) 林晚 →", REF_LINWAN);
  console.log("            2) 公寓客厅 →", REF_ROOM);
  console.log(`提示词字符数: ${charCount}`);
  console.log(`尺寸 ${SIZE}，组图 n=5，异步提交…`);

  const body = Wan27Client.buildBody("wan2.7-image-pro", content, {
    enable_sequential: true,
    n: 5,
    size: SIZE,
    watermark: false,
    /** 显式传入；官方文档称仅「非组图且无图」时生效，组图仍带上便于请求可追溯 */
    thinking_mode: true,
  });

  const created = await client.createAsyncTask(body);
  const taskId = created.output?.task_id;
  console.log("创建任务:", JSON.stringify(created, null, 2));
  if (!taskId) {
    process.exit(1);
  }

  const done = await client.pollTaskUntilDone(taskId, {
    intervalMs: 3000,
    timeoutMs: 900_000,
  });

  const urls = extractImageUrlsFromTaskResponse(done);
  console.log(`生成 ${urls.length} 张，usage:`, JSON.stringify(done.usage ?? {}, null, 2));

  const outDir = resolveRunOutputDir();
  console.log("输出目录:", outDir);

  for (let i = 0; i < urls.length; i++) {
    const fp = join(outDir, `linwan-shot-${String(i + 1).padStart(2, "0")}.png`);
    await downloadToFile(urls[i], fp);
    console.log("已保存:", fp);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
