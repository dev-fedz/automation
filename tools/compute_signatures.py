#!/usr/bin/env python3
"""Compute and print signature concatenation and sha512 digests for a stored ApiRequest.

Usage: run inside project root with Django settings available, for example:
  docker compose run --rm automation python tools/compute_signatures.py
"""
import json
import hashlib
import sys
import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django

django.setup()

from apps.core import models, services
from apps.core.services import _parse_signature_components, _compute_hash_hex, _resolve_variables, _get_nested_value


def sha512_hex(s: str) -> str:
    return hashlib.sha512(s.encode("utf-8")).hexdigest()


def main(collection_id: int = 1, request_id: int = 2) -> int:
    try:
        coll = models.ApiCollection.objects.prefetch_related("environments").get(pk=collection_id)
    except Exception as exc:
        print("collection error:", exc)
        coll = None

    env = None
    env_vars = {}
    if coll is not None:
        env = coll.environments.first()
        if env is not None:
            env_vars = env.variables or {}

    print("\n=== merged environment variables ===")
    print(json.dumps(env_vars, indent=2))

    try:
        req = models.ApiRequest.objects.get(pk=request_id)
    except Exception as exc:
        print("request error:", exc)
        return 1

    body = services._resolve_variables(req.body_json, dict(env_vars)) if req.body_json is not None else None
    print("\noriginal request.body_json (after resolving env vars):")
    print(json.dumps(body, indent=2, default=str))

    transforms = req.body_transforms or {}
    print("\nstored body_transforms:")
    print(json.dumps(transforms, indent=2, default=str))

    if isinstance(body, dict) and transforms:
        try:
            overrides_map = services._apply_body_transforms(body, transforms, dict(env_vars))
            if overrides_map:
                print("\noverrides produced by signatures:")
                print(json.dumps(overrides_map, indent=2))
        except Exception as exc:  # pragma: no cover - runtime check
            print("error applying transforms:", exc)

    resolved_req_id = _get_nested_value(body, "transaction.request_id") if isinstance(body, dict) else None
    print("\nresolved transaction.request_id:")
    print(resolved_req_id)

    sigs = transforms.get("signatures") or []
    for i, s in enumerate(sigs, start=1):
        comps = _parse_signature_components(str(s.get("components") or ""))
        parts = []
        for comp in comps:
            if comp.get("type") == "literal":
                parts.append(_resolve_variables(comp.get("value", ""), dict(env_vars)))
            else:
                val = _get_nested_value(body, comp.get("value", ""))
                parts.append("" if val is None else str(val))
        concat = "".join(parts)
        digest = _compute_hash_hex(str(s.get("algorithm") or "sha512"), concat)
        print(f"\nsignature #{i} target={s.get('target_path') or s.get('target') or s.get('targetPath')}:\nconcat=\n{concat}\n{str(s.get('algorithm') or 'sha512')} digest=\n{digest}\n")

    return 0


if __name__ == "__main__":
    coll_id = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    req_id = int(sys.argv[2]) if len(sys.argv) > 2 else 2
    raise SystemExit(main(coll_id, req_id))
