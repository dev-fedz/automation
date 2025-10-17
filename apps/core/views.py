"""API and page views for the automation testing module."""

from __future__ import annotations

from typing import Any

import base64
import binascii
import io
import json
import logging
import time

import requests

from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.db.models import Q
from django.http import Http404
from django.shortcuts import render
from django.urls import reverse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import models, selectors, serializers, services


logger = logging.getLogger(__name__)


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

    @action(detail=False, methods=["post"], url_path="import-postman")
    def import_postman(self, request):
        file_obj = request.FILES.get("file")
        raw_payload: Any = None

        if file_obj is not None:
            try:
                raw_text = file_obj.read().decode("utf-8")
            except UnicodeDecodeError as exc:
                raise ValidationError({"file": "File must be UTF-8 encoded JSON."}) from exc
            try:
                raw_payload = json.loads(raw_text)
            except json.JSONDecodeError as exc:
                raise ValidationError({"file": "Invalid JSON file."}) from exc
        else:
            payload = request.data.get("collection")
            if isinstance(payload, (dict, list)):
                raw_payload = payload
            elif isinstance(payload, str) and payload.strip():
                try:
                    raw_payload = json.loads(payload)
                except json.JSONDecodeError as exc:
                    raise ValidationError({"collection": "Invalid JSON payload."}) from exc

        if raw_payload is None:
            raise ValidationError({"collection": "Postman collection JSON is required."})
        if not isinstance(raw_payload, dict):
            raise ValidationError({"collection": "Collection must be a JSON object."})

        try:
            collection = services.import_postman_collection(raw_payload)
        except ValueError as exc:
            raise ValidationError({"collection": str(exc)}) from exc

        serializer = self.get_serializer(collection)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ApiRequestViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.ApiRequestSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = models.ApiRequest.objects.select_related("collection").prefetch_related("assertions").order_by("order", "id")
        collection_id = self.request.query_params.get("collection")
        if collection_id:
            queryset = queryset.filter(collection_id=collection_id)
        return queryset

    @action(detail=True, methods=["get"], url_path="last-run")
    def last_run(self, request, pk=None):
        api_request = self.get_object()
        result = (
            models.ApiRunResult.objects.filter(request=api_request)
            .select_related("run__environment", "request")
            .order_by("-created_at")
            .first()
        )
        if result is None:
            return Response(None, status=status.HTTP_200_OK)
        serializer = serializers.ApiRunResultSerializer(result, context=self.get_serializer_context())
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"], url_path="reorder")
    def reorder(self, request):
        collection_id = request.data.get("collection")
        if collection_id in (None, ""):
            raise ValidationError({"collection": "Collection is required."})
        try:
            collection_id = int(collection_id)
        except (TypeError, ValueError) as exc:
            raise ValidationError({"collection": "Collection must be a valid integer."}) from exc

        directory_id = request.data.get("directory")
        if directory_id in (None, ""):
            directory_id = None
        else:
            try:
                directory_id = int(directory_id)
            except (TypeError, ValueError) as exc:
                raise ValidationError({"directory": "Directory must be a valid integer or null."}) from exc

        ordered_ids = request.data.get("ordered_ids") or []
        if not isinstance(ordered_ids, list):
            raise ValidationError({"ordered_ids": "ordered_ids must be a list."})
        try:
            ordered_ids = [int(item) for item in ordered_ids]
        except (TypeError, ValueError) as exc:
            raise ValidationError({"ordered_ids": "ordered_ids must contain only integers."}) from exc

        queryset = models.ApiRequest.objects.filter(collection_id=collection_id)
        if directory_id is None:
            queryset = queryset.filter(directory__isnull=True)
        else:
            queryset = queryset.filter(directory_id=directory_id)

        existing_ids = list(queryset.values_list("id", flat=True))
        if len(existing_ids) != len(ordered_ids) or set(existing_ids) != set(ordered_ids):
            raise ValidationError({"ordered_ids": "ordered_ids must match the existing request ids."})

        with transaction.atomic():
            for index, request_id in enumerate(ordered_ids):
                models.ApiRequest.objects.filter(pk=request_id).update(order=index)

        return Response({"status": "ok"}, status=status.HTTP_200_OK)


class ApiCollectionDirectoryViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.ApiCollectionDirectorySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = models.ApiCollectionDirectory.objects.select_related("collection", "parent").prefetch_related("requests").order_by("parent_id", "order", "id")
        collection_id = self.request.query_params.get("collection")
        if collection_id:
            queryset = queryset.filter(collection_id=collection_id)
        parent_id = self.request.query_params.get("parent")
        if parent_id:
            queryset = queryset.filter(parent_id=parent_id)
        return queryset

    def perform_create(self, serializer):
        collection = serializer.validated_data["collection"]
        parent = serializer.validated_data.get("parent")
        if "order" not in serializer.validated_data:
            sibling_count = models.ApiCollectionDirectory.objects.filter(collection=collection, parent=parent).count()
            serializer.save(order=sibling_count)
            return
        serializer.save()

    @action(detail=False, methods=["post"], url_path="reorder")
    def reorder(self, request):
        collection_id = request.data.get("collection")
        if collection_id in (None, ""):
            raise ValidationError({"collection": "Collection is required."})
        try:
            collection_id = int(collection_id)
        except (TypeError, ValueError) as exc:
            raise ValidationError({"collection": "Collection must be a valid integer."}) from exc

        parent_id = request.data.get("parent")
        if parent_id in (None, ""):
            parent_id = None
        else:
            try:
                parent_id = int(parent_id)
            except (TypeError, ValueError) as exc:
                raise ValidationError({"parent": "Parent must be a valid integer or null."}) from exc

        ordered_ids = request.data.get("ordered_ids") or []
        if not isinstance(ordered_ids, list):
            raise ValidationError({"ordered_ids": "ordered_ids must be a list."})
        try:
            ordered_ids = [int(item) for item in ordered_ids]
        except (TypeError, ValueError) as exc:
            raise ValidationError({"ordered_ids": "ordered_ids must contain only integers."}) from exc

        queryset = models.ApiCollectionDirectory.objects.filter(collection_id=collection_id)
        if parent_id is None:
            queryset = queryset.filter(parent__isnull=True)
        else:
            queryset = queryset.filter(parent_id=parent_id)

        existing_ids = list(queryset.values_list("id", flat=True))
        if len(existing_ids) != len(ordered_ids) or set(existing_ids) != set(ordered_ids):
            raise ValidationError({"ordered_ids": "ordered_ids must match the existing folder ids."})

        with transaction.atomic():
            for index, directory_id in enumerate(ordered_ids):
                models.ApiCollectionDirectory.objects.filter(pk=directory_id).update(order=index)

        return Response({"status": "ok"}, status=status.HTTP_200_OK)


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


class TestPlanViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.TestPlanSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return selectors.test_plan_list()

    def get_object(self):
        instance = selectors.test_plan_get(self.kwargs["pk"])
        if instance is None:
            raise Http404
        return instance


class TestPlanScopeViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.TestPlanScopeSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = models.TestPlanScope.objects.select_related("plan").order_by("plan", "category", "order", "id")
        plan_id = self.request.query_params.get("plan")
        if plan_id:
            try:
                queryset = queryset.filter(plan_id=int(plan_id))
            except (TypeError, ValueError) as exc:
                raise ValidationError({"plan": "Plan must be an integer."}) from exc
        category = self.request.query_params.get("category")
        if category:
            queryset = queryset.filter(category=category)
        return queryset


class TestPlanMaintenanceViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.TestPlanMaintenanceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = selectors.test_plan_maintenance_list()
        plan_id = self.request.query_params.get("plan")
        if plan_id:
            try:
                queryset = queryset.filter(plan_id=int(plan_id))
            except (TypeError, ValueError) as exc:
                raise ValidationError({"plan": "Plan must be an integer."}) from exc
        return queryset


class TestScenarioViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.TestScenarioSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = selectors.test_scenario_list()
        plan_id = self.request.query_params.get("plan")
        if plan_id:
            try:
                queryset = queryset.filter(plan_id=int(plan_id))
            except (TypeError, ValueError) as exc:
                raise ValidationError({"plan": "Plan must be an integer."}) from exc
        return queryset


class TestCaseViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.TestCaseSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = selectors.test_case_list()
        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(
                Q(testcase_id__icontains=search)
                | Q(description__icontains=search)
                | Q(precondition__icontains=search)
                | Q(requirements__icontains=search)
            )
        scenario_id = self.request.query_params.get("scenario")
        if scenario_id:
            try:
                queryset = queryset.filter(scenario_id=int(scenario_id))
            except (TypeError, ValueError) as exc:
                raise ValidationError({"scenario": "Scenario must be an integer."}) from exc
        plan_id = self.request.query_params.get("plan")
        if plan_id:
            try:
                queryset = queryset.filter(scenario__plan_id=int(plan_id))
            except (TypeError, ValueError) as exc:
                raise ValidationError({"plan": "Plan must be an integer."}) from exc
        return queryset


class RiskViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.RiskSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = selectors.risk_list()
        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(Q(title__icontains=search) | Q(description__icontains=search))
        return queryset


class MitigationPlanViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.MitigationPlanSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = selectors.mitigation_plan_list()
        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(Q(title__icontains=search) | Q(description__icontains=search))
        return queryset


class RiskAndMitigationPlanViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.RiskAndMitigationPlanSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = selectors.risk_and_mitigation_list()
        risk_id = self.request.query_params.get("risk")
        if risk_id not in (None, ""):
            try:
                queryset = queryset.filter(risk_id=int(risk_id))
            except (TypeError, ValueError) as exc:
                raise ValidationError({"risk": "Risk must be an integer."}) from exc
        mitigation_plan_id = self.request.query_params.get("mitigation_plan")
        if mitigation_plan_id not in (None, ""):
            try:
                queryset = queryset.filter(mitigation_plan_id=int(mitigation_plan_id))
            except (TypeError, ValueError) as exc:
                raise ValidationError({"mitigation_plan": "Mitigation plan must be an integer."}) from exc
        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(
                Q(risk__title__icontains=search)
                | Q(risk__description__icontains=search)
                | Q(mitigation_plan__title__icontains=search)
                | Q(mitigation_plan__description__icontains=search)
                | Q(impact__icontains=search)
            )
        return queryset


