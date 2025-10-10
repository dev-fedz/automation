"""Base settings shared by microservices.

Monolith still uses config.settings. Microservices:
 - config.settings_accounts
 - config.settings_core
"""
import os
from pathlib import Path
import environ

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret')
DEBUG = os.environ.get('DEBUG', 'true').lower() == 'true'
ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', '*').split(',')

env = environ.Env()
environ.Env.read_env(os.path.join(BASE_DIR, '.env'))

DATABASE_URL = env('DATABASE_URL')  # must be set
import dj_database_url  # type: ignore
cfg = dj_database_url.parse(DATABASE_URL)
if cfg.get('HOST') in ('db', 'postgres'):
    cfg['HOST'] = os.environ.get('DB_HOST_OVERRIDE', cfg['HOST'])
DATABASES = {'default': cfg}

INSTALLED_APPS_BASE = [
    # Django core
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third-party generic (framework-level only; no service coupling)
    'channels',
    'rest_framework',
    'rest_framework.authtoken',
    'django_js_reverse',
    'corsheaders',
    'django_filters',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_L10N = True
USE_TZ = True

STATIC_URL = '/static/'
STATICFILES_DIRS = [BASE_DIR / 'web' / 'static']

EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = os.environ.get('EMAIL_HOST', 'smtp-relay.brevo.com')
EMAIL_PORT = int(os.environ.get('EMAIL_PORT', '587'))
EMAIL_USE_TLS = True
EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', 'dev@example.com')
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', 'password')
DEFAULT_FROM_EMAIL = EMAIL_HOST_USER

REST_FRAMEWORK = {}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 8}},
]

LOGIN_URL = '/'
LOGIN_REDIRECT_URL = '/dashboard/'

# Concrete services define AUTH_USER_MODEL

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

WEB_TEMPLATES = BASE_DIR / 'web' / 'templates'
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [WEB_TEMPLATES],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

CORS_ALLOW_ALL_ORIGINS = True

# Channels / WebSocket layer (Redis preferred, fallback to in-memory for dev)
REDIS_URL = os.environ.get('REDIS_URL') or os.environ.get('CHANNEL_REDIS_URL')
if REDIS_URL:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                'hosts': [REDIS_URL],
            },
        }
    }
else:  # In-memory (single-process only)
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer'
        }
    }
