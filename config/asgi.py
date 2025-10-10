"""ASGI entrypoint for Django Channels.

Relies on DJANGO_SETTINGS_MODULE being set to the desired microservice
settings module before import (e.g. config.settings_core or
config.settings_accounts).
"""
import os

from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')  # default fallback

django_app = get_asgi_application()

try:
    from . import routing  # noqa: WPS433
    websocket_router = routing.websocket_urlpatterns
except Exception:  # pragma: no cover - fallback if routing missing
    websocket_router = []

application = ProtocolTypeRouter({
    'http': django_app,
    'websocket': URLRouter(websocket_router),
})