def _prepare_automation_data() -> dict[str, Any]:
    plans_qs = selectors.test_plan_list()
    plans_payload = serializers.TestPlanSerializer(plans_qs, many=True).data
    environments_qs = selectors.api_environment_list()
    environments_payload = serializers.ApiEnvironmentSerializer(environments_qs, many=True).data
    risks_qs = selectors.risk_list()
    risks_payload = serializers.RiskSerializer(risks_qs, many=True).data
    mitigation_plans_qs = selectors.mitigation_plan_list()
    mitigation_plans_payload = serializers.MitigationPlanSerializer(mitigation_plans_qs, many=True).data
    risk_mitigations_qs = selectors.risk_and_mitigation_list()
    risk_mitigations_payload = serializers.RiskAndMitigationPlanSerializer(risk_mitigations_qs, many=True).data

    scenario_count = sum(len(plan.get("scenarios", [])) for plan in plans_payload)
    case_count = sum(
        len(scenario.get("cases", []))
        for plan in plans_payload
        for scenario in plan.get("scenarios", [])
    )

    metrics = {
        "plans": len(plans_payload),
        "scenarios": scenario_count,
        "cases": case_count,
        "collections": models.ApiCollection.objects.count(),
        "runs": models.ApiRun.objects.count(),
        "environments": len(environments_payload),
        "risks": len(risks_payload),
        "mitigation_plans": len(mitigation_plans_payload),
        "risk_mitigations": len(risk_mitigations_payload),
    }

    recent_runs = (
        models.ApiRun.objects.select_related("collection", "environment", "triggered_by")
        .order_by("-created_at")[:5]
    )
    highlighted_collections = models.ApiCollection.objects.order_by("name")[:6]

    api_endpoints = {
        "plans": reverse("core:core-test-plans-list"),
        "maintenances": reverse("core:core-test-plan-maintenances-list"),
        "scenarios": reverse("core:core-test-scenarios-list"),
        "cases": reverse("core:core-test-cases-list"),
        "scopes": reverse("core:core-test-plan-scopes-list"),
        "collections": reverse("core:core-collections-list"),
        "environments": reverse("core:core-environments-list"),
        "runs": reverse("core:core-runs-list"),
        "risks": reverse("core:core-risks-list"),
        "mitigation_plans": reverse("core:core-mitigation-plans-list"),
        "risk_mitigations": reverse("core:core-risk-mitigation-plans-list"),
    }

    selected_plan = plans_payload[0] if plans_payload else None
    selected_scenario = None
    if selected_plan:
        scenarios = selected_plan.get("scenarios", [])
        if scenarios:
            selected_scenario = scenarios[0]

    return {
        "plans": plans_payload,
        "metrics": metrics,
        "recent_runs": recent_runs,
        "highlighted_collections": highlighted_collections,
        "api_endpoints": api_endpoints,
        "selected_plan": selected_plan,
        "selected_scenario": selected_scenario,
        "environments": environments_payload,
        "risks": risks_payload,
        "mitigation_plans": mitigation_plans_payload,
        "risk_mitigations": risk_mitigations_payload,
    }


@login_required
def automation_overview(request):
    """Render top-level Automation overview content."""

    data = _prepare_automation_data()
    context = {
        "initial_metrics": data["metrics"],
        "recent_runs": data["recent_runs"],
        "highlighted_collections": data["highlighted_collections"],
    }
    return render(request, "core/automation_overview.html", context)


@login_required
def automation_test_plans(request):
    data = _prepare_automation_data()
    context = {
        "initial_plans": data["plans"],
        "initial_metrics": data["metrics"],
        "api_endpoints": data["api_endpoints"],
        "initial_selected_plan": data["selected_plan"],
        "initial_selected_scenario": data["selected_scenario"],
        "risk_mitigations": data["risk_mitigations"],
    }
    return render(request, "core/automation_test_plans.html", context)


@login_required
def automation_test_scenarios(request):
    data = _prepare_automation_data()
    context = {
        "initial_plans": data["plans"],
        "initial_metrics": data["metrics"],
        "api_endpoints": data["api_endpoints"],
        "initial_selected_plan": data["selected_plan"],
        "initial_selected_scenario": data["selected_scenario"],
    }
    return render(request, "core/automation_test_scenarios.html", context)


@login_required
def automation_test_cases(request):
    data = _prepare_automation_data()
    context = {
        "initial_plans": data["plans"],
        "initial_metrics": data["metrics"],
        "api_endpoints": data["api_endpoints"],
        "initial_selected_plan": data["selected_plan"],
        "initial_selected_scenario": data["selected_scenario"],
    }
    return render(request, "core/automation_test_cases.html", context)


@login_required
def automation_test_plan_maintenance(request):
    data = _prepare_automation_data()
    context = {
        "initial_plans": data["plans"],
        "initial_metrics": data["metrics"],
        "api_endpoints": data["api_endpoints"],
        "initial_selected_plan": data["selected_plan"],
        "initial_selected_scenario": data["selected_scenario"],
    }
    return render(request, "core/automation_test_plan_maintenance.html", context)


