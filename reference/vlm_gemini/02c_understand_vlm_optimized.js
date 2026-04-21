/**
 * MVP Phase 2c: VLM理解脚本 - 优化版
 * 特性：
 * 1. 资产确认：提取人物/场景资产并固定描述
 * 2. 结构化 Prompt：按 Veo 规范（正文、动作、风格、相机、构图、对焦、氛围）
 * 3. 生成单元划分：单镜头 / 双镜头配对
 * 4. 中文输出：适配中文视频生成模型
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
    
    // 找到第一个 { 和最后一个 } 之间的内容（支持嵌套）
    let firstBraceIndex = text.indexOf('{');
    let lastBraceIndex = text.lastIndexOf('}');
    
    if (firstBraceIndex !== -1 && lastBraceIndex !== -1 && lastBraceIndex > firstBraceIndex) {
      const jsonText = text.substring(firstBraceIndex, lastBraceIndex + 1);
      try {
        return JSON.parse(jsonText);
      } catch (e2) {
        // 继续尝试
      }
    }
    
    console.error('[2c_understand] 无法提取JSON，响应前500字符:', text.substring(0, 500));
    throw new Error('无法从响应中提取JSON。请检查响应格式。');
  }
}

async function loadVideo(videoUrlOrPath) {
  if (fs.existsSync(videoUrlOrPath)) {
    console.log('[2c_understand] 读取本地视频文件:', videoUrlOrPath);
    return fs.readFileSync(videoUrlOrPath);
  }
  
  console.log('[2c_understand] 下载视频:', videoUrlOrPath);
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
      shotRanges.push(`镜头${i + 1}: ${start.toFixed(2)}s - ${end.toFixed(2)}s`);
    }
    timestampConstraint = `\n# 预处理时间戳参考
视频已被预处理切分为 ${timestamps.length} 个镜头：
${shotRanges.join('\n')}

请参考这些时间戳进行分析，可以根据视频实际内容微调切点位置。`;
  }

  // 构建资产定义（从固定文件加载）
  let assetsContext = '';
  if (assets) {
    assetsContext = `\n# 资产定义（已固定，请直接使用以下资产名称）

## 人物资产
${Object.entries(assets.人物 || {}).map(([name, info]) => 
  `【${name}】${info.角色 || ''}
  - 外貌: ${info.外貌 || ''}
  - 古装: ${info.古装 || info.服装 || ''}
  - 现代装: ${info.现代装 || ''}`
).join('\n\n')}

## 场景资产
${Object.entries(assets.场景 || {}).map(([name, info]) => 
  `【${name}】${info.类型 || ''}
  - 描述: ${info.描述 || ''}
  - 光线: ${info.光线 || ''}
  - 氛围: ${info.氛围 || ''}`
).join('\n\n')}

## 特效资产
${Object.entries(assets.特效 || {}).map(([name, info]) => 
  `【${name}】${info.描述 || ''}`
).join('\n')}

**重要**：在输出中必须使用上述资产名称（如"秦狩"、"秦无敌"、"寝殿"），不要使用"主角A"等通用名称。`;
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
你是"专业影视分镜结构化专家"。你的任务是：深度分析视频，输出结构化分镜数据（JSON）。

# 关键约束（必须遵守）

1. **资产使用**：资产已在上方定义好，请直接使用这些资产名称（如"秦狩"、"寝殿"），不要自行创建"主角A"等通用名称。

2. **时间戳参考**：如果上方提供了"预处理时间戳参考"，你必须：
   - 参考这些时间戳作为镜头切分的依据
   - 每个镜头的 timecode.start 和 timecode.end 应该尽量贴近预处理时间戳
   - 如果预处理切点明显不准确，可以微调（±0.5s）
   - 镜头数量应与预处理时间戳数量一致或接近

3. **剧本对照**：如果上方提供了"剧本参考"，请对照剧本内容理解每个镜头的叙事意图，确保 visual_brief 和动作描述与剧本一致。

# 第一步：镜头分析
对每个镜头进行详细分析，使用已定义的资产名称，参考预处理时间戳。

# 第二步：生成单元划分
根据时长和场景关系，将镜头划分为"生成单元"：
1. **单镜头单元**: 时长 > 2s 的独立镜头
2. **双镜头配对**: 同场景相邻镜头 / 动作连续的镜头
3. **蒙太奇单元**: 快速切换（<1s/shot）的连续镜头

规则：
- 单 shot < 1s 的必须并入配对
- 配对总时长建议 2-6s
- 标注每个单元的建议生成时长

# Prompt 结构（必须包含，全部使用中文）

## 必填字段
1. **正文**: 【资产ID】+ 所在【场景ID】+ 状态描述
2. **动作**: 正在做什么，动作过程描述（动词开头）
3. **风格**: 电影类型关键词（古装剧/动作片/科幻/恐怖等）

## 选填字段（推荐填写以提高还原率）
4. **相机位置**: 角度 + 运镜方式，如"低角度仰拍，镜头缓慢推进" / "平视，手持跟随"
5. **构图**: 远景/全景/中景/近景/特写 + 单人/双人/群像
6. **对焦效果**: 浅景深/深景深/柔焦/微距
7. **氛围**: 色调 + 光线类型 + 情绪关键词

## 剪辑技巧（用于生成单元的"过渡类型"）
- **正反打**: 对话场景，交替展示对话双方
- **动作剪辑**: 连续动作的自然衔接
- **情绪变化**: 表情或心理状态的转变
- **时间跳跃**: 场景或时间的切换
- **快速剪辑**: 蒙太奇，多个短镜头快速切换

# Output Schema (JSON)
{
  "meta": {
    "video_id": "string",
    "total_duration_s": float,
    "total_shots": int,
    "total_units": int
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
        "场景": "寝殿"
      },
      "visual_brief": "一句话画面描述（中文）",
      "technical": {
        "shot_size": "景别枚举值",
        "angle": "角度枚举值",
        "movement": "运镜枚举值",
        "lighting": "光线枚举值"
      }
    }
  ],
  
  "生成单元": [
    {
      "unit_id": 1,
      "类型": "单镜头",
      "包含全局shots": [1],
      "时长建议": "4-5秒",
      
      "共同属性": {
        "场景": "寝殿",
        "风格": "古装玄幻剧",
        "氛围": "暖色调，烛光照明，神秘"
      },
      
      "shot": {
        "序号": 1,
        "分镜图": "shot_01.png",
        "正文": "【秦狩】躺在床榻上",
        "动作": "眼神迷离望向上方，随后猛然睁大双眼",
        "相机": {
          "角度": "低角度仰拍",
          "运镜": "静态",
          "景别": "近景"
        },
        "构图": "单人人像",
        "对焦": "浅景深，人物清晰"
      },
      
      "整合prompt": "【寝殿】【秦狩】躺在雕花床榻上，身穿深蓝色古装长袍。他眼神迷离望向上方，口中呢喃，随后猛然睁大双眼，表情震惊。近景人像，低角度仰拍，静态镜头。浅景深，暖色调烛光照明。古装玄幻剧风格。"
    },
    {
      "unit_id": 2,
      "类型": "双镜头配对",
      "包含全局shots": [2, 3],
      "剪辑手法": "动作剪辑",
      "过渡方式": "硬切",
      "时长建议": "1.5-2秒",
      
      "共同属性": {
        "场景": "现代街道",
        "风格": "动作片，快节奏",
        "氛围": "自然日光，动感冲击"
      },
      
      "shots": [
        {
          "序号": 1,
          "分镜图": "shot_02.png",
          "正文": "【秦狩-现代】跑酷跳跃",
          "动作": "飞身扑向建筑",
          "相机": {
            "角度": "平视",
            "运镜": "跟随",
            "景别": "中全景"
          },
          "构图": "人物居中",
          "对焦": "动态追焦"
        },
        {
          "序号": 2,
          "分镜图": "shot_03.png",
          "正文": "【秦狩-现代】脚部落地",
          "动作": "鞋落地，灰尘溅起",
          "相机": {
            "角度": "地面仰视",
            "运镜": "静态",
            "景别": "特写"
          },
          "构图": "脚部特写",
          "对焦": "微距"
        }
      ],
      
      "整合prompt": "【动作剪辑·硬切】【现代街道】\nShot 1: 【秦狩-现代】穿蓝色卫衣跑酷跳跃，飞身扑向建筑。平视跟随，中全景。\n【硬切】\nShot 2: 黑色运动鞋落地，灰尘飞溅。地面仰视，脚部特写。\n动作片风格，快节奏，自然日光。"
    }
  ]
}

# 枚举标准
- **景别**: 远景, 全景, 中全景, 中景, 中近景, 近景, 特写, 大特写
- **角度**: 平视, 仰拍, 俯拍, 鸟瞰, 荷兰角, 地面视角
- **运镜**: 静态, 横摇, 纵摇, 推拉, 跟随, 轨道, 摇臂, 手持, 升降, 环绕, 变焦
- **光线**: 自然光, 硬光, 柔光, 电影光, 霓虹, 低调, 高调

# 特殊剪辑技巧识别
- **正反打 (Shot-Reverse-Shot)**: 常用于对话场景，交替展示对话双方的画面。识别特征：
  - 连续两个镜头交替展示不同人物
  - 通常角度相反（如：正面 ↔ 背面，左 ↔ 右）
  - 时长较短，快速切换
  - 在"生成单元"中标注"过渡类型"为"正反打"
  
- **蒙太奇**: 快速切换的多个短镜头（通常 <1s），用于表现时间流逝、情绪变化、回忆等

# Prompt 中的运镜描述
在 prompt.相机位置 中，应包含：
- 角度（平视/仰拍/俯拍等）
- 运镜方式（静态/推拉/跟随/环绕等）
- 示例："低角度仰拍，镜头缓慢推进" / "平视，手持跟随运动"

# 关键要求
1. 所有描述字段使用中文
2. 资产ID在后续描述中保持一致引用
3. 整合prompt必须包含所有字段的内容
4. 太短的镜头（<1s）必须配对，不能单独输出
5. 配对镜头过渡方式明确标注：硬切/溶解/淡入淡出
6. **生成单元内的 shot 序号从 1 开始，不要使用全局 shot id**
7. **单镜头单元用 "shot" 对象，双镜头用 "shots" 数组**
8. **每个 shot 的相机参数必须独立完整（角度/运镜/景别）**`;

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
  
  console.log('[2c_understand] 调用VLM API分析视频（优化版）...');
  console.log('[2c_understand] 使用模型:', GEMINI_MODEL);
  console.log('[2c_understand] 视频帧速率 (FPS):', fps);
  console.log('[2c_understand] API端点:', url.replace(YUNWU_API_KEY, '***'));
  
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
  
  if (!result.candidates || !Array.isArray(result.candidates) || result.candidates.length === 0) {
    throw new Error(`VLM API返回格式异常: ${JSON.stringify(result).substring(0, 200)}`);
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
    console.log('[2c_understand] 完整响应结构:', JSON.stringify(result, null, 2).substring(0, 1000));
    throw new Error(`VLM API未返回有效内容。响应结构: ${JSON.stringify(result).substring(0, 300)}`);
  }

  console.log('[2c_understand] VLM响应长度:', textContent.length);
  console.log('[2c_understand] VLM响应前1000字符:', textContent.substring(0, 1000));
  
  return extractJsonFromResponse(textContent);
}

/**
 * 生成可读的输出文件（给下游模型使用）
 */
