#!/usr/bin/env bash
set -e

# Allow optional service selection: accounts | core
SERVICE="${SERVICE:-accounts}"

echo "[entrypoint] Service: $SERVICE"

# Wait for Postgres if DATABASE_URL host is set
if [ -n "$DATABASE_URL" ]; then
  HOST=$(python - <<'PY'
import os, re
url=os.environ.get('DATABASE_URL','')
# crude parse
m=re.match(r'^[^:]+://[^@]+@([^:/]+)', url)
print(m.group(1) if m else '')
PY
)
  if [ -n "$HOST" ]; then
    echo "[entrypoint] Waiting for database host $HOST:5432"
    for i in {1..30}; do
      (echo > /dev/tcp/$HOST/5432) >/dev/null 2>&1 && echo "[entrypoint] DB up" && break
      sleep 1
    done
  fi
fi

# If custom command provided, run it early (e.g. makemigrations) and exit
if [ "$#" -gt 0 ]; then
  echo "[entrypoint] Running custom command: $* (migrations will NOT auto-run)"
  exec "$@"
fi

# Migrations (skip if readonly env var set)
if [ "$SKIP_MIGRATIONS" != "1" ]; then
  if [ "$SERVICE" = "accounts" ]; then
    python manage_accounts.py migrate --noinput
  elif [ "$SERVICE" = "core" ]; then
    python manage_core.py migrate --noinput
  else
    echo "Unknown SERVICE=$SERVICE" >&2; exit 1
  fi
fi

# Collect static (non-fatal if none)
python - <<'PY'
from django.conf import settings
print('[entrypoint] static root:', getattr(settings, 'STATIC_ROOT', None))
PY

# Launch default ASGI server
if [ "$SERVICE" = "accounts" ]; then
  exec daphne -b 0.0.0.0 -p 8001 config.asgi:application
else
  exec daphne -b 0.0.0.0 -p 8002 config.asgi:application
fi
