/**
 * MVP Phase 2e: VLM理解脚本 - 简化版（单镜头）
 * 特性：单镜头独立输出，简化结构，直接可用的中文提示词
 * 
 * API文档: https://yunwu.apifox.cn/api-309482709
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
    
    console.error('[2e_understand] 无法提取JSON，响应前500字符:', text.substring(0, 500));
    throw new Error('无法从响应中提取JSON。请检查响应格式。');
  }
}

async function loadVideo(videoUrlOrPath) {
  if (fs.existsSync(videoUrlOrPath)) {
    console.log('[2e_understand] 读取本地视频文件:', videoUrlOrPath);
    return fs.readFileSync(videoUrlOrPath);
  }
  
  console.log('[2e_understand] 下载视频:', videoUrlOrPath);
  const resp = await fetch(videoUrlOrPath);
  if (!resp.ok) {
    throw new Error(`下载视频失败: HTTP ${resp.status}`);
  }
  const buffer = await resp.arrayBuffer();
  return Buffer.from(buffer);
}

async function analyzeVideo(videoBuffer, scenes, scriptContent, assets, fps = VIDEO_FPS) {
  const videoBase64 = videoBuffer.toString('base64');
  
  // 构建时间戳约束信息
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
视频已被预处理切分为 ${timestamps.length} 个镜头：
${shotRanges.join('\n')}

请参考这些时间戳进行分析，可微调（±0.5s），镜头数量应与时间戳数量一致。`;
  }

  // 构建资产定义
  let assetsContext = '';
  if (assets) {
    assetsContext = `\n# 资产定义（请在提示词中使用 [资产名称] 标记引用）

## 人物资产
${Object.entries(assets.人物 || {}).map(([name, info]) => 
  `[${name}]: ${info.描述 || info.外貌 || ''}`
).join('\n')}

## 场景资产
${Object.entries(assets.场景 || {}).map(([name, info]) => 
  `[${name}]: ${info.描述 || ''}，光线：${info.光线 || ''}，氛围：${info.氛围 || ''}`
).join('\n')}

**重要**：在提示词中使用 [资产名] 标记资产引用，如 [秦狩]、[少宗主寝殿]。`;
  }

  // 构建剧本上下文
  let scriptContext = '';
  if (scriptContent) {
    scriptContext = `\n# 剧本参考
${scriptContent}`;
  }
  
  const prompt = `CRITICAL INSTRUCTION: You must output ONLY a valid JSON object. No explanations, no markdown code blocks, no other text. Start directly with { and end with }.
${assetsContext}
${scriptContext}
${timestampConstraint}

# Role
你是"专业分镜师"。任务：分析视频，输出单镜头级分镜提示词（中文，可直接给生成模型）。

# Prompt 模板结构（每个镜头独立输出完整提示词）

## A. 参考与继承（可选）
- 参考上一镜：参考 Shot [X] 的镜头语言/构图/节奏
- 继承角色一致性：[角色名] 沿用相同外观与服装

## B. 镜头与构图（必须）
- 镜头类型：固定/手持/跟拍/推拉/摇移/环绕
- 景别：远景/全景/中景/近景/特写/大特写
- 机位：平视/低机位仰拍/高机位俯拍/鸟瞰
- 构图：对角线/居中/三分法/前景遮挡/框中框
- 焦段与景深（可选）：35mm/50mm/85mm，浅景深/深景深

## C. 场景与环境（必须）
- 场景：[场景名称]，背景描述
- 时间天气光线：夜/昼、雨雾、烛光/灯笼光/自然光
- 画面风格：古装玄幻/现代都市、电影级构图、超写实细节

## D. 主体与资产摆位（必须）
- 主体位置：画面左/右/中/前景/后景
- 资产标记：[人物名] 在画面位置，[道具名] 在手中
- 群体描述：画面中心 N 个 [角色]

## E. 动作节奏与表演（必须）
- 动作：走/蹲/检查/握剑/转身...
- 表情：无表情/紧张/克制/惊疑
- 节奏约束：全程动作不停/镜头不切/速度均匀

## F. 叙事目的（建议）
- 目的：营造压迫感/展示线索/冲突升级/情绪转折

# Output Schema (JSON)
{
  "meta": {
    "video_id": "string",
    "total_duration_s": float,
    "total_shots": int
  },
  
  "shots": [
    {
      "id": 1,
      "timecode": {
        "start": 0.0,
        "end": float,
        "duration_s": float
      },
      "keyframe_timestamp": float,
      "has_character": boolean,
      
      "使用资产": {
        "人物": ["秦狩"],
        "场景": "少宗主寝殿"
      },
      
      "visual_brief": "一句话画面描述（中文）",
      
      "technical": {
        "shot_size": "景别",
        "angle": "角度",
        "movement": "运镜",
        "lighting": "光线"
      },
      
      "prompt": "完整的单镜头提示词，按上述 A-F 模板结构输出，使用 [资产名] 标记资产引用，中文，可直接给生成模型使用"
    }
  ]
}

# 枚举标准
- **景别**: 远景, 全景, 中全景, 中景, 中近景, 近景, 特写, 大特写
- **角度**: 平视, 仰拍, 俯拍, 鸟瞰, 荷兰角, 地面视角
- **运镜**: 静态, 横摇, 纵摇, 推拉, 跟随, 轨道, 摇臂, 手持, 升降, 环绕, 变焦
- **光线**: 自然光, 硬光, 柔光, 电影光, 霓虹, 低调, 高调

# 关键要求
1. 每个镜头独立输出完整 prompt，不要分组/合并
2. 所有描述使用中文
3. 资产引用使用 [资产名] 标记（如 [秦狩]、[少宗主寝殿]）
4. prompt 字段要完整、可直接使用，不要省略`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            inline_data: {
              mime_type: 'video/mp4',
              data: videoBase64
            },
            video_metadata: {
              fps: fps
            }
          },
          { text: prompt }
        ]
      }
    ]
  };

  const url = `${YUNWU_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${YUNWU_API_KEY}`;
  
  console.log('[2e_understand] 调用VLM API分析视频（简化版）...');
  console.log('[2e_understand] 使用模型:', GEMINI_MODEL);
  console.log('[2e_understand] 视频帧速率 (FPS):', fps);
  
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`VLM API调用失败: HTTP ${resp.status} - ${text.substring(0, 200)}`);
  }

  const result = await resp.json();
  
  if (!result.candidates || !Array.isArray(result.candidates) || result.candidates.length === 0) {
    throw new Error(`VLM API返回格式异常`);
  }
  
  let textContent = '';
  for (const candidate of result.candidates) {
    if (candidate.content && candidate.content.parts) {
      for (const part of candidate.content.parts) {
        if (part.text) {
          textContent += part.text + '\n';
        }
      }
    }
  }
  
  if (!textContent.trim()) {
    throw new Error(`VLM API未返回有效内容`);
  }

  console.log('[2e_understand] VLM响应长度:', textContent.length);
  
  return extractJsonFromResponse(textContent);
}

/**
 * 生成可读的输出文件
 */
