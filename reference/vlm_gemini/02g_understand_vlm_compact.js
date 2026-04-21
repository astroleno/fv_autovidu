/**
 * MVP Phase 2g: VLM理解脚本 - 分节紧凑版（方案B）
 * 特性：分节但紧凑，易读易解析
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const YUNWU_API_KEY = process.env.YUNWU_API_KEY_UV || process.env.YUNWU_API_KEY;
const YUNWU_BASE = process.env.YUNWU_BASE || 'https://yunwu.ai';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-pro-preview';
const VIDEO_FPS = process.env.VIDEO_FPS ? parseInt(process.env.VIDEO_FPS) : 20;

function extractJsonFromResponse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const jsonMatch = text.match(/```json?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch (e2) {}
    }
    
    let firstBraceIndex = text.indexOf('{');
    let lastBraceIndex = text.lastIndexOf('}');
    
    if (firstBraceIndex !== -1 && lastBraceIndex !== -1 && lastBraceIndex > firstBraceIndex) {
      const jsonText = text.substring(firstBraceIndex, lastBraceIndex + 1);
      try {
        return JSON.parse(jsonText);
      } catch (e2) {}
    }
    
    console.error('[2g_compact] 无法提取JSON');
    throw new Error('无法从响应中提取JSON');
  }
}

async function loadVideo(videoUrlOrPath) {
  if (fs.existsSync(videoUrlOrPath)) {
    console.log('[2g_compact] 读取本地视频:', videoUrlOrPath);
    return fs.readFileSync(videoUrlOrPath);
  }
  throw new Error('视频文件不存在');
}

async function analyzeVideo(videoBuffer, scenes, scriptContent, assets, fps = VIDEO_FPS) {
  const videoBase64 = videoBuffer.toString('base64');
  
  let timestampConstraint = '';
  if (scenes && scenes.timestamps && scenes.timestamps.length > 0) {
    const timestamps = scenes.timestamps;
    const shotRanges = [];
    for (let i = 0; i < timestamps.length; i++) {
      const start = timestamps[i];
      const end = i < timestamps.length - 1 ? timestamps[i + 1] : scenes.duration_s || start + 5;
      shotRanges.push(`Shot ${i + 1}: ${start.toFixed(2)}s - ${end.toFixed(2)}s`);
    }
    timestampConstraint = `\n# 预处理时间戳参考
${shotRanges.join('\n')}
参考这些时间戳切分镜头，可微调（±0.5s）。`;
  }

  let assetsContext = '';
  if (assets) {
    assetsContext = `\n# 资产定义（在提示词中使用 [资产名] 标记）
人物：${Object.keys(assets.人物 || {}).map(name => `[${name}]`).join('、')}
场景：${Object.keys(assets.场景 || {}).map(name => `[${name}]`).join('、')}`;
  }

  let scriptContext = '';
  if (scriptContent) {
    scriptContext = `\n# 剧本参考\n${scriptContent.substring(0, 500)}...`;
  }
  
  const prompt = `CRITICAL: Output ONLY valid JSON. Start with { and end with }.
${assetsContext}
${scriptContext}
${timestampConstraint}

# Role
专业分镜师。输出分节紧凑提示词（中文，分节但不冗余）。

# 提示词格式（分节紧凑）

每个镜头用简洁标签分节：

【镜头】镜头类型+景别+机位+构图（一行）
【场景】[场景名] 环境+光线+氛围（一行）
【主体】空间位置+[资产名]+动作（一行）
【约束】动作约束/速度匹配（如有）
【风格】视觉风格+渲染质量（一行）
【参考】参考 shot_XX.png / 继承 Shot X（如有）
【目的】叙事目的（一行）

**格式规则：**
- 每个标签一行，不要展开多行
- 空间位置明确（画面左侧、右下角等）
- 资产用 [名称] 标记
- 简洁紧凑，不要冗余描述

**示例：**
【镜头】固定全景平视，居中构图门框前景
【场景】[少宗主寝殿] 昼，木质内饰蓝色纱幔，门外强光射入灰尘弥漫
【主体】画面背景门口 [秦无敌] 深色长袍大步走入中景，怒火中烧
【约束】房门被猛踢开木屑飞溅，动作迅猛
【风格】古装玄幻高对比度，电影级构图
【参考】参考 shot_01.png
【目的】压迫感暴怒登场

# Output Schema
{
  "meta": {
    "video_id": "string",
    "total_duration_s": float,
    "total_shots": int
  },
  "shots": [
    {
      "id": 1,
      "timecode": {"start": 0.0, "end": float, "duration_s": float},
      "keyframe_timestamp": float,
      "has_character": boolean,
      "使用资产": {"人物": ["名称"], "场景": "名称"},
      "分镜图": "shot_01.png",
      "prompt": "【镜头】...\\n【场景】...\\n【主体】...\\n【约束】...\\n【风格】...\\n【参考】...\\n【目的】..."
    }
  ]
}

# 枚举
景别：远景/全景/中全景/中景/中近景/近景/特写/大特写
角度：平视/仰拍/俯拍/鸟瞰/荷兰角/地面视角
运镜：静态/横摇/纵摇/推拉/跟随/轨道/摇臂/手持/升降/环绕/变焦
光线：自然光/硬光/柔光/电影光/霓虹/低调/高调

# 关键要求
1. prompt 字段用【标签】分节
2. 每个标签一行，简洁紧凑
3. 空间位置明确（画面左侧、右下角等）
4. 资产用 [名称] 标记
5. 参考上一镜用"参考 shot_XX.png"或"继承 Shot X"`;

  const body = {
    contents: [{
      role: 'user',
      parts: [
        {
          inline_data: {mime_type: 'video/mp4', data: videoBase64},
          video_metadata: {fps: fps}
        },
        {text: prompt}
      ]
    }]
  };

  const url = `${YUNWU_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${YUNWU_API_KEY}`;
  console.log('[2g_compact] 调用VLM API（分节紧凑版）...');
  
  const resp = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });

  if (!resp.ok) throw new Error(`API失败: ${resp.status}`);
  const result = await resp.json();
  
  let textContent = '';
  for (const candidate of result.candidates || []) {
    if (candidate.content && candidate.content.parts) {
      for (const part of candidate.content.parts) {
        if (part.text) textContent += part.text + '\n';
      }
    }
  }
  
  if (!textContent.trim()) throw new Error('无有效内容');
  console.log('[2g_compact] VLM响应长度:', textContent.length);
  
  return extractJsonFromResponse(textContent);
}

function generateReadableOutput(data, videoName, assets) {
  const lines = [];
  
  lines.push('═'.repeat(70));
  lines.push(`${videoName} 视频分镜提示词 - 分节紧凑版（方案B）`);
  lines.push('═'.repeat(70));
  lines.push('');
  
  if (assets) {
    lines.push('【资产】');
    if (assets.人物) {
      lines.push('人物: ' + Object.keys(assets.人物).map(k => `[${k}]`).join('、'));
    }
    if (assets.场景) {
      lines.push('场景: ' + Object.keys(assets.场景).map(k => `[${k}]`).join('、'));
    }
    lines.push('');
    lines.push('═'.repeat(70));
    lines.push('');
  }
  
  if (data.shots && Array.isArray(data.shots)) {
    for (const shot of data.shots) {
      const ref = shot.分镜图 || `shot_${String(shot.id).padStart(2, '0')}.png`;
      lines.push(`【Shot ${shot.id}】${shot.timecode.start.toFixed(2)}s-${shot.timecode.end.toFixed(2)}s (${shot.timecode.duration_s.toFixed(1)}s) | 参考 ${ref}`);
      lines.push('');
      
      if (shot.prompt) {
        lines.push(shot.prompt);
      }
      
      lines.push('');
      lines.push('─'.repeat(70));
      lines.push('');
    }
  }
  
  lines.push('═'.repeat(70));
  return lines.join('\n');
}

async function main() {
  try {
    if (!YUNWU_API_KEY) throw new Error('请设置 YUNWU_API_KEY');
    
    const videoPathArg = process.argv[2];
    if (!videoPathArg) throw new Error('用法: node 02g_understand_vlm_compact.js [视频路径]');
    
    const specifiedPath = path.isAbsolute(videoPathArg) ? videoPathArg : path.join(__dirname, videoPathArg);
    if (!fs.existsSync(specifiedPath)) throw new Error(`文件不存在: ${specifiedPath}`);
    
    const videoBuffer = await loadVideo(specifiedPath);
    const videoSource = specifiedPath;
    const videoName = path.basename(videoSource, path.extname(videoSource));
    
    console.log('[2g_compact] 视频:', videoName);

    let scenes = null;
    const possiblePaths = [
      path.join(__dirname, 'output', `detected_${videoName}`, 'scenes.json')
    ];
    
    for (const scenesPath of possiblePaths) {
      if (fs.existsSync(scenesPath)) {
        scenes = JSON.parse(fs.readFileSync(scenesPath, 'utf-8'));
        console.log('[2g_compact] 场景数:', scenes.timestamps?.length || 0);
        break;
      }
    }

    let scriptContent = null;
    const scriptPath = path.join(__dirname, 'input', 's1', 'scripts', `${videoName}_script.txt`);
    if (fs.existsSync(scriptPath)) {
      scriptContent = fs.readFileSync(scriptPath, 'utf-8');
    }

    let assets = null;
    const assetsPath = path.join(__dirname, 'input', 's1', 'assets.json');
    if (fs.existsSync(assetsPath)) {
      assets = JSON.parse(fs.readFileSync(assetsPath, 'utf-8'));
    }

    const analysisData = await analyzeVideo(videoBuffer, scenes, scriptContent, assets);

    const outputPath = path.join(__dirname, 'output', `${videoName}_compact.json`);
    fs.writeFileSync(outputPath, JSON.stringify(analysisData, null, 2), 'utf-8');
    console.log('[2g_compact] JSON保存:', outputPath);

    const readableOutput = generateReadableOutput(analysisData, videoName, assets);
    const textOutputPath = path.join(__dirname, 'output', `${videoName}_prompts_compact.txt`);
    fs.writeFileSync(textOutputPath, readableOutput, 'utf-8');
    console.log('[2g_compact] TXT保存:', textOutputPath);

    console.log('[2g_compact] 完成! 镜头数:', analysisData.shots?.length || 0);
    
  } catch (error) {
    console.error('[2g_compact] 失败:', error.message);
    process.exit(1);
  }
}

if (typeof fetch !== 'function') {
  console.error('[2g_compact] 需要 Node.js 18+');
  process.exit(1);
}

main();



