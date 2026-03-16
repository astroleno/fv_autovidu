# -*- coding: utf-8 -*-
"""
Vidu API 客户端模块

封装 Vidu 多种能力：
- 图生视频 (i2v)
- 电商一键成片 (ad-one-click)
- 视频复刻 (trending-replicate)
"""

from .client import ViduClient

__all__ = ["ViduClient"]
