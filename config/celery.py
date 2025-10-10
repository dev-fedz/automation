"""Celery application instance for the automation project."""

import os

from celery import Celery


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("automation")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@app.task(bind=True)
def debug_task(self):  # pragma: no cover
    """Simple task helpful for debugging Celery wiring."""
    print(f"Request: {self.request!r}")
