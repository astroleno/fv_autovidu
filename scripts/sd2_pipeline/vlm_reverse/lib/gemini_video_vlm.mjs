/**
 * 通过云雾网关调用 Gemini 多模态 `generateContent`，上传本地 mp4（base64）。
 * 与 `reference/vlm_gemini/02g_understand_vlm_compact.js` 行为对齐。
 */
import fs from 'fs';
import { loadEnvFromDotenv } from '../../lib/load_env.mjs';

loadEnvFromDotenv();

/**
 * @param {string} text
 * @returns {unknown}
 */
export function extractJsonFromResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/```json?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        // continue
      }
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch {
        // fallthrough
      }
    }
    throw new Error('无法从模型响应中解析 JSON');
  }
}

/**
 * @returns {{ apiKey: string; base: string; fps: number }}
 */
export function getYunwuGeminiEnv() {
  const apiKey = process.env.YUNWU_API_KEY_UV || process.env.YUNWU_API_KEY || '';
  const base = process.env.YUNWU_BASE || 'https://yunwu.ai';
  const fps = process.env.VIDEO_FPS ? parseInt(process.env.VIDEO_FPS, 10) : 20;
  if (!apiKey) {
    throw new Error('请设置 YUNWU_API_KEY 或 YUNWU_API_KEY_UV');
  }
  return { apiKey, base, fps };
}

/**
 * @param {string} videoPath
 * @param {string} model  例如 gemini-3-pro-preview
 * @param {string} userPrompt  完整 user 文本（含输出 schema 说明）
 * @returns {Promise<{ rawText: string; json: unknown; elapsedMs: number }>}
 */
export async function generateContentWithVideo(videoPath, model, userPrompt) {
  const { apiKey, base, fps } = getYunwuGeminiEnv();
  if (!fs.existsSync(videoPath)) {
    throw new Error(`视频不存在: ${videoPath}`);
  }
  const buf = fs.readFileSync(videoPath);
  const videoBase64 = buf.toString('base64');

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            inline_data: { mime_type: 'video/mp4', data: videoBase64 },
            video_metadata: { fps },
          },
          { text: userPrompt },
        ],
      },
    ],
  };

  const url = `${base}/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const t0 = Date.now();
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Gemini API 失败 HTTP ${resp.status}: ${errText.slice(0, 800)}`);
  }
  /** @type {{ candidates?: { content?: { parts?: { text?: string }[] } }[] }} */
  const result = await resp.json();
  let textContent = '';
  for (const c of result.candidates || []) {
    for (const part of c.content?.parts || []) {
      if (typeof part.text === 'string') {
        textContent += `${part.text}\n`;
      }
    }
  }
  if (!textContent.trim()) {
    throw new Error('模型返回空文本');
  }
  const json = extractJsonFromResponse(textContent);
  return { rawText: textContent, json, elapsedMs: Date.now() - t0 };
}
