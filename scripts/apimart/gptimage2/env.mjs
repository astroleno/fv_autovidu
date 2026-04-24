/**
 * 从项目根目录 `.env` 注入环境变量到 `process.env`（不覆盖已存在的项）。
 * 供本地脚本使用，避免强依赖 `dotenv` 包；用户也可用 `node --env-file=.env` 由 Node 代劳。
 */
import fs from 'fs';

/**
 * @param {string} envFilePath
 * @returns {void}
 */
export function loadEnvFromFile(envFilePath) {
  if (!fs.existsSync(envFilePath)) {
    return;
  }
  const raw = fs.readFileSync(envFilePath, 'utf8');
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
