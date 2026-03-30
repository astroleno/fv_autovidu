# -*- coding: utf-8 -*-
"""
角色资产音色绑定回归测试。
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SERVER_DIR = _REPO_ROOT / "web" / "server"
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))


def _write_episode(ep_dir: Path) -> None:
    payload = {
        "projectId": "proj-voice",
        "episodeId": "ep-voice",
        "episodeTitle": "Voice Bindings",
        "episodeNumber": 1,
        "pulledAt": "2026-03-30T12:00:00Z",
        "dubDefaultVoiceId": "voice-default",
        "characterVoices": {},
        "assets": [
            {
                "assetId": "asset-alice",
                "name": "Alice",
                "type": "character",
                "localPath": "assets/alice.png",
                "prompt": "",
            },
            {
                "assetId": "asset-bob",
                "name": "Bob",
                "type": "character",
                "localPath": "assets/bob.png",
                "prompt": "",
            },
        ],
        "scenes": [
            {
                "sceneId": "sc-1",
                "sceneNumber": 1,
                "title": "S1",
                "shots": [
                    {
                        "shotId": "shot-auto",
                        "shotNumber": 1,
                        "imagePrompt": "i",
                        "videoPrompt": "v",
                        "duration": 5,
                        "cameraMovement": "push_in",
                        "aspectRatio": "9:16",
                        "firstFrame": "frames/a.png",
                        "assets": [
                            {
                                "assetId": "asset-alice",
                                "name": "Alice",
                                "type": "character",
                                "localPath": "assets/alice.png",
                                "prompt": "",
                            }
                        ],
                        "status": "selected",
                        "endFrame": None,
                        "associatedDialogue": {"role": "Alice", "content": "你好"},
                        "dubVoiceIdOverride": "",
                        "videoCandidates": [
                            {
                                "id": "cand-a",
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
                        "shotId": "shot-manual",
                        "shotNumber": 2,
                        "imagePrompt": "i",
                        "videoPrompt": "v",
                        "duration": 5,
                        "cameraMovement": "push_in",
                        "aspectRatio": "9:16",
                        "firstFrame": "frames/b.png",
                        "assets": [
                            {
                                "assetId": "asset-bob",
                                "name": "Bob",
                                "type": "character",
                                "localPath": "assets/bob.png",
                                "prompt": "",
                            }
                        ],
                        "status": "selected",
                        "endFrame": None,
                        "associatedDialogue": {"role": "旁白", "content": "我来解释"},
                        "dubSpeakerAssetId": "asset-bob",
                        "dubVoiceIdOverride": "",
                        "videoCandidates": [
                            {
                                "id": "cand-b",
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
    }
    ep_dir.mkdir(parents=True, exist_ok=True)
    (ep_dir / "episode.json").write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


class TestCharacterVoiceBindings(unittest.TestCase):
    def test_character_voice_binding_is_used_before_episode_default(self) -> None:
        import services.data_service as data_service  # noqa: PLC0415
        from routes.dub_route import _voice_id_for_shot  # noqa: PLC0415

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ep_dir = root / "proj-voice" / "ep-voice"
            _write_episode(ep_dir)

            with patch.object(data_service, "_CONFIG_DATA_ROOT", root):
                data_service.update_episode(
                    "ep-voice",
                    {
                        "characterVoices": {
                            "asset-alice": {
                                "voiceId": "voice-alice",
                                "previewText": "我是 Alice。",
                                "previewAudioPath": "",
                            },
                            "asset-bob": {
                                "voiceId": "voice-bob",
                                "previewText": "我是 Bob。",
                                "previewAudioPath": "",
                            },
                        }
                    },
                    None,
                )

                ep = data_service.get_episode("ep-voice", None)
                assert ep is not None
                shot_auto = next(s for s in ep.scenes[0].shots if s.shotId == "shot-auto")
                shot_manual = next(s for s in ep.scenes[0].shots if s.shotId == "shot-manual")

                self.assertEqual(_voice_id_for_shot(ep, shot_auto), "voice-alice")
                self.assertEqual(_voice_id_for_shot(ep, shot_manual), "voice-bob")


if __name__ == "__main__":
    unittest.main()
