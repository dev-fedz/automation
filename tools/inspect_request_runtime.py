#!/usr/bin/env python3
"""Inspect request body transforms at runtime for ApiRequest pk=2 with Env pk=1.

Run with: docker compose run --rm automation python tools/inspect_request_runtime.py
"""
import os
import sys
import json

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django

django.setup()

from apps.core import models, services


def main(collection_id=1, request_id=2, env_id=1):
    try:
        env = models.ApiEnvironment.objects.get(pk=env_id)
    except Exception as e:
        print('env error:', e)
        env = None

    vars_map = dict(env.variables or {}) if env is not None else {}
    print('--- environment variables ---')
    print(json.dumps(vars_map, indent=2))

    try:
        req = models.ApiRequest.objects.get(pk=request_id)
    except Exception as e:
        print('request error:', e)
        return 2

    body = services._resolve_variables(req.body_json, dict(vars_map)) if req.body_json is not None else None
    print('\n--- before transforms ---')
    print(json.dumps(body, indent=2, default=str))

    transforms = None
    if isinstance(req.body_transforms, dict):
        transforms = req.body_transforms
    print('\n--- stored body_transforms ---')
    print(json.dumps(transforms or {}, indent=2, default=str))

    if isinstance(body, dict) and transforms:
        try:
            overrides = services._apply_body_transforms(body, transforms, dict(vars_map))
            print('\n--- overrides returned by _apply_body_transforms ---')
            print(json.dumps(overrides or {}, indent=2))
        except Exception as exc:
            print('\napply transforms exception:')
            import traceback
            traceback.print_exc()

    print('\n--- after transforms ---')
    print(json.dumps(body, indent=2, default=str))

    return 0


if __name__ == '__main__':
    sys.exit(main())
