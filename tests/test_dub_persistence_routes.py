# -*- coding: utf-8 -*-
"""
持久化链路集成测试（不启动 FastAPI / TestClient，避免 startup 与线程死锁）：

1. 在隔离 DATA_ROOT 下写入最小 episode.json
2. 调用 data_service.update_episode / update_shot（与 PATCH 路由相同的写盘路径）
3. get_episode 后使用与 dub_route.dub_process 相同的 _voice_id_for_shot 解析音色

从而证明「PATCH 落盘 → 再次读取 → 与批量配音解析一致」，与 POST /dub/process 内循环同源。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SERVER_DIR = _REPO_ROOT / "web" / "server"
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))


@pytest.fixture
def tmp_data_root(monkeypatch, tmp_path: Path) -> Path:
    import services.data_service as ds  # noqa: PLC0415

    monkeypatch.setattr(ds, "_CONFIG_DATA_ROOT", tmp_path)
    return tmp_path


def _write_minimal_episode(ep_dir: Path) -> None:
    payload = {
        "projectId": "proj-int",
        "episodeId": "ep-int",
        "episodeTitle": "Integration",
        "episodeNumber": 1,
        "pulledAt": "2026-03-30T12:00:00Z",
        "dubDefaultVoiceId": "",
        "scenes": [
            {
                "sceneId": "sc-1",
                "sceneNumber": 1,
                "title": "S",
                "shots": [
                    {
                        "shotId": "shot-a",
                        "shotNumber": 1,
                        "imagePrompt": "i",
                        "videoPrompt": "v",
                        "duration": 5,
                        "cameraMovement": "push_in",
                        "aspectRatio": "9:16",
                        "firstFrame": "frames/f.png",
                        "assets": [],
                        "status": "selected",
                        "endFrame": None,
                        "dubVoiceIdOverride": "",
                        "videoCandidates": [
                            {
                                "id": "cand-1",
                                "videoPath": "videos/a.mp4",
                                "thumbnailPath": "",
                                "seed": 1,
                                "model": "m",
                                "mode": "first_frame",
                                "selected": True,
                                "createdAt": "",
                                "taskId": "t1",
                                "taskStatus": "success",
                            }
                        ],
                    },
                    {
                        "shotId": "shot-b",
                        "shotNumber": 2,
                        "imagePrompt": "i",
                        "videoPrompt": "v",
                        "duration": 5,
                        "cameraMovement": "push_in",
                        "aspectRatio": "9:16",
                        "firstFrame": "frames/f2.png",
                        "assets": [],
                        "status": "selected",
                        "endFrame": None,
                        "dubVoiceIdOverride": "",
                        "videoCandidates": [
                            {
                                "id": "cand-2",
                                "videoPath": "videos/b.mp4",
                                "thumbnailPath": "",
                                "seed": 1,
                                "model": "m",
                                "mode": "first_frame",
                                "selected": True,
                                "createdAt": "",
                                "taskId": "t2",
                                "taskStatus": "success",
                            }
                        ],
                    },
                ],
            }
        ],
        "assets": [],
    }
    ep_dir.mkdir(parents=True, exist_ok=True)
    (ep_dir / "episode.json").write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def test_update_episode_and_shot_then_resolve_matches_dub_process_logic(
    tmp_data_root: Path,
) -> None:
    """模拟 PATCH 后磁盘状态；解析结果须与 dub_route._voice_id_for_shot / dub_process 一致。"""
    from services import data_service  # noqa: PLC0415
    from routes.dub_route import _voice_id_for_shot  # noqa: PLC0415

    ep_dir = tmp_data_root / "proj-int" / "ep-int"
    _write_minimal_episode(ep_dir)

    data_service.update_episode("ep-int", {"dubDefaultVoiceId": "voice-ep"}, None)
    data_service.update_shot(
        "ep-int",
        "shot-b",
        {"dubVoiceIdOverride": "voice-shot-b"},
        None,
    )

    ep = data_service.get_episode("ep-int", None)
    assert ep is not None
    assert ep.dubDefaultVoiceId == "voice-ep"

    shot_a = next(s for s in ep.scenes[0].shots if s.shotId == "shot-a")
    shot_b = next(s for s in ep.scenes[0].shots if s.shotId == "shot-b")
    assert shot_b.dubVoiceIdOverride == "voice-shot-b"

    assert _voice_id_for_shot(ep, shot_a) == "voice-ep"
    assert _voice_id_for_shot(ep, shot_b) == "voice-shot-b"
