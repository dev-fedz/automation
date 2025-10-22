#!/usr/bin/env python3
"""Simulate the browser 'Run' button behavior for ApiRequest pk=2.

- Loads ApiRequest pk=2 from DB
- Chooses environment id 1 if available
- Applies client-side isRandom computation (timestamp format matching JS runner)
- Removes isRandom/charLimit from transforms
- Resolves basic auth templates using environment variables
- Posts to /api/core/tester/execute/ using Django test client and prints the response JSON
"""
import base64
import json
import time
from datetime import datetime

import django

import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.test import Client
from apps.core import models


def js_style_timestamp():
    now = datetime.now()
    ms = f"{int(now.microsecond/1000):03d}"
    # emulate performance.now fraction for nanos: use lower-order digits of time_ns
    try:
        ns = time.time_ns()
        nanos = str(ns % 1000000).zfill(6)
    except Exception:
        nanos = '000000'
    ts = f"{now.year}{now.month:02d}{now.day:02d}-{now.hour:02d}{now.minute:02d}{now.second:02d}.{ms}{nanos}"
    return ts


def compute_client_override_value(base_value, char_limit=None):
    base = base_value if base_value is not None else ''
    base = str(base)
    if len(base) > 10:
        base = base[:10]
    timestamp = js_style_timestamp()
    combined = f"{base}{timestamp}"
    if char_limit is not None:
        try:
            limit = int(char_limit)
            if limit > 0 and len(combined) > limit:
                allowed_ts_len = max(0, limit - len(base))
                truncated_ts = timestamp[:allowed_ts_len] if allowed_ts_len > 0 else ''
                combined = f"{base}{truncated_ts}"
        except Exception:
            pass
    return combined


def main():
    req = models.ApiRequest.objects.get(pk=2)
    # choose explicit environment id 1 if present
    try:
        env = models.ApiEnvironment.objects.get(pk=1)
    except models.ApiEnvironment.DoesNotExist:
        env = None

    collection_id = req.collection_id

    # simulate the client-side transform cloning and isRandom computation
    trans = req.body_transforms or {}
    trans2 = json.loads(json.dumps(trans)) if isinstance(trans, dict) else trans
    if isinstance(trans2, dict) and isinstance(trans2.get('overrides'), list):
        new_overrides = []
        for ov in trans2.get('overrides') or []:
            ov_copy = dict(ov)
            try:
                if ov_copy.get('isRandom'):
                    # if client computes, it will set ov.value to computed string
                    computed = compute_client_override_value(ov_copy.get('value', ''), ov_copy.get('charLimit') or ov_copy.get('char_limit'))
                    ov_copy['value'] = computed
                    # remove helper keys
                    ov_copy.pop('isRandom', None)
                    ov_copy.pop('is_random', None)
                    ov_copy.pop('charLimit', None)
                    ov_copy.pop('char_limit', None)
            except Exception:
                pass
            new_overrides.append(ov_copy)
        trans2['overrides'] = new_overrides

    # client may also compute signatures client-side but in our runner it doesn't precompute signatures, server does

    # resolve basic auth templates using environment variables if present
    headers = dict(req.headers or {})
    if req.auth_type == 'basic' and isinstance(req.auth_basic, dict):
        username = req.auth_basic.get('username', '')
        password = req.auth_basic.get('password', '')
        # if username/password are templates like {{ key }}, try to resolve using env.variables
        if env is not None:
            vars_map = env.variables or {}
        else:
            vars_map = {}
        def resolve_template(v):
            if not isinstance(v, str):
                return v
            v = v.strip()
            if v.startswith('{{') and v.endswith('}}'):
                key = v[2:-2].strip()
                return vars_map.get(key, v)
            return v
        ru = resolve_template(username)
        rp = resolve_template(password)
        try:
            token = base64.b64encode(f"{ru}:{rp}".encode('utf-8')).decode('ascii')
            headers['Authorization'] = f"Basic {token}"
        except Exception:
            pass

    payload = {
        'method': req.method,
        'url': req.url,
        'headers': headers,
        'params': req.query_params or {},
        'json': req.body_json if req.body_type == 'json' else None,
        'collection_id': collection_id,
    }
    if env is not None:
        payload['environment'] = env.id
    if trans2:
        payload['body_transforms'] = trans2

    client = Client()
    User = __import__('django.contrib.auth').contrib.auth.get_user_model()
    user = User.objects.filter(is_active=True).first()
    client.force_login(user)

    resp = client.post('/api/core/tester/execute/', data=json.dumps(payload), content_type='application/json')
    try:
        out = resp.json()
    except Exception:
        out = {'text': resp.content.decode('utf-8', 'replace')}
    print(json.dumps({'status': resp.status_code, 'response': out}, indent=2))


if __name__ == '__main__':
    main()
