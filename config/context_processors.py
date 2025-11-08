from django.conf import settings


def static_version(request):
    """Expose STATIC_VERSION for template cache busting."""
    return {"STATIC_VERSION": getattr(settings, "STATIC_VERSION", "")}
