/**
 * MVP Phase 2f: VLM理解脚本 - 流式版（方案A）
 * 特性：单段落流式描述，紧凑完整
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
    
    console.error('[2f_flow] 无法提取JSON');
    throw new Error('无法从响应中提取JSON');
  }
}

async function loadVideo(videoUrlOrPath) {
  if (fs.existsSync(videoUrlOrPath)) {
    console.log('[2f_flow] 读取本地视频:', videoUrlOrPath);
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
专业分镜师。输出单镜头流式提示词（中文，一段话描述）。

# 提示词格式（流式紧凑）

每个镜头输出一段完整描述，包含：

1. **镜头类型+运镜**：固定镜头静态/手持跟随/推拉镜头/摇移镜头
2. **景别+角度**：全景平视/中景仰拍/特写俯拍
3. **构图**：居中构图/三分法/对角线/框中框
4. **场景**：[场景名]，环境描述，时间天气光线
5. **3D空间关系**：在门口/床榻上/从门口走向XX（用场景内参照物，不用画面坐标）
6. **人物动作**：[资产名] 动作描述
7. **表情情绪**：怒火中烧/惊恐失措等
8. **视觉风格**：古装玄幻/现代都市，电影级构图，8K超写实（可选）
9. **参考**：参考 shot_XX.png（如有上一镜）

**重要格式规则：**
- 用逗号、分号、顿号连接，不分段
- 镜头类型+运镜明确（固定镜头静态、手持跟随、推拉镜头缓慢推进）
- 用3D空间关系（在门口、床榻上），不用2D画面坐标（画面左侧、画面中心等）
- 资产用 [名称] 标记
- 动作约束前置（全程XX、速度XX）
- 一段话流式输出，不要分小节
- **不要输出叙事目的/叙事作用**
- **禁止使用画面位置描述（画面左侧/右侧/中心/左下角/右上角/前景/后景）**

**示例（参考格式）：**
"固定镜头静态，全景平视，居中构图门框前景。[少宗主寝殿] 昼，木质内饰蓝色纱幔，门外强光射入。门口处木门被猛踢开木屑飞溅，[秦无敌] 身着深色长袍从门口大步闯入，神情威严怒火中烧，动作迅猛带破坏力。古装玄幻高对比度，电影级构图。参考 shot_01.png。"

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
      "prompt": "完整的流式提示词（一段话，不分段，用逗号连接）"
    }
  ]
}

# 枚举
景别：远景/全景/中全景/中景/中近景/近景/特写/大特写
角度：平视/仰拍/俯拍/鸟瞰/荷兰角/地面视角
运镜：静态/横摇/纵摇/推拉/跟随/轨道/摇臂/手持/升降/环绕/变焦
光线：自然光/硬光/柔光/电影光/霓虹/低调/高调

# 关键要求
1. prompt 字段输出完整流式描述，一段话
2. 用逗号/分号连接，不要分段标题
3. 镜头类型+运镜必须明确（固定镜头静态、手持跟随、推拉镜头缓慢推进、摇移镜头横摇）
4. 用3D空间关系（在门口、床榻上、从XX走向YY），禁止用2D画面坐标
5. 资产用 [名称] 标记
6. 参考上一镜用"参考 shot_XX.png"
7. **禁止输出叙事目的/叙事作用**
8. **禁止使用画面位置词（画面左侧/右侧/中心/左下角/右上角/前景/后景/画面主体等）**`;

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
  console.log('[2f_flow] 调用VLM API（流式版）...');
  
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
  console.log('[2f_flow] VLM响应长度:', textContent.length);
  
  return extractJsonFromResponse(textContent);
}

function generateReadableOutput(data, videoName, assets) {
  const lines = [];
  
  lines.push('═'.repeat(70));
  lines.push(`${videoName} 视频分镜提示词 - 流式版（方案A）`);
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
    if (!videoPathArg) throw new Error('用法: node 02f_understand_vlm_flow.js [视频路径]');
    
    const specifiedPath = path.isAbsolute(videoPathArg) ? videoPathArg : path.join(__dirname, videoPathArg);
    if (!fs.existsSync(specifiedPath)) throw new Error(`文件不存在: ${specifiedPath}`);
    
    const videoBuffer = await loadVideo(specifiedPath);
    const videoSource = specifiedPath;
    const videoName = path.basename(videoSource, path.extname(videoSource));
    
    console.log('[2f_flow] 视频:', videoName);

    let scenes = null;
    const possiblePaths = [
      path.join(__dirname, 'output', `detected_${videoName}`, 'scenes.json')
    ];
    
    for (const scenesPath of possiblePaths) {
      if (fs.existsSync(scenesPath)) {
        scenes = JSON.parse(fs.readFileSync(scenesPath, 'utf-8'));
        console.log('[2f_flow] 场景数:', scenes.timestamps?.length || 0);
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

    const outputPath = path.join(__dirname, 'output', `${videoName}_flow.json`);
    fs.writeFileSync(outputPath, JSON.stringify(analysisData, null, 2), 'utf-8');
    console.log('[2f_flow] JSON保存:', outputPath);

    const readableOutput = generateReadableOutput(analysisData, videoName, assets);
    const textOutputPath = path.join(__dirname, 'output', `${videoName}_prompts_flow.txt`);
    fs.writeFileSync(textOutputPath, readableOutput, 'utf-8');
    console.log('[2f_flow] TXT保存:', textOutputPath);

    console.log('[2f_flow] 完成! 镜头数:', analysisData.shots?.length || 0);
    
  } catch (error) {
    console.error('[2f_flow] 失败:', error.message);
    process.exit(1);
  }
}

if (typeof fetch !== 'function') {
  console.error('[2f_flow] 需要 Node.js 18+');
  process.exit(1);
}

main();