function generateReadableOutput(data, videoName, assets) {
  const lines = [];
  
  lines.push('═'.repeat(70));
  lines.push(`${videoName} 视频分镜提示词`);
  lines.push('═'.repeat(70));
  lines.push('');
  
  // 资产定义
  if (assets) {
    lines.push('【资产定义】');
    lines.push('');
    
    if (assets.人物) {
      lines.push('人物:');
      for (const [id, info] of Object.entries(assets.人物)) {
        lines.push(`  [${id}]: ${info.描述 || info.外貌 || ''}`);
      }
      lines.push('');
    }
    
    if (assets.场景) {
      lines.push('场景:');
      for (const [id, info] of Object.entries(assets.场景)) {
        lines.push(`  [${id}]: ${info.描述 || ''}`);
      }
      lines.push('');
    }
    
    lines.push('═'.repeat(70));
    lines.push('');
  }
  
  // 镜头列表
  if (data.shots && Array.isArray(data.shots)) {
    for (const shot of data.shots) {
      lines.push(`【Shot ${shot.id}】${shot.timecode.start.toFixed(2)}s - ${shot.timecode.end.toFixed(2)}s (${shot.timecode.duration_s.toFixed(1)}s)`);
      lines.push('');
      
      // 技术参数
      if (shot.technical) {
        lines.push(`技术: ${shot.technical.shot_size} | ${shot.technical.angle} | ${shot.technical.movement} | ${shot.technical.lighting}`);
        lines.push('');
      }
      
      // 完整提示词
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
    if (!YUNWU_API_KEY) {
      throw new Error('请设置环境变量 YUNWU_API_KEY_UV 或 YUNWU_API_KEY');
    }
    
    console.log('[2e_understand] 使用 API Key:', process.env.YUNWU_API_KEY_UV ? 'YUNWU_API_KEY_UV' : 'YUNWU_API_KEY');

    const videoPathArg = process.argv[2];
    let videoBuffer;
    let videoSource;
    
    if (videoPathArg) {
      const specifiedPath = path.isAbsolute(videoPathArg) 
        ? videoPathArg 
        : path.join(__dirname, videoPathArg);
      
      if (fs.existsSync(specifiedPath)) {
        console.log('[2e_understand] 使用命令行指定的视频文件:', specifiedPath);
        videoBuffer = await loadVideo(specifiedPath);
        videoSource = specifiedPath;
      } else {
        throw new Error(`指定的视频文件不存在: ${specifiedPath}`);
      }
    }
    
    if (!videoBuffer) {
      throw new Error(`未找到视频源。用法: node 02e_understand_vlm_simple.js [视频路径]`);
    }
    
    console.log('[2e_understand] 视频来源:', videoSource);

    // 读取预处理的时间戳
    let scenes = null;
    const videoName = path.basename(videoSource, path.extname(videoSource));
    
    const possiblePaths = [
      path.join(__dirname, 'output', `detected_${videoName}`, 'scenes.json'),
      path.join(__dirname, 'output', 'detected_frames', 'scenes.json')
    ];
    
    for (const scenesPath of possiblePaths) {
      if (fs.existsSync(scenesPath)) {
        const tempScenes = JSON.parse(fs.readFileSync(scenesPath, 'utf-8'));
        if (tempScenes.video === `${videoName}.mp4` || possiblePaths.indexOf(scenesPath) === 0) {
          console.log('[2e_understand] 读取预处理时间戳:', scenesPath);
          scenes = tempScenes;
          console.log('[2e_understand] 预处理场景数:', scenes.scene_count || scenes.timestamps?.length || 0);
          break;
        }
      }
    }
    
    if (!scenes) {
      console.warn('[2e_understand] ⚠️  未找到预处理时间戳文件，VLM将自行判断切点');
    }

    // 读取对应的剧本文件
    let scriptContent = null;
    const scriptPath = path.join(__dirname, 'input', 's1', 'scripts', `${videoName}_script.txt`);
    
    if (fs.existsSync(scriptPath)) {
      console.log('[2e_understand] 读取剧本文件:', scriptPath);
      scriptContent = fs.readFileSync(scriptPath, 'utf-8');
    }

    // 读取资产定义文件
    let assets = null;
    const assetsPath = path.join(__dirname, 'input', 's1', 'assets.json');
    
    if (fs.existsSync(assetsPath)) {
      console.log('[2e_understand] 读取资产定义:', assetsPath);
      assets = JSON.parse(fs.readFileSync(assetsPath, 'utf-8'));
      console.log('[2e_understand] 人物资产:', Object.keys(assets.人物 || {}).length);
      console.log('[2e_understand] 场景资产:', Object.keys(assets.场景 || {}).length);
    }

    // 调用VLM分析
    const analysisData = await analyzeVideo(videoBuffer, scenes, scriptContent, assets);

    // 保存JSON结果
    const outputFileName = `${videoName}_simple.json`;
    const outputPath = path.join(__dirname, 'output', outputFileName);
    fs.writeFileSync(outputPath, JSON.stringify(analysisData, null, 2), 'utf-8');
    console.log('[2e_understand] JSON结果已保存:', outputPath);

    // 生成可读的文本输出
    const readableOutput = generateReadableOutput(analysisData, videoName, assets);
    const textOutputPath = path.join(__dirname, 'output', `${videoName}_prompts_simple.txt`);
    fs.writeFileSync(textOutputPath, readableOutput, 'utf-8');
    console.log('[2e_understand] 可读文本已保存:', textOutputPath);

    // 输出统计
    console.log('[2e_understand] ─'.repeat(35));
    console.log('[2e_understand] 分析完成:');
    console.log('[2e_understand]   镜头数:', analysisData.shots?.length || 0);
    
  } catch (error) {
    console.error('[2e_understand] 执行失败:', error.message || error);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

if (typeof fetch !== 'function') {
  console.error('[2e_understand] 需要 Node.js 18+ (支持原生 fetch)');
  process.exit(1);
}

main();



