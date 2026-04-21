/**
 * MVP Phase 2: VLM理解脚本
 * 读取预演视频URL，调用 gemini VLM 分析镜头
 * API文档: https://yunwu.apifox.cn/api-309482709
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const YUNWU_API_KEY = process.env.YUNWU_API_KEY_UV || process.env.YUNWU_API_KEY; // 视频识别使用 YUNWU_API_KEY_UV
const YUNWU_BASE = process.env.YUNWU_BASE || 'https://yunwu.ai';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview'; // 可选: gemini-2.0-flash, gemini-2.5-pro, gemini-3-flash-preview
const VIDEO_FPS = process.env.VIDEO_FPS ? parseInt(process.env.VIDEO_FPS) : 20; // 视频帧速率，默认 20 FPS

function extractJsonFromResponse(text) {
  // 尝试直接解析
  try {
    return JSON.parse(text);
  } catch (e) {
    // 尝试提取markdown代码块中的JSON
    const jsonMatch = text.match(/```json?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch (e2) {
        // 继续尝试其他方法
      }
    }
    // 尝试提取第一个 { 到最后一个 } 之间的内容（更精确的匹配）
    const bracketMatch = text.match(/\{[\s\S]*\}/);
    if (bracketMatch) {
      try {
        return JSON.parse(bracketMatch[0]);
      } catch (e2) {
        // 继续尝试其他方法
      }
    }
    // 尝试找到最大的 JSON 对象（从第一个 { 开始，匹配到最后一个 }）
    const lines = text.split('\n');
    let jsonStart = -1;
    let jsonEnd = -1;
    let braceCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (let j = 0; j < line.length; j++) {
        if (line[j] === '{') {
          if (jsonStart === -1) jsonStart = i;
          braceCount++;
        } else if (line[j] === '}') {
          braceCount--;
          if (braceCount === 0 && jsonStart !== -1) {
            jsonEnd = i;
            break;
          }
        }
      }
      if (jsonEnd !== -1) break;
    }
    
    if (jsonStart !== -1 && jsonEnd !== -1) {
      const jsonText = lines.slice(jsonStart, jsonEnd + 1).join('\n');
      try {
        return JSON.parse(jsonText);
      } catch (e2) {
        // 继续尝试
      }
    }
    
    // 最后尝试：查找所有可能的 JSON 对象，选择最长的
    const allJsonMatches = text.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
    if (allJsonMatches && allJsonMatches.length > 0) {
      // 按长度排序，尝试解析最长的
      allJsonMatches.sort((a, b) => b.length - a.length);
      for (const match of allJsonMatches) {
        try {
          return JSON.parse(match);
        } catch (e2) {
          // 继续下一个
        }
      }
    }
    
    console.error('[2_understand] 无法提取JSON，响应前500字符:', text.substring(0, 500));
    throw new Error('无法从响应中提取JSON。请检查响应格式。');
  }
}

async function loadVideo(videoUrlOrPath) {
  // 检查是否是本地文件路径
  if (fs.existsSync(videoUrlOrPath)) {
    console.log('[2_understand] 读取本地视频文件:', videoUrlOrPath);
    return fs.readFileSync(videoUrlOrPath);
  }
  
  // 否则从 URL 下载
  console.log('[2_understand] 下载视频:', videoUrlOrPath);
  const resp = await fetch(videoUrlOrPath);
  if (!resp.ok) {
    throw new Error(`下载视频失败: HTTP ${resp.status}`);
  }
  const buffer = await resp.arrayBuffer();
  return Buffer.from(buffer);
}

async function analyzeVideo(videoBuffer, scenes, fps = VIDEO_FPS) {
  const videoBase64 = videoBuffer.toString('base64');
  
  // 构建时间戳约束信息
  let timestampConstraint = '';
  if (scenes && scenes.timestamps && scenes.timestamps.length > 0) {
    const timestamps = scenes.timestamps;
    const shotRanges = [];
    for (let i = 0; i < timestamps.length; i++) {
      const start = timestamps[i];
      const end = i < timestamps.length - 1 ? timestamps[i + 1] : scenes.duration_s || start + 5;
      shotRanges.push(`镜头${i + 1}: ${start.toFixed(2)}s - ${end.toFixed(2)}s`);
    }
    timestampConstraint = `\n# 参考信息：视频已被预处理切分为 ${timestamps.length} 个镜头，参考切点时间戳如下：
${shotRanges.join('\n')}

请参考这些时间戳进行分析，但可以根据视频实际内容调整切点位置。如果预处理切点不准确，你可以微调时间戳以获得更合理的镜头分割。`;
  }
  
  const prompt = `CRITICAL INSTRUCTION: You must output ONLY a valid JSON object. No explanations, no markdown code blocks, no other text before or after. Start directly with { and end with }.

# Role
你是"专业影视分镜结构化专家"。你的任务是：深度分析视频，输出符合工业标准的"结构化分镜表（JSON）"。${timestampConstraint}

# Critical Rules (严格执行)
1.  **结构化优先**：不仅要生成 Prompt，更要提取独立的元数据（景别、角度、时长）。
2.  **枚举规范化**：特定字段（景别、角度）必须使用指定的 Enum 值。
3.  **计算准确**：duration_s 必须等于 end - start。
4.  **时间戳参考**：${scenes && scenes.timestamps ? '请参考上述预处理的时间戳切点，但可以根据视频实际内容微调切点位置以获得更合理的镜头分割。如果预处理切点不准确，你可以调整时间戳边界。' : ''}
5.  **人物检测**：必须判断每个镜头中是否有人物出现，并在 has_character 字段中输出 true/false。
   -   has_character = true: 镜头中清晰可见人物（包括全身、半身、特写等）
   -   has_character = false: 空镜、环境镜头、纯风景、物体特写等无人物的画面
6.  **视觉与叙事分离**：
    -   visual_brief: 眼睛直接看到的物理画面（例如：男人在雨中奔跑）。
    -   script_content: 对应的脚本/叙事意义（例如：主角试图逃离追踪）。

# Field Guidelines (枚举标准)
- **Shot Size (景别)**: Extreme Wide, Wide, Full, Medium Full, Medium, Medium Close-up, Close-up, Extreme Close-up.
- **Camera Angle (角度)**: Eye-level, Low Angle, High Angle, Overhead/Bird's-eye, Dutch Angle, Ground Level.
- **Movement (运动)**: Static, Pan, Tilt, Zoom In/Out, Tracking, Dolly, Crane, Handheld.
- **Lighting (光线)**: Natural, Hard, Soft, Cinematic, Neon, Low-key, High-key.

# Veo Prompt Construction Formula
虽然字段被拆解，但你仍需在 veo_prompt 字段中将它们组合：
"[Subject] [Action]. [Shot Size] shot from [Camera Angle]. [Movement]. [Lens/Focus]. [Lighting] lighting. [Style]."

# Output Schema (JSON)
{
  "meta": {
    "total_duration_s": float,
    "video_title": "string"
  },
  "global_style": "string",
  "entities": { "C1": "...", "P1": "..." }, 
  "shots": [
    {
      "id": 1,
      // 1. 时间与关键帧
      "timecode": {
        "start": 0.0,
        "end": float,
        "duration_s": float  // 必须显式输出
      },
      "keyframe_timestamp": float, // 推荐取中间时刻或动作最清晰的时刻作为首帧截图点
      
      // 2. 描述层 (人类阅读用)
      "visual_brief": "一句话画面描述 (中文，用于快速预览)",
      "script_content": "内容/脚本描述 (中文，用于叙事理解)",
      "has_character": boolean, // 是否有人物出现在此镜头中（true=有人物，false=无人物的空镜/环境镜头）
      
      // 3. 核心镜头参数 (结构化数据)
      "technical": {
        "shot_size": "Enum (e.g., Close-up)",
        "angle": "Enum (e.g., Low Angle)",
        "movement": "Enum (e.g., Static)",
        "lens_spec": "string (e.g., Shallow depth of field, 50mm)",
        "lighting": "Enum (e.g., Soft)"
      },
      
      // 4. 生成层 (AI使用)
      "veo_prompt": "Strictly constructed English prompt for generation",
      
      "boundary_reason": "string"
    }
  ]
}`;

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
  
  console.log('[2_understand] 调用VLM API分析视频...');
  console.log('[2_understand] 使用模型:', GEMINI_MODEL);
  console.log('[2_understand] 视频帧速率 (FPS):', fps);
  console.log('[2_understand] API端点:', url.replace(YUNWU_API_KEY, '***'));
  
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
    let errorMsg = `VLM API调用失败: HTTP ${resp.status}`;
    try {
      const errorJson = JSON.parse(text);
      errorMsg += ` - ${JSON.stringify(errorJson)}`;
    } catch (e) {
      errorMsg += ` - ${text.substring(0, 200)}`;
    }
    throw new Error(errorMsg);
  }

  const result = await resp.json();
  
  // 检查响应结构
  if (!result.candidates || !Array.isArray(result.candidates) || result.candidates.length === 0) {
    throw new Error(`VLM API返回格式异常: ${JSON.stringify(result).substring(0, 200)}`);
  }
  
  // 尝试获取所有候选响应的文本
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
    console.log('[2_understand] 完整响应结构:', JSON.stringify(result, null, 2).substring(0, 1000));
    throw new Error(`VLM API未返回有效内容。响应结构: ${JSON.stringify(result).substring(0, 300)}`);
  }

  console.log('[2_understand] VLM响应长度:', textContent.length);
  console.log('[2_understand] VLM响应前1000字符:', textContent.substring(0, 1000));
  console.log('[2_understand] VLM响应后1000字符:', textContent.substring(Math.max(0, textContent.length - 1000)));
  
  return extractJsonFromResponse(textContent);
}

async function main() {
  try {
    if (!YUNWU_API_KEY) {
      throw new Error('请设置环境变量 YUNWU_API_KEY_UV 或 YUNWU_API_KEY（用于视频识别）');
    }
    
    console.log('[2_understand] 使用 API Key:', process.env.YUNWU_API_KEY_UV ? 'YUNWU_API_KEY_UV' : 'YUNWU_API_KEY');

    // 支持命令行参数指定视频路径
    const videoPathArg = process.argv[2];
    let videoBuffer;
    let videoSource;
    
    // 1. 如果命令行指定了视频路径，优先使用
    if (videoPathArg) {
      const specifiedPath = path.isAbsolute(videoPathArg) 
        ? videoPathArg 
        : path.join(__dirname, videoPathArg);
      
      if (fs.existsSync(specifiedPath)) {
        console.log('[2_understand] 使用命令行指定的视频文件:', specifiedPath);
        videoBuffer = await loadVideo(specifiedPath);
        videoSource = specifiedPath;
      } else {
        throw new Error(`指定的视频文件不存在: ${specifiedPath}`);
      }
    }
    
    // 2. 如果没有指定，优先使用 test2.mp4
    if (!videoBuffer) {
      const test2Path = path.join(__dirname, 'output', 'test2.mp4');
      if (fs.existsSync(test2Path)) {
        console.log('[2_understand] 使用指定的视频文件: test2.mp4');
        videoBuffer = await loadVideo(test2Path);
        videoSource = test2Path;
      }
    }
    
    // 3. 如果没有 test2.mp4，检查其他本地视频文件
    if (!videoBuffer) {
      const outputDir = path.join(__dirname, 'output');
      if (fs.existsSync(outputDir)) {
        const localVideoFiles = fs.readdirSync(outputDir)
          .filter(f => f.endsWith('.mp4') && f !== 'test2.mp4')
          .map(f => path.join(outputDir, f));
        
        if (localVideoFiles.length > 0) {
          const localVideo = localVideoFiles[0];
          console.log('[2_understand] 使用本地视频文件:', path.basename(localVideo));
          videoBuffer = await loadVideo(localVideo);
          videoSource = localVideo;
        }
      }
    }
    
    // 4. 如果没有本地文件，使用 URL
    if (!videoBuffer) {
      const previewUrlPath = path.join(__dirname, 'output', 'preview_url.txt');
      if (fs.existsSync(previewUrlPath)) {
        const videoUrl = fs.readFileSync(previewUrlPath, 'utf-8').trim();
        if (videoUrl && videoUrl.startsWith('http')) {
          console.log('[2_understand] 使用预演视频URL:', videoUrl);
          videoBuffer = await loadVideo(videoUrl);
          videoSource = videoUrl;
        }
      }
    }
    
    if (!videoBuffer) {
      throw new Error(`未找到视频源。用法: node 02_understand_vlm.js [视频路径]`);
    }
    
    console.log('[2_understand] 视频来源:', videoSource);

    // 读取预处理的时间戳（scenes.json）
    let scenes = null;
    const videoName = path.basename(videoSource, path.extname(videoSource));
    const scenesPath = path.join(__dirname, 'output', `detected_${videoName}`, 'scenes.json');
    
    if (fs.existsSync(scenesPath)) {
      console.log('[2_understand] 读取预处理时间戳:', scenesPath);
      scenes = JSON.parse(fs.readFileSync(scenesPath, 'utf-8'));
      console.log('[2_understand] 预处理场景数:', scenes.scene_count || scenes.timestamps?.length || 0);
      console.log('[2_understand] 时间戳:', scenes.timestamps?.map(t => `${t.toFixed(2)}s`).join(', ') || 'N/A');
    } else {
      console.warn('[2_understand] ⚠️  未找到预处理时间戳文件:', scenesPath);
      console.warn('[2_understand] 将使用VLM自行判断切点');
    }

    // 调用VLM分析（传入预处理时间戳）
    const shotsData = await analyzeVideo(videoBuffer, scenes);

    // 保存结果（支持自定义输出文件名）
    const outputFileName = process.argv[3] || `${videoName}_shots_preprocess.json`; // 第三个参数为输出文件名
    const outputPath = path.join(__dirname, 'output', outputFileName);
    fs.writeFileSync(outputPath, JSON.stringify(shotsData, null, 2), 'utf-8');
    console.log('[2_understand] 镜头分析结果已保存:', outputPath);
    console.log('[2_understand] 共识别', shotsData.shots?.length || 0, '个镜头');
  } catch (error) {
    console.error('[2_understand] 执行失败:', error.message || error);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

if (typeof fetch !== 'function') {
  console.error('[2_understand] 需要 Node.js 18+ (支持原生 fetch)');
  process.exit(1);
}

main();