@login_required
def automation_data_management(request, section: str | None = None):
    data = _prepare_automation_data()
    context = {
        "initial_metrics": data["metrics"],
        "initial_environments": data["environments"],
        "initial_risks": data["risks"],
        "initial_mitigation_plans": data["mitigation_plans"],
        "initial_risk_mitigations": data["risk_mitigations"],
        "api_endpoints": data["api_endpoints"],
        "initial_section": section or "",
    }
    return render(request, "core/automation_data_management.html", context)


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

        collection = None
        collection_id = payload.get("collection_id")
        if collection_id not in (None, ""):
            try:
                collection_id = int(collection_id)
            except (TypeError, ValueError) as exc:
                raise ValidationError({"collection": "Collection must be a valid integer."}) from exc
            try:
                collection = models.ApiCollection.objects.get(pk=collection_id)
            except models.ApiCollection.DoesNotExist as exc:
                raise ValidationError({"collection": "Collection not found."}) from exc

        api_request = None
        request_id = payload.get("request_id")
        if request_id not in (None, ""):
            try:
                request_id = int(request_id)
            except (TypeError, ValueError) as exc:
                raise ValidationError({"request": "Request must be a valid integer."}) from exc
            api_request = models.ApiRequest.objects.select_related("collection").filter(pk=request_id).first()
            if api_request:
                if collection and api_request.collection_id != collection.id:
                    api_request = None
                elif not collection:
                    collection = api_request.collection

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

        signature_value = None
        if isinstance(resolved_json, dict):
            signature_value = resolved_json.get("signature")
        elif isinstance(resolved_body, dict):
            signature_value = resolved_body.get("signature")
        elif isinstance(resolved_body, str):
            try:
                parsed_body = json.loads(resolved_body)
                if isinstance(parsed_body, dict):
                    signature_value = parsed_body.get("signature")
            except (TypeError, ValueError):
                pass

        if signature_value not in (None, ""):
            logger.info("API tester resolved signature: %s", signature_value)

        run = models.ApiRun.objects.create(
            collection=collection,
            environment=environment,
            triggered_by=request.user if request.user.is_authenticated else None,
            status=models.ApiRun.Status.RUNNING,
            started_at=timezone.now(),
        )
        run_result = models.ApiRunResult.objects.create(
            run=run,
            request=api_request,
            order=1,
            status=models.ApiRunResult.Status.ERROR,
        )

        start = time.perf_counter()
        try:
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
        except requests.RequestException as exc:  # pragma: no cover - network error path
            elapsed_ms = (time.perf_counter() - start) * 1000
            run_result.error = str(exc)
            run_result.response_time_ms = elapsed_ms
            run_result.status = models.ApiRunResult.Status.ERROR
            run_result.save(update_fields=["error", "response_time_ms", "status", "updated_at"])
            run.status = models.ApiRun.Status.FAILED
            run.summary = services._summarize_run(1, 0)  # type: ignore[attr-defined]
            run.finished_at = timezone.now()
            run.save(update_fields=["status", "summary", "finished_at", "updated_at"])
            return Response(
                {
                    "error": str(exc),
                    "resolved_url": resolved_url,
                    "request_headers": resolved_headers,
                    "run_id": run.id,
                },
                status=status.HTTP_502_BAD_GATEWAY,
            )

        elapsed_ms = (time.perf_counter() - start) * 1000

        try:
            response_json = response.json()
        except ValueError:
            response_json = None

        run_result.response_status = response.status_code
        run_result.response_headers = dict(response.headers)
        run_result.response_body = response.text[:20000]
        run_result.response_time_ms = elapsed_ms
        run_result.status = models.ApiRunResult.Status.PASSED if response.ok else models.ApiRunResult.Status.FAILED
        run_result.save(
            update_fields=[
                "response_status",
                "response_headers",
                "response_body",
                "response_time_ms",
                "status",
                "updated_at",
            ]
        )
        passed = 1 if response.ok else 0
        run.status = models.ApiRun.Status.PASSED if response.ok else models.ApiRun.Status.FAILED
        run.summary = services._summarize_run(1, passed)  # type: ignore[attr-defined]
        run.finished_at = timezone.now()
        run.save(update_fields=["status", "summary", "finished_at", "updated_at"])

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
                "run_id": run.id,
                "run_result_id": run_result.id,
            }
        )


@login_required
def api_tester_page(request):
    """Render the interactive API testing workspace."""
    return render(request, "core/api_tester.html")
