# -*- coding: utf-8 -*-
"""
单副本归一化相关回归测试（标准库 unittest，无需 pytest）。

覆盖：
- 平台 API 在归一化之前失败时，不删除旧 episode.json；
- 历史多副本时 _pick_best_episode_dir 优先画面描述更全的目录；
- episode_fs_lock 对同 episodeId 串行化；
- 尾帧 `_run_tail_frame`、单帧重生 `_run_regen_frame`、粗剪 `export_rough_cut`、剪映 `export_jianying_draft` 写盘路径持锁。
"""

from __future__ import annotations

import json
import shutil
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock


class TestPullDoesNotNormalizeBeforeApiSuccess(unittest.TestCase):
    """repull 失败回滚：先调平台 API，成功后才进入归一化与写盘。"""

    def test_get_scenes_failure_leaves_old_episode_json(self) -> None:
        from src.feeling.puller import pull_episode

        root = Path(tempfile.mkdtemp())
        try:
            old = root / "proj-default" / "ep-fail"
            old.mkdir(parents=True)
            payload = {
                "episodeId": "ep-fail",
                "projectId": "proj-default",
                "episodeTitle": "x",
                "episodeNumber": 1,
                "pulledAt": "z",
                "scenes": [],
                "assets": [],
            }
            (old / "episode.json").write_text(
                json.dumps(payload, ensure_ascii=False),
                encoding="utf-8",
            )

            client = MagicMock()
            client.get_scenes.side_effect = RuntimeError("simulated network error")

            with self.assertRaises(RuntimeError):
                pull_episode("ep-fail", root, project_id="proj-real", client=client)

            self.assertTrue(
                (old / "episode.json").is_file(),
                "平台失败时不应已执行归一化并删除旧副本",
            )
        finally:
            shutil.rmtree(root, ignore_errors=True)


