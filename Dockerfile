# Python slim base
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    POETRY_VIRTUALENVS_CREATE=false

WORKDIR /app

# System deps (psycopg2, pillow build libs minimal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY automation_app/requirements.txt /tmp/requirements.txt
RUN pip install --upgrade pip && pip install -r /tmp/requirements.txt

# Copy project (only automation_app context)
COPY automation_app /app
COPY automation_app/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
    && useradd -m appuser \
    && chown -R appuser /app /entrypoint.sh

USER appuser

EXPOSE 8000 8001 8002

ENV DJANGO_SETTINGS_MODULE=config.settings_accounts

ENTRYPOINT ["/entrypoint.sh"]
CMD ["daphne", "-b", "0.0.0.0", "-p", "8001", "config.asgi:application"]
