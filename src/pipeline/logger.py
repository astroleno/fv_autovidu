# -*- coding: utf-8 -*-
"""
流水线结构化日志

将 pull / tail / video 各阶段的关键信息写入控制台与 episode 目录下的 pipeline.log，
便于验收「失败能定位到 shot_id 与阶段」。
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

StageName = Literal["pull", "tail", "video", "summary"]


@dataclass
class PipelineLogLine:
    """单行结构化日志记录（可序列化为 JSON）。"""

    ts: str
    stage: StageName | str
    episode_id: str
    shot_id: str | None
    status: str
    message: str
    extra: dict[str, Any] = field(default_factory=dict)


class PipelineLogger:
    """
    流水线日志器：同时输出到 stderr（人类可读）与 pipeline.log（JSON Lines）。

    Attributes:
        episode_dir: 当前处理的剧集目录（含 episode.json），用于落盘 pipeline.log
    """

    def __init__(self, episode_dir: Path | None = None) -> None:
        self.episode_dir = episode_dir
        self._lines: list[PipelineLogLine] = []

    def _emit(self, line: PipelineLogLine) -> None:
        """写入内存列表、控制台与可选文件。"""
        self._lines.append(line)
        human = (
            f"[{line.ts}] [{line.stage}] episode={line.episode_id} "
            f"shot={line.shot_id or '-'} status={line.status} {line.message}"
        )
        print(human, file=sys.stderr)
        if self.episode_dir:
            log_path = self.episode_dir / "pipeline.log"
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(
                    json.dumps(
                        {
                            "ts": line.ts,
                            "stage": line.stage,
                            "episode_id": line.episode_id,
                            "shot_id": line.shot_id,
                            "status": line.status,
                            "message": line.message,
                            **line.extra,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )

    def log(
        self,
        stage: StageName | str,
        episode_id: str,
        *,
        shot_id: str | None = None,
        status: str = "info",
        message: str = "",
        **extra: Any,
    ) -> None:
        """记录一条结构化日志。"""
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        self._emit(
            PipelineLogLine(
                ts=ts,
                stage=stage,
                episode_id=episode_id,
                shot_id=shot_id,
                status=status,
                message=message,
                extra=dict(extra) if extra else {},
            )
        )

    def print_summary(
        self,
        *,
        episode_id: str,
        stage_counts: dict[str, int],
        failures: list[tuple[str, str, str]],
    ) -> None:
        """
        打印并记录最终汇总。

        Args:
            episode_id: 剧集 ID
            stage_counts: 如 {"tail_ok": 10, "tail_fail": 1}
            failures: [(shot_id, stage, error_message), ...]
        """
        self.log(
            "summary",
            episode_id,
            status="done",
            message=f"counts={stage_counts} failures={len(failures)}",
            failures=[{"shot_id": a, "stage": b, "error": c} for a, b, c in failures],
        )
        if failures:
            print("\n--- 失败汇总 ---", file=sys.stderr)
            for sid, stg, err in failures:
                print(f"  shot_id={sid} stage={stg} error={err}", file=sys.stderr)
