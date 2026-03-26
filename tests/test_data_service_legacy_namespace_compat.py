# -*- coding: utf-8 -*-
"""
多上下文切换后的兼容回归：
带 namespace_root 的列表接口仍应合并旧版扁平 data/{projectId}/{episodeId} 数据，
否则历史已拉取剧集会在项目列表/详情页中显示为“未拉取”。
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SERVER_DIR = _REPO_ROOT / "web" / "server"
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from services import data_service as ds  # noqa: E402


class TestListEpisodesLegacyCompat(unittest.TestCase):
    def test_namespace_listing_still_includes_legacy_flat_episodes(self) -> None:
        root = Path(tempfile.mkdtemp())
        original = ds._CONFIG_DATA_ROOT
        try:
            ds._CONFIG_DATA_ROOT = str(root)

            legacy_ep_dir = root / "proj-legacy" / "ep-legacy"
            legacy_ep_dir.mkdir(parents=True)
            (legacy_ep_dir / "episode.json").write_text(
                json.dumps(
                    {
                        "projectId": "proj-legacy",
                        "episodeId": "ep-legacy",
                        "episodeTitle": "旧版已拉取剧集",
                        "episodeNumber": 1,
                        "pulledAt": "2026-03-25T04:00:02.383670Z",
                        "scenes": [],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            namespace_root = root / "dev" / "dev_default"
            namespace_root.mkdir(parents=True)

            episodes = ds.list_episodes(namespace_root)

            self.assertEqual(len(episodes), 1)
            self.assertEqual(episodes[0]["episodeId"], "ep-legacy")
            self.assertEqual(episodes[0]["projectId"], "proj-legacy")
        finally:
            ds._CONFIG_DATA_ROOT = original
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
