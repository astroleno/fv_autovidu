# -*- coding: utf-8 -*-
"""
剪映导出复制后路径修正：确保 copied draft 中 materials.*.path 指向最终草稿目录。
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_REPO = Path(__file__).resolve().parent.parent
_SERVER = _REPO / "web" / "server"
if str(_SERVER) not in sys.path:
    sys.path.insert(0, str(_SERVER))


class TestRewriteMaterialPathsForCopiedDraft(unittest.TestCase):
    def test_rewrites_video_and_audio_paths_to_copied_materials_dir(self) -> None:
        from services.jianying_service import _rewrite_material_paths_for_copied_draft

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            materials = root / "materials"
            materials.mkdir(parents=True)
            (materials / "001_a.mp4").write_bytes(b"")
            (materials / "001_a_dub.mp3").write_bytes(b"")

            draft_content = {
                "materials": {
                    "videos": [
                        {"path": "/tmp/original-export/materials/001_a.mp4"},
                    ],
                    "audios": [
                        {"path": "/tmp/original-export/materials/001_a_dub.mp3"},
                    ],
                },
                "tracks": [],
            }
            (root / "draft_content.json").write_text(
                json.dumps(draft_content, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            _rewrite_material_paths_for_copied_draft(root)

            got = json.loads((root / "draft_content.json").read_text(encoding="utf-8"))
            self.assertEqual(
                got["materials"]["videos"][0]["path"],
                str((materials / "001_a.mp4").resolve()),
            )
            self.assertEqual(
                got["materials"]["audios"][0]["path"],
                str((materials / "001_a_dub.mp3").resolve()),
            )

    def test_rewrites_root_and_timeline_draft_info_paths(self) -> None:
        from services.jianying_service import _rewrite_material_paths_for_copied_draft

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            materials = root / "materials"
            materials.mkdir(parents=True)
            (materials / "001_a.mp4").write_bytes(b"")

            payload = {
                "materials": {
                    "videos": [
                        {
                            "path": "/tmp/original-export/materials/001_a.mp4",
                            "remote_url": "/tmp/original-export/materials/001_a.mp4",
                        }
                    ]
                },
                "tracks": [],
            }
            for rel in [
                "draft_content.json",
                "draft_info.json",
                "Timelines/t1/draft_info.json",
            ]:
                p = root / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(
                    json.dumps(payload, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )

            _rewrite_material_paths_for_copied_draft(root)

            expected = str((materials / "001_a.mp4").resolve())
            for rel in [
                "draft_content.json",
                "draft_info.json",
                "Timelines/t1/draft_info.json",
            ]:
                got = json.loads((root / rel).read_text(encoding="utf-8"))
                self.assertEqual(got["materials"]["videos"][0]["path"], expected)
                self.assertEqual(got["materials"]["videos"][0]["remote_url"], expected)


class TestPickJianyingCopyDest(unittest.TestCase):
    def test_prefers_human_readable_name_and_appends_suffix_on_conflict(self) -> None:
        from services.jianying_service import _pick_jianying_copy_dest

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            picked = _pick_jianying_copy_dest(root, "proj_消失的邻居", "uuid-1")
            self.assertEqual(picked, root / "proj_消失的邻居")

            (root / "proj_消失的邻居").mkdir()
            picked2 = _pick_jianying_copy_dest(root, "proj_消失的邻居", "uuid-2")
            self.assertEqual(picked2, root / "proj_消失的邻居 (1)")

            (root / "proj_消失的邻居 (1)").mkdir()
            picked3 = _pick_jianying_copy_dest(root, "proj_消失的邻居", "uuid-3")
            self.assertEqual(picked3, root / "proj_消失的邻居 (2)")


class TestBuildJianyingCopyName(unittest.TestCase):
    def test_uses_project_title_plus_episode_title(self) -> None:
        from models.schemas import Episode
        from services.jianying_service import _build_jianying_copy_name

        ep = Episode(
            projectId="proj-123",
            episodeId="ep-1",
            episodeTitle="第1集",
            episodeNumber=1,
            pulledAt="",
            scenes=[],
            assets=[],
        )
        with patch(
            "services.jianying_service._resolve_project_title",
            return_value="测试项目",
        ):
            self.assertEqual(_build_jianying_copy_name(ep, "ep-1"), "测试项目-第1集")

    def test_falls_back_to_project_id_when_project_title_unavailable(self) -> None:
        from models.schemas import Episode
        from services.jianying_service import _build_jianying_copy_name

        ep = Episode(
            projectId="proj-123",
            episodeId="ep-1",
            episodeTitle="第1集",
            episodeNumber=1,
            pulledAt="",
            scenes=[],
            assets=[],
        )
        with patch(
            "services.jianying_service._resolve_project_title",
            return_value=None,
        ):
            self.assertEqual(_build_jianying_copy_name(ep, "ep-1"), "proj-123-第1集")


class TestModernShellGeneration(unittest.TestCase):
    def test_writes_reference_style_files_and_timeline_shell(self) -> None:
        from services.jianying_service import (
            _ensure_modern_jianying_shell,
            _ensure_reference_style_draft_files,
        )

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            draft_content = {
                "id": "draft-1",
                "materials": {
                    "videos": [{"id": "vid-1", "path": "/tmp/a.mp4"}],
                    "audios": [],
                    "texts": [],
                },
                "tracks": [{"type": "video", "segments": []}],
            }
            (root / "draft_content.json").write_text(
                json.dumps(draft_content, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            (root / "draft_meta_info.json").write_text("{}", encoding="utf-8")

            _ensure_reference_style_draft_files(root, "样例草稿")
            _ensure_modern_jianying_shell(root)

            self.assertTrue((root / "draft_info.json").is_file())
            self.assertTrue((root / "draft_virtual_store.json").is_file())
            self.assertTrue((root / "timeline_layout.json").is_file())
            self.assertTrue((root / "draft_agency_config.json").is_file())
            self.assertTrue((root / "attachment_editing.json").is_file())
            self.assertTrue((root / "common_attachment" / "attachment_pc_timeline.json").is_file())
            self.assertTrue((root / "Timelines" / "project.json").is_file())

            project = json.loads((root / "Timelines" / "project.json").read_text(encoding="utf-8"))
            timeline_id = project["main_timeline_id"]
            self.assertTrue((root / "Timelines" / timeline_id / "draft_info.json").is_file())
            meta = json.loads((root / "draft_meta_info.json").read_text(encoding="utf-8"))
            self.assertEqual(meta["draft_name"], "样例草稿")

    def test_reuses_existing_timeline_id_when_called_twice(self) -> None:
        from services.jianying_service import (
            _ensure_modern_jianying_shell,
            _ensure_reference_style_draft_files,
        )

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            draft_content = {
                "id": "draft-1",
                "materials": {"videos": [], "audios": [], "texts": []},
                "tracks": [],
            }
            (root / "draft_content.json").write_text(
                json.dumps(draft_content, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            (root / "draft_meta_info.json").write_text("{}", encoding="utf-8")

            _ensure_reference_style_draft_files(root, "样例草稿")
            _ensure_modern_jianying_shell(root)
            first = json.loads((root / "Timelines" / "project.json").read_text(encoding="utf-8"))
            first_id = first["main_timeline_id"]

            _ensure_modern_jianying_shell(root)
            second = json.loads((root / "Timelines" / "project.json").read_text(encoding="utf-8"))
            second_id = second["main_timeline_id"]

            self.assertEqual(first_id, second_id)
            timeline_dirs = sorted(p.name for p in (root / "Timelines").iterdir() if p.is_dir())
            self.assertEqual(timeline_dirs, [first_id])


class TestReferenceStylePayloads(unittest.TestCase):
    def test_base_draft_meta_info_matches_minimal_reference_shape(self) -> None:
        from services.jianying_service import _create_base_draft_meta_info

        got = _create_base_draft_meta_info("样例草稿")
        self.assertEqual(list(got.keys()), ["draft_materials", "draft_name"])
        self.assertEqual(got["draft_name"], "样例草稿")
        self.assertEqual([row["type"] for row in got["draft_materials"]], [0, 1, 2])

    def test_base_draft_virtual_store_omits_modern_only_extra_fields(self) -> None:
        from services.jianying_service import _create_base_draft_virtual_store

        got = _create_base_draft_virtual_store()
        row = got["draft_virtual_store"][0]["value"][0]
        self.assertNotIn("subdraft_filter_type", row)


if __name__ == "__main__":
    unittest.main()
