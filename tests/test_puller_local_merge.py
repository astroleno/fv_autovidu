# -*- coding: utf-8 -*-
"""
puller 重拉合并：旧 episode.json 本地字段（尾帧/候选/配音/状态/剪映导出）须写回新稿。
"""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path


class TestPullerLocalMerge(unittest.TestCase):
    def test_collect_prefers_richer_shot_and_jianying(self) -> None:
        from src.feeling.puller import _collect_local_episode_merge_state

        root = Path(tempfile.mkdtemp())
        try:
            a = root / "proj-default" / "ep-merge"
            b = root / "proj-real" / "ep-merge"
            a.mkdir(parents=True)
            b.mkdir(parents=True)
            (a / "episode.json").write_text(
                json.dumps(
                    {
                        "episodeId": "ep-merge",
                        "projectId": "proj-default",
                        "scenes": [
                            {
                                "sceneId": "s1",
                                "sceneNumber": 1,
                                "title": "",
                                "shots": [
                                    {
                                        "shotId": "sh1",
                                        "status": "pending",
                                        "videoCandidates": [],
                                    }
                                ],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (b / "episode.json").write_text(
                json.dumps(
                    {
                        "episodeId": "ep-merge",
                        "projectId": "proj-real",
                        "jianyingExport": {
                            "lastExportedAt": "2025-01-02T00:00:00Z",
                            "draftId": "draft-b",
                        },
                        "scenes": [
                            {
                                "sceneId": "s1",
                                "sceneNumber": 1,
                                "title": "",
                                "shots": [
                                    {
                                        "shotId": "sh1",
                                        "status": "video_done",
                                        "endFrame": "endframes/sh1_end.png",
                                        "videoCandidates": [
                                            {
                                                "id": "c1",
                                                "videoPath": "videos/sh1_c1.mp4",
                                                "thumbnailPath": "",
                                                "seed": 0,
                                                "model": "m",
                                                "mode": "first_frame",
                                                "resolution": "720p",
                                                "selected": True,
                                                "createdAt": "",
                                                "taskId": "",
                                                "taskStatus": "success",
                                                "isPreview": False,
                                            }
                                        ],
                                    }
                                ],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            st = _collect_local_episode_merge_state(root, "ep-merge")
            self.assertEqual(st["jianyingExport"]["draftId"], "draft-b")
            sh = st["shots_by_id"]["sh1"]
            self.assertEqual(sh["status"], "video_done")
            self.assertEqual(len(sh["videoCandidates"]), 1)
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_merge_into_platform_episode(self) -> None:
        from src.feeling.puller import _merge_local_episode_state_into_episode

        episode = {
            "projectId": "p",
            "episodeId": "e1",
            "episodeTitle": "t",
            "episodeNumber": 1,
            "pulledAt": "z",
            "scenes": [
                {
                    "sceneId": "s1",
                    "sceneNumber": 1,
                    "title": "",
                    "shots": [
                        {
                            "shotId": "sh1",
                            "shotNumber": 1,
                            "visualDescription": "vd",
                            "imagePrompt": "ip",
                            "videoPrompt": "vp",
                            "duration": 5,
                            "cameraMovement": "push_in",
                            "aspectRatio": "9:16",
                            "firstFrame": "frames/S001.png",
                            "assets": [],
                            "status": "pending",
                            "endFrame": None,
                            "videoCandidates": [],
                        }
                    ],
                }
            ],
            "assets": [],
        }
        local = {
            "shots_by_id": {
                "sh1": {
                    "status": "selected",
                    "endFrame": "endframes/S001_end.png",
                    "videoCandidates": [{"id": "c1", "videoPath": "videos/x.mp4"}],
                    "dub": {"status": "completed", "audioPath": "dub/sh1.mp3"},
                }
            },
            "jianyingExport": {"lastExportedAt": "t", "draftId": "d1"},
        }
        _merge_local_episode_state_into_episode(episode, local)
        sh = episode["scenes"][0]["shots"][0]
        self.assertEqual(sh["status"], "selected")
        self.assertEqual(sh["endFrame"], "endframes/S001_end.png")
        self.assertEqual(sh["videoCandidates"][0]["id"], "c1")
        self.assertEqual(sh["dub"]["audioPath"], "dub/sh1.mp3")
        self.assertEqual(episode["jianyingExport"]["draftId"], "d1")


if __name__ == "__main__":
    unittest.main()
