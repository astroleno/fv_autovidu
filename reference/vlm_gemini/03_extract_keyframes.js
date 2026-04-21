/**
 * 关键帧提取脚本
 * 基于 shots.json 中的 keyframe_timestamp 提取每个 shot 的首帧
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function checkFFmpeg() {
  try {
    execSync('which ffmpeg', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

async function downloadVideoIfNeeded(videoUrlOrPath) {
  // 如果是本地文件，直接返回路径
  if (fs.existsSync(videoUrlOrPath)) {
    return videoUrlOrPath;
  }
  
  // 如果是 URL，下载到临时文件
  if (videoUrlOrPath.startsWith('http')) {
    console.log('[extract_keyframes] 下载视频:', videoUrlOrPath);
    const resp = await fetch(videoUrlOrPath);
    if (!resp.ok) {
      throw new Error(`下载视频失败: HTTP ${resp.status}`);
    }
    
    const buffer = await resp.arrayBuffer();
    const tempPath = path.join(__dirname, 'output', 'temp_video.mp4');
    fs.writeFileSync(tempPath, Buffer.from(buffer));
    console.log('[extract_keyframes] 视频已下载到:', tempPath);
    return tempPath;
  }
  
  throw new Error('无效的视频路径或 URL');
}

function extractFrame(videoPath, timestamp, outputPath) {
  // 使用 ffmpeg 提取指定时间戳的帧
  // -ss: 定位到指定时间
  // -i: 输入文件
  // -vframes 1: 只提取一帧
  // -q:v 2: 高质量输出
  const command = `ffmpeg -ss ${timestamp} -i "${videoPath}" -vframes 1 -q:v 2 -y "${outputPath}"`;
  
  try {
    execSync(command, { stdio: 'pipe' });
    return true;
  } catch (error) {
    console.error(`[extract_keyframes] 提取帧失败 (时间戳: ${timestamp}):`, error.message);
    return false;
  }
}

async function main() {
  try {
    // 检查 ffmpeg
    if (!checkFFmpeg()) {
      throw new Error('未找到 ffmpeg。请先安装: brew install ffmpeg');
    }

    // 支持命令行参数指定 shots.json 路径
    const shotsPathArg = process.argv[2];
    const shotsPath = shotsPathArg 
      ? (path.isAbsolute(shotsPathArg) ? shotsPathArg : path.join(__dirname, shotsPathArg))
      : path.join(__dirname, 'output', 'shots.json');
    
    if (!fs.existsSync(shotsPath)) {
      throw new Error(`shots.json 不存在: ${shotsPath}\n请先运行 02_understand_vlm.js`);
    }
    
    const shotsData = JSON.parse(fs.readFileSync(shotsPath, 'utf-8'));
    const shots = shotsData.shots || [];
    
    if (shots.length === 0) {
      throw new Error('shots.json 中没有找到镜头数据');
    }
    
    console.log(`[extract_keyframes] 读取: ${path.basename(shotsPath)}`);
    console.log(`[extract_keyframes] 找到 ${shots.length} 个镜头`);

    // 支持命令行参数指定视频路径
    const videoPathArg = process.argv[3];
    let videoPath;
    
    // 1. 如果命令行指定了视频路径，优先使用
    if (videoPathArg) {
      const specifiedPath = path.isAbsolute(videoPathArg) 
        ? videoPathArg 
        : path.join(__dirname, videoPathArg);
      
      if (fs.existsSync(specifiedPath)) {
        videoPath = specifiedPath;
        console.log('[extract_keyframes] 使用命令行指定的视频文件:', specifiedPath);
      } else {
        throw new Error(`指定的视频文件不存在: ${specifiedPath}`);
      }
    }
    
    // 2. 如果没有指定，优先使用 test2.mp4
    if (!videoPath) {
      const test2Path = path.join(__dirname, 'output', 'test2.mp4');
      if (fs.existsSync(test2Path)) {
        videoPath = test2Path;
        console.log('[extract_keyframes] 使用指定的视频文件: test2.mp4');
      }
    }
    
    // 3. 如果没有 test2.mp4，检查其他本地文件
    if (!videoPath) {
      const outputDir = path.join(__dirname, 'output');
      const localVideoFiles = fs.readdirSync(outputDir)
        .filter(f => f.endsWith('.mp4') && f !== 'temp_video.mp4' && f !== 'test2.mp4')
        .map(f => path.join(outputDir, f));
      
      if (localVideoFiles.length > 0) {
        videoPath = localVideoFiles[0];
        console.log('[extract_keyframes] 使用本地视频文件:', path.basename(videoPath));
      }
    }
    
    // 4. 如果没有本地文件，使用 URL
    if (!videoPath) {
      const previewUrlPath = path.join(__dirname, 'output', 'preview_url.txt');
      if (fs.existsSync(previewUrlPath)) {
        const videoUrl = fs.readFileSync(previewUrlPath, 'utf-8').trim();
        if (videoUrl && videoUrl.startsWith('http')) {
          videoPath = await downloadVideoIfNeeded(videoUrl);
          console.log('[extract_keyframes] 使用预演视频URL');
        }
      }
    }
    
    if (!videoPath) {
      throw new Error('未找到视频文件。用法: node 03_extract_keyframes.js [shots.json路径] [视频路径]');
    }

    // 支持命令行参数指定输出目录
    const outputDirArg = process.argv[4];
    const framesDir = outputDirArg
      ? (path.isAbsolute(outputDirArg) ? outputDirArg : path.join(__dirname, outputDirArg))
      : path.join(__dirname, 'output', 'firstframes');
    
    if (!fs.existsSync(framesDir)) {
      fs.mkdirSync(framesDir, { recursive: true });
    }
    
    console.log(`[extract_keyframes] 输出目录: ${framesDir}`);

    // 提取每个 shot 的关键帧并构建映射表
    console.log('[extract_keyframes] 开始提取关键帧...');
    let successCount = 0;
    let failCount = 0;
    
    // 映射表容器：存储 shot ID 与帧文件的映射关系
    const frameMapping = {
      source_video: path.basename(videoPath),
      source_shots_json: path.basename(shotsPath),
      extracted_at: new Date().toISOString(),
      frames_dir: path.relative(__dirname, framesDir),
      shots: []
    };

    for (const shot of shots) {
      const shotId = shot.id;
      const timestamp = shot.keyframe_timestamp;
      
      if (timestamp === undefined || timestamp === null) {
        // 如果没有 keyframe_timestamp，使用 start + (end - start) / 2
        const start = shot.timecode?.start || shot.time_range?.start || 0;
        const end = shot.timecode?.end || shot.time_range?.end || 0;
        const midTime = start + (end - start) / 2;
        console.log(`[extract_keyframes] Shot ${shotId} 没有 keyframe_timestamp，使用中间时间: ${midTime.toFixed(2)}s`);
        shot.keyframe_timestamp = midTime;
      }
      
      const frameFileName = `shot_${shotId.toString().padStart(2, '0')}.jpg`;
      const outputPath = path.join(framesDir, frameFileName);
      
      console.log(`[extract_keyframes] 提取 Shot ${shotId} 的关键帧 (时间戳: ${shot.keyframe_timestamp}s) -> ${frameFileName}`);
      
      const extracted = extractFrame(videoPath, shot.keyframe_timestamp, outputPath);
      
      // 构建映射表条目
      const mappingEntry = {
        shot_id: shotId,
        keyframe_timestamp: shot.keyframe_timestamp,
        frame_file: frameFileName,
        frame_path: path.relative(__dirname, outputPath),
        extracted: extracted,
        timecode: shot.timecode || shot.time_range || null,
        visual_brief: shot.visual_brief || null,
        script_content: shot.script_content || null,
        veo_prompt: shot.veo_prompt || null
      };
      
      frameMapping.shots.push(mappingEntry);
      
      if (extracted) {
        successCount++;
      } else {
        failCount++;
      }
    }

    console.log(`[extract_keyframes] 完成！成功: ${successCount}, 失败: ${failCount}`);
    console.log(`[extract_keyframes] 关键帧保存在: ${framesDir}`);
    
    // 保存映射表到 JSON 文件
    const mappingFileName = path.basename(shotsPath, '.json') + '_frames_mapping.json';
    const mappingPath = path.join(__dirname, 'output', mappingFileName);
    fs.writeFileSync(mappingPath, JSON.stringify(frameMapping, null, 2), 'utf-8');
    console.log(`[extract_keyframes] 映射表已保存: ${mappingPath}`);
    console.log(`[extract_keyframes] 映射表包含 ${frameMapping.shots.length} 个镜头映射`);
    
    // 拼合关键帧成容器
    if (successCount > 0) {
      console.log(`\n[extract_keyframes] ====== 开始拼合关键帧成容器 ======`);
      try {
        const combineScript = path.join(__dirname, 'combine_shots.js');
        if (fs.existsSync(combineScript)) {
          // 调用 combine_shots.js 脚本
          // combine_shots.js 接受: [输入目录] [shot数量] --output=[输出目录]
          const combinedOutputPath = path.join(framesDir, 'combined_shots.jpg');
          const combineCmd = `node "${combineScript}" "${framesDir}" ${successCount} --output="${path.dirname(combinedOutputPath)}"`;
          
          console.log(`[extract_keyframes] 执行拼合命令...`);
          execSync(combineCmd, { stdio: 'inherit', cwd: __dirname });
          
          // 更新映射表，添加拼合后的容器路径
          if (fs.existsSync(combinedOutputPath)) {
            frameMapping.combined_container = {
              file: 'combined_shots.jpg',
              path: path.relative(__dirname, combinedOutputPath),
              absolute_path: combinedOutputPath,
              created_at: new Date().toISOString(),
              shot_count: successCount
            };
            
            // 重新保存映射表（包含容器信息）
            fs.writeFileSync(mappingPath, JSON.stringify(frameMapping, null, 2), 'utf-8');
            console.log(`[extract_keyframes] ✅ 拼合完成: ${combinedOutputPath}`);
            console.log(`[extract_keyframes] 容器已添加到映射表`);
            
            // 显示容器文件信息
            const stats = fs.statSync(combinedOutputPath);
            console.log(`[extract_keyframes] 容器文件大小: ${(stats.size / 1024).toFixed(1)} KB`);
          } else {
            console.warn(`[extract_keyframes] ⚠️  拼合后的文件不存在: ${combinedOutputPath}`);
          }
        } else {
          console.warn(`[extract_keyframes] ⚠️  combine_shots.js 不存在，跳过拼合步骤`);
        }
      } catch (error) {
        console.error(`[extract_keyframes] ❌ 拼合失败:`, error.message || error);
        console.warn(`[extract_keyframes] ⚠️  可以手动执行: node combine_shots.js "${framesDir}" ${successCount}`);
      }
      console.log(`[extract_keyframes] ====== 拼合完成 ======\n`);
    }

    // 清理临时文件
    const tempVideoPath = path.join(__dirname, 'output', 'temp_video.mp4');
    if (fs.existsSync(tempVideoPath) && videoPath === tempVideoPath) {
      console.log('[extract_keyframes] 清理临时视频文件...');
      fs.unlinkSync(tempVideoPath);
    }

  } catch (error) {
    console.error('[extract_keyframes] 执行失败:', error.message || error);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

if (typeof fetch !== 'function') {
  console.error('[extract_keyframes] 需要 Node.js 18+ (支持原生 fetch)');
  process.exit(1);
}

main();

