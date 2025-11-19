from django.conf import settings


def static_version(request):
    """Expose STATIC_VERSION for template cache busting."""
    return {"STATIC_VERSION": getattr(settings, "STATIC_VERSION", "")}


def breadcrumbs(request):
    """Proxy to breadcrumbs builder if available.

    We import here to avoid import-time Django setup issues.
    """
    try:
        from .breadcrumbs import build_breadcrumbs
        return build_breadcrumbs(request)
    except Exception:
        return {}
