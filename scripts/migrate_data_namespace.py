#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据目录迁移：将旧版扁平结构 data/{projectId}/{episodeId}/ 迁入命名空间 data/{envKey}/{workspaceKey}/.

用法示例：
  python scripts/migrate_data_namespace.py --dry-run
  python scripts/migrate_data_namespace.py --env prod --workspace legacy_default

识别规则：data 根下任一直接子目录若其子级中存在含 episode.json 的文件夹，则视为「旧版项目根」，
并迁移这些剧集目录（覆盖 proj-default、UUID 项目 id 等）。

若目标已存在同名路径则跳过并打印警告。
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
_DATA = _REPO_ROOT / "data"

_RESERVED_TOP_LEVEL = frozenset({"export", "tmp", "__pycache__"})


def episode_dirs_directly_under_project(project_dir: Path) -> list[Path]:
    """返回 project_dir 下一层、且含 episode.json 的子目录（视为一集数据）。"""
    out: list[Path] = []
    if not project_dir.is_dir():
        return out
    for child in project_dir.iterdir():
        if not child.is_dir():
            continue
        if (child / "episode.json").is_file():
            out.append(child)
    return sorted(out, key=lambda p: p.name.lower())


def iter_legacy_move_pairs(data_root: Path, dest_root: Path):
    """
    产出 (剧集源码目录, 目标剧集目录) 。
    跳过保留名目录；避免把迁出目录自身当作项目根。
    """
    if not data_root.is_dir():
        return
    dest_resolved = dest_root.resolve()
    for project_dir in sorted(data_root.iterdir(), key=lambda p: p.name.lower()):
        if not project_dir.is_dir():
            continue
        if project_dir.name in _RESERVED_TOP_LEVEL:
            continue
        try:
            if dest_resolved == project_dir.resolve():
                continue
        except OSError:
            pass
        for ep_dir in episode_dirs_directly_under_project(project_dir):
            dst = dest_root / project_dir.name / ep_dir.name
            yield ep_dir, dst


def collect_legacy_moves(data_root: Path, dest_root: Path) -> list[tuple[Path, Path]]:
    """仅包含「目标尚不存在」的移动对；供测试与 dry-run 清单。"""
    return [(s, d) for s, d in iter_legacy_move_pairs(data_root, dest_root) if not d.exists()]


def main() -> int:
    parser = argparse.ArgumentParser(description="迁移 data 到 env/workspace 命名空间")
    parser.add_argument("--env", default="prod", help="环境目录名（默认 prod）")
    parser.add_argument(
        "--workspace",
        default="legacy_default",
        help="工作空间目录名（默认 legacy_default）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只打印将执行的操作，不移动文件",
    )
    args = parser.parse_args()
    env_key: str = args.env.strip()
    ws_key: str = args.workspace.strip()
    if not env_key or not ws_key:
        print("env 与 workspace 不能为空", file=sys.stderr)
        return 2

    if not _DATA.is_dir():
        print(f"未找到数据目录：{_DATA}", file=sys.stderr)
        return 1

    dest_root = _DATA / env_key / ws_key
    pairs = list(iter_legacy_move_pairs(_DATA, dest_root))
    skipped_dst = [d for s, d in pairs if d.exists()]
    moves = [(s, d) for s, d in pairs if not d.exists()]

    for d in skipped_dst:
        print(f"[跳过] 目标已存在：{d.relative_to(_DATA)}")

    if not moves:
        print(
            "没有可迁移的剧集目录（未在 data/<项目id>/<剧集目录>/episode.json 发现待迁路径）。"
        )
        return 0

    print(f"目标根：{dest_root.relative_to(_REPO_ROOT)}（共 {len(moves)} 个剧集目录）")
    for src, dst in moves:
        rel_src = src.relative_to(_DATA)
        rel_dst = dst.relative_to(_DATA)
        print(f"  {rel_src} -> {rel_dst}")

    if args.dry_run:
        print("(--dry-run，未实际移动)")
        return 0

    dest_root.mkdir(parents=True, exist_ok=True)
    for src, dst in moves:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        print(f"已移动：{src} -> {dst}")

    print("完成。请在后端验证拉取/读盘；空的项目目录可手动删除。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
