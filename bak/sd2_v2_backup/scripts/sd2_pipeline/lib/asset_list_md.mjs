/**
 * 将「一行一个资产名」的简易 Markdown 列表解析为 Feeling episode.json 的 assets[]。
 * 场景/道具/角色用固定表 + 名称启发式归类（可后续改为 YAML front matter）。
 */

/**
 * @param {string} raw
 * @returns {Array<{ name: string, type: string, prompt: string }>}
 */
export function parseAssetListMarkdown(raw) {
  const lines = String(raw)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('#'));

  /** 显式场景（location） */
  const sceneNames = new Set([
    '院长办公室',
    '医院走廊',
    '医院大楼',
    '副院长办公室',
  ]);

  /** 显式道具 */
  const propNames = new Set(['手机', '诊断书', '黑丝和短裙', '无框眼镜', '白大褂', '病历单']);

  /** @type {Array<{ name: string, type: string, prompt: string }>} */
  const assets = [];

  for (const name of lines) {
    let type = 'character';
    if (sceneNames.has(name)) {
      type = 'location';
    } else if (propNames.has(name)) {
      type = 'prop';
    } else if (/走廊|办公室|医院|大楼|外景|内景|场景$/u.test(name)) {
      type = 'location';
    }

    assets.push({
      name,
      type,
      prompt: `资产「${name}」（来源资产列表）。制作时与剧本上下文一致。`,
    });
  }

  return assets;
}
