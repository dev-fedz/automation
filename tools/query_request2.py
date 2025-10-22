#!/usr/bin/env python3
import os
import json
import re

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django

django.setup()

from apps.core import models

def main():
    out = {}
    try:
        req = models.ApiRequest.objects.select_related('collection').get(pk=2)
    except Exception as e:
        print(json.dumps({'error': f'ApiRequest pk=2 not found: {e}'}))
        return

    out['id'] = req.id
    out['collection_id'] = req.collection_id
    out['method'] = req.method
    out['url'] = req.url
    out['headers'] = req.headers or {}
    out['auth_type'] = getattr(req, 'auth_type', None)
    out['auth_basic'] = getattr(req, 'auth_basic', None)
    out['body_type'] = req.body_type
    out['body_json'] = req.body_json
    out['body_raw'] = req.body_raw
    out['body_transforms'] = req.body_transforms

    trans_text = json.dumps(req.body_transforms or {})
    vars_found = re.findall(r"\{\{\s*([\w\.\-]+)\s*\}\}", trans_text)
    vars_found = sorted(set(vars_found))
    out['placeholders'] = vars_found

    envs_info = []
    try:
        coll = req.collection
        for e in coll.environments.all():
            envs_info.append({'id': e.id, 'name': e.name, 'variables': e.variables or {}})
    except Exception:
        envs_info = []
    out['collection_environments'] = envs_info

    placeholder_map = {}
    for v in vars_found:
        found = []
        for e in envs_info:
            if v in (e.get('variables') or {}):
                found.append({'env_id': e['id'], 'env_name': e['name'], 'value': e['variables'][v]})
        placeholder_map[v] = found
    out['placeholder_matches'] = placeholder_map

    print(json.dumps(out, indent=2, default=str))

if __name__ == '__main__':
    main()
