# -*- coding: utf-8 -*-
"""
Feeling Video 平台 API 客户端

用于从平台拉取分镜数据（shots、scenes、assets）及下载图片资源。
仅提供读操作，不做 project/episode/script 的 CRUD。
"""

from src.feeling.client import FeelingClient

__all__ = ["FeelingClient"]
