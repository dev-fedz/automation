"""Automation config package setup."""

from .celery import app as celery_app

__all__ = ("celery_app",)
