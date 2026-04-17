/**
 * 从 directorBrief 自然语言抽取「单集时长 / 目标镜头数」数值。
 * 与 EditMap 侧 meta.parsed_brief 互补：prepare 先把可解析数字写入 JSON。
 *
 * 优先级由调用方决定（buildEditMapInput：显式 CLI > 此处 > 分镜累加）。
 */

/**
 * @param {string} text
 * @returns {{ episodeDuration?: number, shotCountApprox?: number }}
 */
export function parseBriefStructuredHints(text) {
  const out = /** @type {{ episodeDuration?: number, shotCountApprox?: number }} */ ({});
  if (!text || typeof text !== 'string') {
    return out;
  }

  const dur = text.match(/单集总时长\s*(\d+)\s*秒/);
  if (dur && dur[1]) {
    const n = parseInt(dur[1], 10);
    if (Number.isFinite(n) && n > 0) {
      out.episodeDuration = n;
    }
  }

  if (out.episodeDuration === undefined) {
    const d2 = text.match(/每集约\s*(\d+)\s*秒/);
    if (d2 && d2[1]) {
      const n = parseInt(d2[1], 10);
      if (Number.isFinite(n) && n > 0) {
        out.episodeDuration = n;
      }
    }
  }

  if (out.episodeDuration === undefined) {
    const d3 = text.match(/(?:每集|单集)[^，。\d]{0,12}?约\s*(\d+)\s*秒/);
    if (d3 && d3[1]) {
      const n = parseInt(d3[1], 10);
      if (Number.isFinite(n) && n > 0) {
        out.episodeDuration = n;
      }
    }
  }

  const shot =
    text.match(/目标(?:剪辑)?镜头数约\s*(\d+)/) ||
    text.match(/目标镜头数约\s*(\d+)/) ||
    text.match(/镜头数约\s*(\d+)/);
  if (shot && shot[1]) {
    const n = parseInt(shot[1], 10);
    if (Number.isFinite(n) && n > 0) {
      out.shotCountApprox = n;
    }
  }

  if (out.shotCountApprox === undefined) {
    const range = text.match(/(\d+)\s*[-~～]\s*(\d+)\s*个镜头/);
    if (range && range[1] && range[2]) {
      const a = parseInt(range[1], 10);
      const b = parseInt(range[2], 10);
      if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b >= a) {
        out.shotCountApprox = Math.round((a + b) / 2);
      }
    }
  }

  return out;
}
