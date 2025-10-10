from .settings_base import *  # noqa: F401,F403

"""Settings specialization for the core (business) microservice.

Does not define AUTH_USER_MODEL (relies on external user service if needed).
"""

INSTALLED_APPS = INSTALLED_APPS_BASE + [
    'knox',
    'apps.accounts',
    'apps.core',
]

AUTH_USER_MODEL = 'accounts.User'

# Core may expose some public/anonymous endpoints; tailor permissions here.
REST_FRAMEWORK.update({
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework.authentication.SessionAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
})
