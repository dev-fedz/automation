from .settings_base import *  # noqa: F401,F403

"""Settings specialization for the accounts microservice.

Adds authentication- and user-domain specific packages plus the accounts app.
"""

INSTALLED_APPS = INSTALLED_APPS_BASE + [
	'knox',
	'dj_rest_auth',
	'apps.accounts',
]

AUTH_USER_MODEL = 'accounts.User'

REST_FRAMEWORK.update({
	'DEFAULT_AUTHENTICATION_CLASSES': (
		'knox.auth.TokenAuthentication',
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
	'DEFAULT_PARSER_CLASSES': [
		'rest_framework.parsers.JSONParser',
		'rest_framework.parsers.FormParser',
		'rest_framework.parsers.MultiPartParser',
	],
})