class TestDuplicatePickBest(unittest.TestCase):
    """历史双副本：择优与纯路径字典序无关。"""

    def test_pick_prefers_more_visual_descriptions(self) -> None:
        import sys

        # 与 uvicorn 启动一致：仓库根在 path 上，才能 import web.server.services
        _repo = Path(__file__).resolve().parent.parent
        if str(_repo / "web" / "server") not in sys.path:
            sys.path.insert(0, str(_repo / "web" / "server"))
        from services import data_service as ds  # noqa: PLC0415

        root = Path(tempfile.mkdtemp())
        try:
            a = root / "proj-default" / "ep-dup"
            b = root / "zzz-real-project" / "ep-dup"
            a.mkdir(parents=True)
            b.mkdir(parents=True)
            # a: 无画面描述；b: 有一条
            (a / "episode.json").write_text(
                json.dumps(
                    {
                        "episodeId": "ep-dup",
                        "projectId": "proj-default",
                        "episodeTitle": "",
                        "episodeNumber": 1,
                        "pulledAt": "",
                        "scenes": [
                            {
                                "sceneId": "s1",
                                "sceneNumber": 1,
                                "title": "",
                                "shots": [{"visualDescription": ""}],
                            }
                        ],
                        "assets": [],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (b / "episode.json").write_text(
                json.dumps(
                    {
                        "episodeId": "ep-dup",
                        "projectId": "zzz-real-project",
                        "episodeTitle": "",
                        "episodeNumber": 1,
                        "pulledAt": "",
                        "scenes": [
                            {
                                "sceneId": "s1",
                                "sceneNumber": 1,
                                "title": "",
                                "shots": [{"visualDescription": "hello"}],
                            }
                        ],
                        "assets": [],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            # 字典序 a 在 b 前；择优应选 b
            best = ds._pick_best_episode_dir(sorted([a, b], key=str))
            self.assertEqual(best.resolve(), b.resolve())
        finally:
            shutil.rmtree(root, ignore_errors=True)


class TestEpisodeFsLock(unittest.TestCase):
    """归一化与后台任务并发：同 episodeId 互斥。"""

    def test_same_episode_serializes(self) -> None:
        from src.feeling.episode_fs_lock import episode_fs_lock  # noqa: PLC0415

        order: list[str] = []
        first_holding = threading.Event()

        def first() -> None:
            with episode_fs_lock("ep-lock"):
                order.append("enter1")
                first_holding.set()
                time.sleep(0.15)
                order.append("leave1")

        def second() -> None:
            assert first_holding.wait(timeout=2)
            with episode_fs_lock("ep-lock"):
                order.append("enter2")
                order.append("leave2")

        t1 = threading.Thread(target=first)
        t2 = threading.Thread(target=second)
        t1.start()
        t2.start()
        t1.join(timeout=5)
        t2.join(timeout=5)

        self.assertEqual(order, ["enter1", "leave1", "enter2", "leave2"])


class TestEndframeUsesFsLock(unittest.TestCase):
    """
    generate._run_tail_frame 写 endframes / 更新 episode 须经过 episode_fs_lock。

    不 import generate 模块（避免 CI 未装 FastAPI 时失败），改为对源码结构做断言。
    """

    def test_tail_frame_write_block_uses_lock_after_yunwu(self) -> None:
        repo = Path(__file__).resolve().parent.parent
        path = repo / "web" / "server" / "routes" / "generate.py"
        text = path.read_text(encoding="utf-8")
        start = text.index("def _run_tail_frame")
        end = text.index("@router.post(\"/generate/endframe\"", start)
        body = text[start:end]
        self.assertIn("with episode_fs_lock(episode_id, data_namespace=fs_tag):", body)
        self.assertIn("ep_dir_write = data_service.get_episode_dir", body)
        img_pos = body.find("img_data = generate_tail_frame")
        lock_pat = "with episode_fs_lock(episode_id, data_namespace=fs_tag):"
        lock_pos = body.find(lock_pat)
        self.assertGreaterEqual(img_pos, 0, "应有 Yunwu generate_tail_frame 调用")
        self.assertGreater(lock_pos, img_pos, "应先 Yunwu 再持锁写盘，避免长时间阻塞 repull")
        self.assertGreaterEqual(
            body.count(lock_pat),
            2,
            "成功写盘与异常时 update_shot_status 均应持锁",
        )


class TestEpDirWritePathsUseFsLock(unittest.TestCase):
    """其它在 ep_dir 下写文件的入口须持 episode_fs_lock（源码断言，免 FastAPI）。"""

    def test_regen_frame_lock_after_yunwu(self) -> None:
        repo = Path(__file__).resolve().parent.parent
        path = repo / "web" / "server" / "routes" / "generate.py"
        text = path.read_text(encoding="utf-8")
        start = text.index("def _run_regen_frame")
        end = text.index("@router.post(\"/generate/regen-frame\"", start)
        body = text[start:end]
        y = body.find("img_data = regenerate_first_frame")
        lock_pos = body.find("with episode_fs_lock(episode_id, **lock_kw):")
        self.assertGreaterEqual(y, 0)
        self.assertGreater(lock_pos, y, "应先 Yunwu 再持锁写首帧")
        self.assertIn("ep_dir_write = data_service.get_episode_dir", body)

    def test_regen_batch_wan27_lock_after_dashscope(self) -> None:
        """万相组图：模型调用在锁外，落盘与 update_shot 在 episode_fs_lock 内。"""
        repo = Path(__file__).resolve().parent.parent
        path = repo / "web" / "server" / "routes" / "generate.py"
        text = path.read_text(encoding="utf-8")
        start = text.index("def _run_regen_batch_wan27")
        end = text.index("@router.post(\"/generate/regen-frame\"", start)
        body = text[start:end]
        api = body.find("run_wan27_sequential_for_shots(")
        lock_pos = body.find("with episode_fs_lock(episode_id, **lock_kw):")
        self.assertGreaterEqual(api, 0)
        self.assertGreater(lock_pos, api, "应先 DashScope 再持锁写首帧")

    def test_export_rough_cut_wrapped_in_lock(self) -> None:
        repo = Path(__file__).resolve().parent.parent
        path = repo / "web" / "server" / "routes" / "export_route.py"
        text = path.read_text(encoding="utf-8")
        start = text.index("def export_rough_cut")
        end = text.index("@router.post(\"/export/jianying-draft\"", start)
        body = text[start:end]
        self.assertIn("with episode_fs_lock(req.episodeId, data_namespace=tag):", body)
        self.assertIn("concat_videos(", body)
        c = body.find("concat_videos(")
        lock_line = body.find("with episode_fs_lock(req.episodeId, data_namespace=tag):")
        self.assertLess(lock_line, c, "粗剪应在持锁区间内调用 ffmpeg 拼接")

    def test_jianying_export_wrapped_in_lock(self) -> None:
        repo = Path(__file__).resolve().parent.parent
        path = repo / "web" / "server" / "services" / "jianying_service.py"
        text = path.read_text(encoding="utf-8")
        start = text.index("def export_jianying_draft")
        # 到下一个顶层 def
        next_def = text.index("\ndef guess_jianying_draft_root_candidates", start)
        body = text[start:next_def]
        self.assertIn("with episode_fs_lock(episode_id, data_namespace=lock_tag):", body)
        self.assertIn("persist_episode(ep, namespace_root)", body)
        p = body.find("persist_episode(ep, namespace_root)")
        lock_pos = body.find("with episode_fs_lock(episode_id, data_namespace=lock_tag):")
        self.assertLess(lock_pos, p, "persist_episode 须在锁内")


if __name__ == "__main__":
    unittest.main()