function generateReadableOutput(data, videoName, assets) {
  const lines = [];
  
  lines.push('═'.repeat(70));
  lines.push(`${videoName} 视频还原任务`);
  lines.push('═'.repeat(70));
  lines.push('');
  
  // 资产定义（从固定文件加载）
  if (assets) {
    lines.push('【资产定义】（已固定）');
    lines.push('');
    
    if (assets.人物) {
      lines.push('人物:');
      for (const [id, info] of Object.entries(assets.人物)) {
        lines.push(`• ${id}: ${info.外貌 || ''}，${info.古装 || info.服装 || ''}`);
      }
      lines.push('');
    }
    
    if (assets.场景) {
      lines.push('场景:');
      for (const [id, info] of Object.entries(assets.场景)) {
        lines.push(`• ${id}: ${info.描述 || ''}，${info.光线 || ''}`);
      }
      lines.push('');
    }
    
    lines.push('═'.repeat(70));
    lines.push('');
  }
  
  // 生成单元
  if (data.生成单元 && Array.isArray(data.生成单元)) {
    for (const unit of data.生成单元) {
      const globalShots = unit.包含全局shots || unit.包含shots || [];
      const shotsStr = globalShots.join(', ');
      
      // 标题行
      let titleLine = `【生成单元 ${unit.unit_id}】${unit.类型} | ${unit.时长建议}`;
      if (globalShots.length > 0) {
        titleLine += ` | 全局Shots: ${shotsStr}`;
      }
      if (unit.剪辑手法) {
        titleLine += ` | ${unit.剪辑手法}`;
      }
      if (unit.过渡方式) {
        titleLine += ` (${unit.过渡方式})`;
      }
      lines.push(titleLine);
      lines.push('');
      
      // 共同属性
      if (unit.共同属性) {
        const common = unit.共同属性;
        if (common.场景) lines.push(`场景: ${common.场景}`);
        if (common.风格) lines.push(`风格: ${common.风格}`);
        if (common.氛围) lines.push(`氛围: ${common.氛围}`);
        lines.push('');
      }
      
      // 单镜头
      if (unit.shot) {
        const shot = unit.shot;
        lines.push(`Shot ${shot.序号}: ${shot.分镜图 || ''}`);
        if (shot.正文) lines.push(`  正文: ${shot.正文}`);
        if (shot.动作) lines.push(`  动作: ${shot.动作}`);
        if (shot.相机) {
          const cam = shot.相机;
          lines.push(`  相机: ${cam.角度 || ''}, ${cam.运镜 || ''}, ${cam.景别 || ''}`);
        }
        if (shot.构图) lines.push(`  构图: ${shot.构图}`);
        if (shot.对焦) lines.push(`  对焦: ${shot.对焦}`);
        lines.push('');
      }
      
      // 多镜头
      if (unit.shots && Array.isArray(unit.shots)) {
        for (const shot of unit.shots) {
          lines.push(`Shot ${shot.序号}: ${shot.分镜图 || ''}`);
          if (shot.正文) lines.push(`  正文: ${shot.正文}`);
          if (shot.动作) lines.push(`  动作: ${shot.动作}`);
          if (shot.相机) {
            const cam = shot.相机;
            lines.push(`  相机: ${cam.角度 || ''}, ${cam.运镜 || ''}, ${cam.景别 || ''}`);
          }
          if (shot.构图) lines.push(`  构图: ${shot.构图}`);
          if (shot.对焦) lines.push(`  对焦: ${shot.对焦}`);
          lines.push('');
        }
      }
      
      // 整合 prompt
      if (unit.整合prompt) {
        lines.push(`>>> ${unit.整合prompt}`);
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
    
    console.log('[2c_understand] 使用 API Key:', process.env.YUNWU_API_KEY_UV ? 'YUNWU_API_KEY_UV' : 'YUNWU_API_KEY');

    const videoPathArg = process.argv[2];
    let videoBuffer;
    let videoSource;
    
    if (videoPathArg) {
      const specifiedPath = path.isAbsolute(videoPathArg) 
        ? videoPathArg 
        : path.join(__dirname, videoPathArg);
      
      if (fs.existsSync(specifiedPath)) {
        console.log('[2c_understand] 使用命令行指定的视频文件:', specifiedPath);
        videoBuffer = await loadVideo(specifiedPath);
        videoSource = specifiedPath;
      } else {
        throw new Error(`指定的视频文件不存在: ${specifiedPath}`);
      }
    }
    
    if (!videoBuffer) {
      const test2Path = path.join(__dirname, 'output', 'test2.mp4');
      if (fs.existsSync(test2Path)) {
        console.log('[2c_understand] 使用指定的视频文件: test2.mp4');
        videoBuffer = await loadVideo(test2Path);
        videoSource = test2Path;
      }
    }
    
    if (!videoBuffer) {
      const outputDir = path.join(__dirname, 'output');
      if (fs.existsSync(outputDir)) {
        const localVideoFiles = fs.readdirSync(outputDir)
          .filter(f => f.endsWith('.mp4') && f !== 'test2.mp4')
          .map(f => path.join(outputDir, f));
        
        if (localVideoFiles.length > 0) {
          const localVideo = localVideoFiles[0];
          console.log('[2c_understand] 使用本地视频文件:', path.basename(localVideo));
          videoBuffer = await loadVideo(localVideo);
          videoSource = localVideo;
        }
      }
    }
    
    if (!videoBuffer) {
      throw new Error(`未找到视频源。用法: node 02c_understand_vlm_optimized.js [视频路径]`);
    }
    
    console.log('[2c_understand] 视频来源:', videoSource);

    // 读取预处理的时间戳
    let scenes = null;
    const videoName = path.basename(videoSource, path.extname(videoSource));
    
    // 尝试多个可能的路径
    const possiblePaths = [
      path.join(__dirname, 'output', `detected_${videoName}`, 'scenes.json'),
      path.join(__dirname, 'output', 'detected_frames', 'scenes.json')
    ];
    
    for (const scenesPath of possiblePaths) {
      if (fs.existsSync(scenesPath)) {
        // 检查 scenes.json 中的 video 字段是否匹配
        const tempScenes = JSON.parse(fs.readFileSync(scenesPath, 'utf-8'));
        if (tempScenes.video === `${videoName}.mp4` || possiblePaths.indexOf(scenesPath) === 0) {
          console.log('[2c_understand] 读取预处理时间戳:', scenesPath);
          scenes = tempScenes;
          console.log('[2c_understand] 预处理场景数:', scenes.scene_count || scenes.timestamps?.length || 0);
          console.log('[2c_understand] 时间戳:', scenes.timestamps?.map(t => `${t.toFixed(2)}s`).join(', '));
          break;
        }
      }
    }
    
    if (!scenes) {
      console.warn('[2c_understand] ⚠️  未找到预处理时间戳文件，VLM将自行判断切点');
    }

    // 读取对应的剧本文件
    let scriptContent = null;
    const scriptPath = path.join(__dirname, 'input', 's1', 'scripts', `${videoName}_script.txt`);
    
    if (fs.existsSync(scriptPath)) {
      console.log('[2c_understand] 读取剧本文件:', scriptPath);
      scriptContent = fs.readFileSync(scriptPath, 'utf-8');
      console.log('[2c_understand] 剧本内容长度:', scriptContent.length, '字符');
    } else {
      console.warn('[2c_understand] ⚠️  未找到对应剧本文件:', scriptPath);
    }

    // 读取资产定义文件
    let assets = null;
    const assetsPath = path.join(__dirname, 'input', 's1', 'assets.json');
    
    if (fs.existsSync(assetsPath)) {
      console.log('[2c_understand] 读取资产定义:', assetsPath);
      assets = JSON.parse(fs.readFileSync(assetsPath, 'utf-8'));
      console.log('[2c_understand] 人物资产:', Object.keys(assets.人物 || {}).length);
      console.log('[2c_understand] 场景资产:', Object.keys(assets.场景 || {}).length);
    } else {
      console.warn('[2c_understand] ⚠️  未找到资产定义文件:', assetsPath);
    }

    // 调用VLM分析（传入剧本内容和资产定义）
    const analysisData = await analyzeVideo(videoBuffer, scenes, scriptContent, assets);

    // 保存JSON结果
    const outputFileName = process.argv[3] || `${videoName}_optimized.json`;
    const outputPath = path.join(__dirname, 'output', outputFileName);
    fs.writeFileSync(outputPath, JSON.stringify(analysisData, null, 2), 'utf-8');
    console.log('[2c_understand] JSON结果已保存:', outputPath);

    // 生成可读的文本输出
    const readableOutput = generateReadableOutput(analysisData, videoName, assets);
    const textOutputPath = path.join(__dirname, 'output', `${videoName}_prompts_optimized.txt`);
    fs.writeFileSync(textOutputPath, readableOutput, 'utf-8');
    console.log('[2c_understand] 可读文本已保存:', textOutputPath);

    // 输出统计
    console.log('[2c_understand] ─'.repeat(35));
    console.log('[2c_understand] 分析完成:');
    console.log('[2c_understand]   镜头数:', analysisData.shots?.length || 0);
    console.log('[2c_understand]   生成单元数:', analysisData.生成单元?.length || 0);
    console.log('[2c_understand]   人物资产:', Object.keys(analysisData.资产列表?.人物 || {}).length);
    console.log('[2c_understand]   场景资产:', Object.keys(analysisData.资产列表?.场景 || {}).length);
    
  } catch (error) {
    console.error('[2c_understand] 执行失败:', error.message || error);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

if (typeof fetch !== 'function') {
  console.error('[2c_understand] 需要 Node.js 18+ (支持原生 fetch)');
  process.exit(1);
}

main();

