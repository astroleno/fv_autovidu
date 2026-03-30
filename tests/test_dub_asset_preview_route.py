# -*- coding: utf-8 -*-
"""
角色资产试听路由测试。
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SERVER_DIR = _REPO_ROOT / "web" / "server"
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))


def _write_episode(ep_dir: Path) -> None:
    payload = {
        "projectId": "proj-preview",
        "episodeId": "ep-preview",
        "episodeTitle": "Preview",
        "episodeNumber": 1,
        "pulledAt": "2026-03-30T12:00:00Z",
        "characterVoices": {
            "asset-alice": {
                "voiceId": "voice-alice",
                "previewText": "我是 Alice。",
                "previewAudioPath": "",
            }
        },
        "assets": [
            {
                "assetId": "asset-alice",
                "name": "Alice",
                "type": "character",
                "localPath": "assets/alice.png",
                "prompt": "",
            }
        ],
        "scenes": [],
    }
    ep_dir.mkdir(parents=True, exist_ok=True)
    (ep_dir / "episode.json").write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def _request_without_context():
    return SimpleNamespace(state=SimpleNamespace(feeling_context=None))


class TestDubAssetPreviewRoute(unittest.TestCase):
    def test_generate_asset_voice_preview_persists_audio_path(self) -> None:
        import services.data_service as data_service  # noqa: PLC0415
        from routes import dub_route  # noqa: PLC0415
        from models.schemas import AssetVoicePreviewRequest  # noqa: PLC0415

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ep_dir = root / "proj-preview" / "ep-preview"
            _write_episode(ep_dir)

            req = AssetVoicePreviewRequest(
                episodeId="ep-preview",
                assetId="asset-alice",
                voiceId="voice-alice",
                previewText="这是 Alice 的试听。",
            )

            with (
                patch.object(data_service, "_CONFIG_DATA_ROOT", root),
                patch.object(dub_route.elevenlabs_service, "is_configured", return_value=True),
                patch.object(
                    dub_route.elevenlabs_service,
                    "text_to_speech",
                    return_value=(b"fake-mp3", "audio/mpeg"),
                ),
            ):
                res = dub_route.preview_asset_voice(req, _request_without_context())

                self.assertEqual(res.voiceId, "voice-alice")
                self.assertEqual(res.previewText, "这是 Alice 的试听。")
                self.assertTrue(res.audioPath.startswith("dub_previews/asset-alice_preview"))
                self.assertEqual((ep_dir / res.audioPath).read_bytes(), b"fake-mp3")

                ep = data_service.get_episode("ep-preview", None)
                assert ep is not None
                binding = ep.characterVoices["asset-alice"]
                self.assertEqual(binding.voiceId, "voice-alice")
                self.assertEqual(binding.previewText, "这是 Alice 的试听。")
                self.assertEqual(binding.previewAudioPath, res.audioPath)


if __name__ == "__main__":
    unittest.main()
