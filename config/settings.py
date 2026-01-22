"""Django settings for the automation project."""

from datetime import datetime, timedelta
from pathlib import Path

import environ  # type: ignore


BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    SECRET_KEY=(str, "dev-secret"),
    DEBUG=(bool, True),
    ALLOWED_HOSTS=(list, ["*"]),
    SERVICE=(str, "accounts"),
    LANGUAGE_CODE=(str, "en-us"),
    TIME_ZONE=(str, "UTC"),
    STATIC_URL=(str, "/static/"),
    STATIC_ROOT=(str, ""),
    MEDIA_URL=(str, "/media/"),
    MEDIA_ROOT=(str, ""),
    EMAIL_HOST=(str, "smtp-relay.brevo.com"),
    EMAIL_PORT=(int, 587),
    EMAIL_HOST_USER=(str, "dev@example.com"),
    EMAIL_HOST_PASSWORD=(str, "password"),
    EMAIL_USE_TLS=(bool, True),
    EMAIL_USE_SSL=(bool, False),
    DEFAULT_FROM_EMAIL=(str, "dev@example.com"),
    CORS_ALLOW_ALL_ORIGINS=(bool, True),
    DJANGO_LOG_LEVEL=(str, "INFO"),
    OPENAI_API_KEY=(str, ""),
    OPENAI_API_BASE=(str, "https://api.openai.com/v1"),
    STATIC_VERSION=(str, ""),
)

env_file = BASE_DIR / ".env"
if env_file.exists():
    env.read_env(env_file)


SECRET_KEY = env("SECRET_KEY")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env("ALLOWED_HOSTS")

SERVICE = env("SERVICE").strip().lower()
SERVICE_NAME = SERVICE or "accounts"
DJANGO_LOG_LEVEL = env("DJANGO_LOG_LEVEL").upper()
STATIC_VERSION = env("STATIC_VERSION", default="") or datetime.utcnow().strftime("%Y%m%d%H%M%S")


DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "rest_framework.authtoken",
    "knox",
    "dj_rest_auth",
    "dj_rest_auth.registration",
    "allauth",
    "allauth.account",
    "django_extensions",
    "django_js_reverse",
    "django_filters",
    "django_celery_beat",
    "django_object_actions",
    "drf_spectacular",
    "constance",
    "constance.backends.database",
    "corsheaders",
    "polymorphic",
    "storages",
    "tinymce",
]

PROJECT_APPS = [
    "apps.accounts",
    "apps.core",
]


INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + PROJECT_APPS


MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]


ROOT_URLCONF = "config.urls"


WEB_TEMPLATES = BASE_DIR / "web" / "templates"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [WEB_TEMPLATES],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                    "config.context_processors.static_version",
                    "config.context_processors.breadcrumbs",
                    "config.context_processors.enabled_modules",
            ],
        },
    },
]


WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"


DATABASES = {
    "default": env.db("DATABASE_URL", default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}"),
}


AUTH_USER_MODEL = "accounts.User"


AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 8},
    },
]


LANGUAGE_CODE = env("LANGUAGE_CODE")
TIME_ZONE = env("TIME_ZONE")
USE_I18N = True
USE_L10N = True
USE_TZ = True


STATIC_URL = env("STATIC_URL")
STATIC_ROOT = env("STATIC_ROOT") or str(BASE_DIR / "staticfiles")
STATICFILES_DIRS = [BASE_DIR / "web" / "static"]

MEDIA_URL = env("MEDIA_URL")
MEDIA_ROOT = env("MEDIA_ROOT") or str(BASE_DIR / "media")


DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


LOGIN_URL = "/"
LOGIN_REDIRECT_URL = "/dashboard/"


REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "knox.auth.TokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.FormParser",
        "rest_framework.parsers.MultiPartParser",
    ],
}


REST_AUTH = {
    "TOKEN_MODEL": "knox.models.AuthToken",
}


REST_KNOX = {
    "TOKEN_TTL": timedelta(days=env.int("AUTH_TOKEN_TTL_DAYS", default=365)),
}


CORS_ALLOW_ALL_ORIGINS = env("CORS_ALLOW_ALL_ORIGINS")


EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = env("EMAIL_HOST")
EMAIL_PORT = env("EMAIL_PORT")
EMAIL_HOST_USER = env("EMAIL_HOST_USER")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD")
EMAIL_USE_TLS = env("EMAIL_USE_TLS")
EMAIL_USE_SSL = env("EMAIL_USE_SSL")
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL")

OPENAI_API_KEY = env("OPENAI_API_KEY").strip()
OPENAI_API_BASE = env("OPENAI_API_BASE").rstrip("/") or "https://api.openai.com/v1"


CELERY_BROKER_URL = env("CELERY_BROKER_URL", default=env("REDIS_URL", default="redis://redis:6379/0"))
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", default=CELERY_BROKER_URL)


redis_url = env("REDIS_URL", default=None) or env("CHANNEL_REDIS_URL", default=None)
if redis_url:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [redis_url],
            },
        }
    }
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        }
    }


    LOGGING = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "console": {
                "format": "[%(asctime)s] %(levelname)s %(name)s: %(message)s",
            }
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "console",
            }
        },
        "loggers": {
            "apps.core": {
                "handlers": ["console"],
                "level": DJANGO_LOG_LEVEL,
                "propagate": False,
            },
            "django": {
                "handlers": ["console"],
                "level": "WARNING",
            },
        },
        "root": {
            "handlers": ["console"],
            "level": DJANGO_LOG_LEVEL,
        },
    }
