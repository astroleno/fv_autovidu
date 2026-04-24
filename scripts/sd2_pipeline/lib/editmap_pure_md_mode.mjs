/**
 * EditMap pure_md 模式识别：
 * - v6 旧版：`<sd2_editmap v6="pure_md" />`（兼容 `<editmap v6="pure_md" />`）
 * - v7 新版：`<editmap v7="ledger_pure_md" />`
 *
 * 仅做 header 级别识别，不解析正文。
 */

/**
 * @param {string} raw
 * @returns {'v6_pure_md' | 'v7_ledger_pure_md' | null}
 */
export function detectEditMapPureMdMode(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const firstNonEmpty =
    raw.split('\n').find((line) => typeof line === 'string' && line.trim().length > 0) || '';
  const header = firstNonEmpty.trim();
  if (!/^<[^>]+>$/.test(header)) return null;

  if (
    /<\s*(?:sd2_editmap|editmap)\b/i.test(header) &&
    /\bv6\s*=\s*"pure_md"/i.test(header)
  ) {
    return 'v6_pure_md';
  }

  if (
    /<\s*editmap\b/i.test(header) &&
    /\bv7\s*=\s*"ledger_pure_md"/i.test(header)
  ) {
    return 'v7_ledger_pure_md';
  }

  return null;
}
