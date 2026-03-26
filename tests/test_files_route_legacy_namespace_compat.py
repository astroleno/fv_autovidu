# -*- coding: utf-8 -*-
"""
静态文件兼容回归：
当前端携带 contextId 前缀请求 /api/files/{contextId}/{projectId}/{episodeId}/... 时，
若命名空间目录下不存在该文件，仍应回退到旧版扁平 data/{projectId}/{episodeId}/...。
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SERVER_DIR = _REPO_ROOT / "web" / "server"
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from routes import files as files_route  # noqa: E402


class TestFilesRouteLegacyCompat(unittest.TestCase):
    def test_context_prefixed_path_falls_back_to_flat_legacy_file(self) -> None:
        root = Path(tempfile.mkdtemp())
        original = files_route.DATA_ROOT
        try:
            files_route.DATA_ROOT = str(root)
            legacy_file = root / "proj-legacy" / "ep-legacy" / "frames" / "S001.png"
            legacy_file.parent.mkdir(parents=True)
            legacy_file.write_bytes(b"png")

            resolved = files_route._resolve_file_under_data_root(
                "dev_default/proj-legacy/ep-legacy/frames/S001.png"
            )

            self.assertEqual(resolved.resolve(), legacy_file.resolve())
        finally:
            files_route.DATA_ROOT = original
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
