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


def enabled_modules(request):
    """Expose enabled module codenames for the logged-in user.

    Used to show/hide sidebar items based on RoleModule assignments.
    """
    user = getattr(request, 'user', None)
    if not user or not getattr(user, 'is_authenticated', False):
        return {'ENABLED_MODULE_CODENAMES': []}

    try:
        from django.apps import apps as django_apps
        if not django_apps.is_installed('apps.accounts'):
            print("Accounts app not installed; no enabled modules.")
            return {'ENABLED_MODULE_CODENAMES': []}

        if user.is_superuser:
            from apps.accounts.models import Module
            codes = [c for c in Module.objects.values_list('codename', flat=True) if c]
            is_superuser = sorted(set(codes))
            print(f"Superuser enabled modules: {is_superuser}")
            return {'ENABLED_MODULE_CODENAMES': sorted(set(codes))}

        # Role-based module enablement
        # Prefer the M2M accessor on Group (`modules`) which is defined via Module.roles related_name.
        codes = [
            c for c in user.groups.values_list('modules__codename', flat=True)
            if c
        ]
        not_superuser = sorted(set(codes))
        print(f"Not superuser enabled modules: {not_superuser}")
        return {'ENABLED_MODULE_CODENAMES': sorted(set(codes))}
    except Exception:
        print("Error determining enabled modules.")
        return {'ENABLED_MODULE_CODENAMES': []}
