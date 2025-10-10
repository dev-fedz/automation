"""API and page views for the automation testing module."""

from __future__ import annotations

from typing import Any

import base64
import binascii
import io
import time

import requests

from django.contrib.auth.decorators import login_required
from django.http import Http404
from django.shortcuts import render
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import models, selectors, serializers, services


class ApiEnvironmentViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.ApiEnvironmentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return selectors.api_environment_list()


class ApiCollectionViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.ApiCollectionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return selectors.api_collection_list()

    def get_object(self):
        queryset = selectors.api_collection_base_queryset()
        try:
            return queryset.get(pk=self.kwargs["pk"])
        except models.ApiCollection.DoesNotExist as exc:  # pragma: no cover
            raise Http404 from exc

    @action(detail=True, methods=["post"], url_path="run")
    def run(self, request, pk=None):  # noqa: D401
        collection = self.get_object()
        environment = None
        environment_id = request.data.get("environment")
        if environment_id is not None:
            environment = models.ApiEnvironment.objects.filter(pk=environment_id).first()
            if environment is None:
                raise NotFound("Environment not found")

        overrides = request.data.get("overrides") or {}
        if not isinstance(overrides, dict):
            raise ValidationError({"overrides": "Overrides must be an object"})

        user: Any = request.user if request.user.is_authenticated else None
        run = services.run_collection(
            collection=collection,
            environment=environment,
            overrides=overrides,
            user=user,
        )
        serializer = serializers.ApiRunSerializer(run, context=self.get_serializer_context())
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ApiRunViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = serializers.ApiRunSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return selectors.api_run_list()

    def get_object(self):
        instance = selectors.api_run_get(self.kwargs["pk"])
        if not instance:
            raise Http404
        return instance


class ApiAdhocRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):  # noqa: D401
        payload = request.data or {}

        method = str(payload.get("method", "GET")).upper()
        url = payload.get("url")
        if not url:
            raise ValidationError({"url": "URL is required."})

        headers = payload.get("headers") or {}
        if not isinstance(headers, dict):
            raise ValidationError({"headers": "Headers must be an object."})

        params = payload.get("params") or {}
        if not isinstance(params, dict):
            raise ValidationError({"params": "Query params must be an object."})

        overrides = payload.get("overrides") or {}
        if not isinstance(overrides, dict):
            raise ValidationError({"overrides": "Overrides must be an object."})

        timeout = payload.get("timeout", 30)
        try:
            timeout = float(timeout)
        except (TypeError, ValueError):
            raise ValidationError({"timeout": "Timeout must be numeric."})

        environment = None
        variables: dict[str, Any] = {}
        environment_id = payload.get("environment")
        if environment_id:
            environment = models.ApiEnvironment.objects.filter(pk=environment_id).first()
            if not environment:
                raise NotFound("Environment not found.")
            variables.update(environment.variables or {})
            default_headers = environment.default_headers or {}
            headers = {**default_headers, **headers}

        variables.update(overrides)

        resolved_url = services._resolve_variables(url, variables)  # type: ignore[attr-defined]
        resolved_headers = services._resolve_variables(headers, variables)  # type: ignore[attr-defined]
        resolved_params = services._resolve_variables(params, variables)  # type: ignore[attr-defined]

        form_data_entries = payload.get("form_data") or []
        if form_data_entries and not isinstance(form_data_entries, list):
            raise ValidationError({"form_data": "form_data must be an array."})

        json_body = payload.get("json")
        body = payload.get("body")
        resolved_json = None
        resolved_body: Any = None
        files_payload: dict[str, tuple[str, io.BytesIO, str]] | None = None
        request_form_snapshot: list[dict[str, Any]] | None = None

        if form_data_entries:
            text_fields: dict[str, Any] = {}
            file_fields: dict[str, dict[str, Any]] = {}
            request_form_snapshot = []

            for entry in form_data_entries:
                if not isinstance(entry, dict):
                    continue
                key = str(entry.get("key", "")).strip()
                if not key:
                    continue
                entry_type = entry.get("type", "text")
                if entry_type == "file":
                    data_url = entry.get("data")
                    if not data_url or not isinstance(data_url, str):
                        continue
                    try:
                        header, encoded = data_url.split(",", 1)
                    except ValueError as exc:  # pragma: no cover - malformed payload
                        raise ValidationError({"form_data": f"Invalid file data for '{key}'."}) from exc
                    if ";base64" not in header:
                        raise ValidationError({"form_data": f"File data for '{key}' must be base64 encoded."})
                    try:
                        file_bytes = base64.b64decode(encoded)
                    except (binascii.Error, ValueError) as exc:  # pragma: no cover - malformed payload
                        raise ValidationError({"form_data": f"File data for '{key}' is not valid base64."}) from exc
                    filename = entry.get("filename") or "upload.bin"
                    content_type = entry.get("content_type") or "application/octet-stream"
                    file_fields[key] = {
                        "filename": filename,
                        "bytes": file_bytes,
                        "content_type": content_type,
                    }
                    request_form_snapshot.append(
                        {
                            "key": key,
                            "type": "file",
                            "filename": filename,
                            "content_type": content_type,
                            "size": len(file_bytes),
                        }
                    )
                else:
                    value = entry.get("value", "")
                    if not isinstance(value, str):
                        value = str(value)
                    text_fields[key] = value
                    request_form_snapshot.append({"key": key, "type": "text", "value": value})

            if text_fields:
                resolved_text = services._resolve_variables(text_fields, variables)  # type: ignore[attr-defined]
                if isinstance(resolved_text, dict):
                    resolved_body = resolved_text
                else:  # pragma: no cover - defensive fallback
                    resolved_body = text_fields
                for snapshot_entry in request_form_snapshot:
                    if snapshot_entry.get("type") == "text":
                        snapshot_entry["value"] = resolved_body.get(snapshot_entry["key"], snapshot_entry.get("value", ""))
            elif request_form_snapshot:  # at least one file entry
                resolved_body = None

            if file_fields:
                files_payload = {
                    key: (meta["filename"], io.BytesIO(meta["bytes"]), meta["content_type"])
                    for key, meta in file_fields.items()
                }
        elif json_body is not None:
            if not isinstance(json_body, (dict, list)):
                raise ValidationError({"json": "JSON body must be an object or array."})
            resolved_json = services._resolve_variables(json_body, variables)  # type: ignore[attr-defined]
        elif body not in (None, ""):
            if isinstance(body, (dict, list)):
                resolved_json = services._resolve_variables(body, variables)  # type: ignore[attr-defined]
            else:
                resolved_body = services._resolve_variables(str(body), variables)  # type: ignore[attr-defined]

        try:
            start = time.perf_counter()
            response = requests.request(
                method=method,
                url=resolved_url,
                headers=resolved_headers,
                params=resolved_params,
                data=None if resolved_json is not None else resolved_body,
                json=resolved_json,
                files=files_payload,
                timeout=max(1.0, float(timeout)),
            )
            elapsed_ms = (time.perf_counter() - start) * 1000
        except requests.RequestException as exc:  # pragma: no cover - network error path
            return Response(
                {
                    "error": str(exc),
                    "resolved_url": resolved_url,
                    "request_headers": resolved_headers,
                },
                status=status.HTTP_502_BAD_GATEWAY,
            )

        try:
            response_json = response.json()
        except ValueError:
            response_json = None

        return Response(
            {
                "status_code": response.status_code,
                "headers": dict(response.headers),
                "body": response.text[:20000],
                "json": response_json,
                "elapsed_ms": elapsed_ms,
                "resolved_url": resolved_url,
                "request": {
                    "method": method,
                    "headers": resolved_headers,
                    "params": resolved_params,
                    "body": resolved_body,
                    "json": resolved_json,
                    "form_data": request_form_snapshot or None,
                    "timeout": timeout,
                },
                "environment": environment.name if environment else None,
                "variables": variables,
            }
        )


@login_required
def api_tester_page(request):
    """Render the interactive API testing workspace."""
    return render(request, "core/api_tester.html")
