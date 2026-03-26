# -*- coding: utf-8 -*-
"""migrate_data_namespace：非 UUID 项目根、episode.json 检测。"""
from __future__ import annotations

import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_migrate_module():
    path = _REPO_ROOT / "scripts" / "migrate_data_namespace.py"
    spec = importlib.util.spec_from_file_location("migrate_data_namespace", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestCollectLegacyMoves(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(self.root, ignore_errors=True))

    def test_proj_default_and_uuid_projects(self) -> None:
        mod = _load_migrate_module()
        data = self.root / "data"
        dest = data / "prod" / "legacy_default"

        ep1 = data / "proj-default" / "ep11111111-1111-1111-1111-111111111111"
        ep1.mkdir(parents=True)
        (ep1 / "episode.json").write_text("{}", encoding="utf-8")

        proj = data / "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        ep2 = proj / "eeeeeeee-ffff-aaaa-bbbb-cccccccccccc"
        ep2.mkdir(parents=True)
        (ep2 / "episode.json").write_text("{}", encoding="utf-8")

        moves = mod.collect_legacy_moves(data, dest)
        dst_names = {d.relative_to(data).as_posix() for s, d in moves}
        self.assertIn(
            "prod/legacy_default/proj-default/ep11111111-1111-1111-1111-111111111111",
            dst_names,
        )
        self.assertIn(
            "prod/legacy_default/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/eeeeeeee-ffff-aaaa-bbbb-cccccccccccc",
            dst_names,
        )
        self.assertEqual(len(moves), 2)


if __name__ == "__main__":
    unittest.main()
