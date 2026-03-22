# -*- coding: utf-8 -*-
"""
流水线子包：CLI 端到端编排用的结构化日志与类型导出。

- `logger.PipelineLogger`：阶段 / shot 级别日志与汇总
"""

from .logger import PipelineLogger

__all__ = ["PipelineLogger"]
