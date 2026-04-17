/**
 * 从 edit_map_input.json 与 edit_map_sd2.json 解析画面风格，供 Director/Prompter 与 CLI 默认值合并。
 * 优先级：CLI 显式参数 > edit_map_input.json 顶层字段 > edit_map_sd2.meta.parsed_brief > edit_map_sd2.meta 旧字段 > 代码默认。
 */
import fs from 'fs';
import path from 'path';

const DEFAULT_RENDERING = '3D写实动画';
const DEFAULT_ART = '冷调偏青，高反差，低饱和';

/**
 * 读取与 edit_map_sd2.json 同目录下的 edit_map_input.json（若存在）。
 * @param {string} editMapJsonPath edit_map_sd2.json 或任意同目录锚点路径
 * @returns {{ renderingStyle: string, artStyle: string }}
 */
export function readEditMapInputStyleHints(editMapJsonPath) {
  const dir = path.dirname(editMapJsonPath);
  const inputPath = path.join(dir, 'edit_map_input.json');
  if (!fs.existsSync(inputPath)) {
    return { renderingStyle: '', artStyle: '' };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    return {
      renderingStyle: String(raw.renderingStyle || raw.rendering_style || '').trim(),
      artStyle: String(raw.artStyle || raw.art_style || '').trim(),
    };
  } catch {
    return { renderingStyle: '', artStyle: '' };
  }
}

/**
 * @param {object} opts
 * @param {string} [opts.cliRenderingStyle]
 * @param {string} [opts.cliArtStyle]
 * @param {string} [opts.editMapJsonPath] 用于定位同目录 edit_map_input.json
 * @param {unknown} [opts.editMap] 已解析的 edit_map_sd2 对象（可选）
 * @returns {{ renderingStyle: string, artStyle: string }}
 */
export function resolveSd2StyleHints({
  cliRenderingStyle = '',
  cliArtStyle = '',
  editMapJsonPath = '',
  editMap = null,
} = {}) {
  const fromInput = editMapJsonPath
    ? readEditMapInputStyleHints(editMapJsonPath)
    : { renderingStyle: '', artStyle: '' };
  const meta =
    editMap && typeof editMap === 'object' && editMap.meta && typeof editMap.meta === 'object'
      ? /** @type {Record<string, unknown>} */ (editMap.meta)
      : {};
  const parsedBrief =
    meta.parsed_brief && typeof meta.parsed_brief === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.parsed_brief)
      : {};

  const renderingStyle =
    String(cliRenderingStyle || '').trim() ||
    fromInput.renderingStyle ||
    String(parsedBrief.renderingStyle || meta.rendering_style || '').trim() ||
    DEFAULT_RENDERING;

  const artStyle =
    String(cliArtStyle || '').trim() ||
    fromInput.artStyle ||
    String(parsedBrief.artStyle || meta.art_style || '').trim() ||
    DEFAULT_ART;

  return { renderingStyle, artStyle };
}
