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
        module = self.request.query_params.get("module")
        if module:
            queryset = queryset.filter(module_id=module)
        return queryset


class TestCaseViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.TestCaseSerializer
    permission_classes = [IsAuthenticated]

    def update(self, request, *args, **kwargs):
        try:
            user = getattr(request, 'user', None)
            user_repr = getattr(user, 'email', None) or getattr(user, 'username', None) or str(user)
            ip = request.META.get('HTTP_X_FORWARDED_FOR', request.META.get('REMOTE_ADDR'))
            logger.debug('[core] TestCaseViewSet.update incoming data: user=%s ip=%s data=%s', user_repr, ip, getattr(request, 'data', None))
        except Exception:
            pass
        # Defensive: prevent clients from changing the testcase_id on update
        try:
            instance = self.get_object()
            incoming = getattr(request, 'data', {}) or {}
            if 'testcase_id' in incoming and incoming.get('testcase_id') not in (None, '', str(instance.testcase_id)):
                raise ValidationError({'testcase_id': 'testcase_id cannot be changed once created.'})
        except ValidationError:
            raise
        except Exception:
            # ignore failures to inspect instance; proceed to allow serializer to handle
            pass
        response = super().update(request, *args, **kwargs)
        # Post-update: ensure owner is set when an authenticated user made
        # the update but the instance has no owner (client may have sent
        # an empty owner value). We do this after the serializer has saved
        # to avoid interfering with normal update validation and behavior.
        try:
            inst = self.get_object()
            if (
                inst is not None
                and getattr(request, 'user', None)
                and request.user.is_authenticated
                and getattr(inst, 'owner', None) is None
            ):
                inst.owner = request.user
                inst.save(update_fields=['owner'])
        except Exception:
            # Don't let fallback failures break the response
            pass
        return response

    def partial_update(self, request, *args, **kwargs):
        try:
            user = getattr(request, 'user', None)
            user_repr = getattr(user, 'email', None) or getattr(user, 'username', None) or str(user)
            ip = request.META.get('HTTP_X_FORWARDED_FOR', request.META.get('REMOTE_ADDR'))
            logger.debug('[core] TestCaseViewSet.partial_update incoming data: user=%s ip=%s data=%s', user_repr, ip, getattr(request, 'data', None))
        except Exception:
            pass
        # Defensive: prevent clients from changing the testcase_id on partial update
        try:
            instance = self.get_object()
            incoming = getattr(request, 'data', {}) or {}
            if 'testcase_id' in incoming and incoming.get('testcase_id') not in (None, '', str(instance.testcase_id)):
                raise ValidationError({'testcase_id': 'testcase_id cannot be changed once created.'})
        except ValidationError:
            raise
        except Exception:
            pass
        response = super().partial_update(request, *args, **kwargs)
        # same post-update owner assignment for partial updates
        try:
            inst = self.get_object()
            if (
                inst is not None
                and getattr(request, 'user', None)
                and request.user.is_authenticated
                and getattr(inst, 'owner', None) is None
            ):
                inst.owner = request.user
                inst.save(update_fields=['owner'])
        except Exception:
            pass
        return response

    def get_queryset(self):
        queryset = selectors.test_case_list()
        search = self.request.query_params.get("search")
        if search:
            # allow searching by testcase_id, title, description, precondition, requirements
            q = (
                Q(testcase_id__icontains=search)
                | Q(title__icontains=search)
                | Q(description__icontains=search)
                | Q(precondition__icontains=search)
                | Q(requirements__icontains=search)
            )
            # if the search looks like an integer, allow searching by primary key too
            try:
                if str(search).isdigit():
                    q = q | Q(pk=int(search))
            except Exception:
                pass
            queryset = queryset.filter(q)
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

    def create(self, request, *args, **kwargs):
        # Defensive: some clients or parsers may omit the 'testcase_id' key
        # entirely which can cause certain validators or upstream code to
        # treat the field as required. Ensure the incoming data contains the
        # key set to None so the serializer can accept it and the model's
        # save() will auto-generate the id when appropriate.
        try:
            logger.debug('[core] TestCaseViewSet.create incoming data: %s', getattr(request, 'data', None))
        except Exception:
            pass
        data = request.data.copy() if hasattr(request.data, 'copy') else dict(request.data)
        if 'testcase_id' not in data or data.get('testcase_id') in (None, ''):
            data['testcase_id'] = None
        # If owner not provided, set to the authenticated user
        try:
            if not data.get('owner') and getattr(request, 'user', None) and request.user.is_authenticated:
                data['owner'] = request.user.id
        except Exception:
            pass
        serializer = self.get_serializer(data=data)
        try:
            serializer.is_valid(raise_exception=True)
        except ValidationError as exc:
            # Defensive: if the only error is that testcase_id is required,
            # inject a None value and retry so the model can auto-generate it.
            errors = getattr(exc, 'detail', {}) or {}
            if 'testcase_id' in errors and errors.get('testcase_id') in (["This field is required."],) or (
                isinstance(errors.get('testcase_id'), list) and any(str(e).lower().startswith('this field is required') for e in errors.get('testcase_id'))
            ):
                data['testcase_id'] = None
                serializer = self.get_serializer(data=data)
                serializer.is_valid(raise_exception=True)
            else:
                raise
        

        # Save using perform_create but ensure owner is set to authenticated user
        try:
            if getattr(request, 'user', None) and request.user.is_authenticated:
                serializer.save(owner=request.user)
            else:
                self.perform_create(serializer)
        except TypeError:
            # Fallback if serializer.save doesn't accept owner (older behavior)
            self.perform_create(serializer)
        # Ensure owner is set on the saved instance when the client did not
        # provide an owner id (or provided an empty value). Some clients may
        # send an empty string for 'owner' which should be treated as absent.
        try:
            inst = getattr(serializer, 'instance', None)
            if (
                inst is not None
                and getattr(request, 'user', None)
                and request.user.is_authenticated
                and getattr(inst, 'owner', None) is None
            ):
                inst.owner = request.user
                # save only owner field to avoid touching other fields
                inst.save(update_fields=['owner'])
        except Exception:
            # don't let a logging/save failure break the response
            pass
        # Defensive: ensure related_api_request from the incoming payload is
        # persisted on the instance. Some clients or serializer behaviors may
        # omit saving this FK during the initial create step; explicitly set
        # it here if provided in the request data.
        try:
            inst = getattr(serializer, 'instance', None)
            if inst is not None:
                # Prefer the local `data` dict (copied/normalized above) but
                # fall back to request.data if needed.
                incoming_related = None
                try:
                    incoming_related = data.get('related_api_request') if isinstance(data, dict) else None
                except Exception:
                    incoming_related = None
                if incoming_related is None and hasattr(request, 'data'):
                    incoming_related = getattr(request.data, 'get', lambda k, d=None: d)('related_api_request', None)
                # Normalize to integer id or None
                try:
                    if incoming_related in ('', None):
                        rid = None
                    else:
                        rid = int(incoming_related)
                except Exception:
                    rid = None
                if rid and getattr(inst, 'related_api_request_id', None) != rid:
                    try:
                        inst.related_api_request_id = rid
                        inst.save(update_fields=['related_api_request'])
                    except Exception:
                        # ignore failures here to avoid breaking the response
                        pass
                elif rid is None and getattr(inst, 'related_api_request_id', None) is not None:
                    try:
                        inst.related_api_request = None
                        inst.save(update_fields=['related_api_request'])
                    except Exception:
                        pass
        except Exception:
            # never fail the request response because of this best-effort step
            pass
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)


class RiskViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.RiskSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = selectors.risk_list()
        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(Q(title__icontains=search) | Q(description__icontains=search))
        return queryset


class TestToolsViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.TestToolsSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return models.TestTools.objects.order_by("title", "id")


class TestModulesViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.TestModulesSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = models.TestModules.objects.order_by("title", "id")
        plan_id = self.request.query_params.get("plan")
        if plan_id not in (None, ""):
            try:
                queryset = queryset.filter(plan_id=int(plan_id))
            except (TypeError, ValueError) as exc:
                raise ValidationError({"plan": "Plan must be an integer."}) from exc
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
        plan_param = self.request.query_params.get("plan")
        try:
            # Log incoming plan param and authentication status for debugging
            logger.debug('[core] RiskAndMitigationPlanViewSet.get_queryset called', extra={
                'plan_param': plan_param,
                'user_authenticated': getattr(self.request.user, 'is_authenticated', False),
                'user': getattr(self.request.user, 'email', getattr(self.request.user, 'username', None)),
            })
        except Exception:
            # protect logging from raising
            logger.debug('[core] RiskAndMitigationPlanViewSet.get_queryset called (logging failed)')
        queryset = selectors.risk_and_mitigation_list(plan_param if plan_param not in (None, "") else None)
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
        "test_tools": reverse("core:core-test-tools-list"),
        "test_modules": reverse("core:core-test-modules-list"),
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
        "test_tools": serializers.TestToolsSerializer(models.TestTools.objects.order_by("title", "id"), many=True).data,
        "test_modules": serializers.TestModulesSerializer(models.TestModules.objects.order_by("title", "id"), many=True).data,
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
        "initial_risk_mitigations": data["risk_mitigations"],
        # Build a small map of plan_id -> mappings to allow client to
        # access per-plan mapping payload without filtering large arrays.
        "initial_risk_mitigations_by_plan": {
            str(plan.get("id")): [m for m in data["risk_mitigations"] if str(m.get("plan")) == str(plan.get("id"))]
            for plan in data["plans"]
        },
        "initial_risk_mitigations_for_selected": [
            m for m in data["risk_mitigations"]
            if data.get("selected_plan") and str(m.get("plan")) == str(data["selected_plan"].get("id"))
        ],
    }
    # Determine a simple list to render server-side in the template. Prefer
    # the per-selected list; otherwise fall back to the by-plan map for the
    # selected plan id. This avoids putting complex lookup logic into the
    # template and ensures a stable server-side fallback for unauthenticated
    # browsers.
    selected = context.get("initial_selected_plan")
    by_map = context.get("initial_risk_mitigations_by_plan") or {}
    render_list = context.get("initial_risk_mitigations_for_selected") or []
    if not render_list and selected:
        key = str(selected.get("id"))
        render_list = by_map.get(key, []) if isinstance(by_map, dict) else []
    context["initial_risk_mitigations_for_render"] = render_list
    return render(request, "core/automation_test_plans.html", context)


@login_required
def automation_test_scenarios(request):
    data = _prepare_automation_data()
    # include initial modules so the scenarios page can show module filters/selects
    context = {
        "initial_plans": data["plans"],
        "initial_metrics": data["metrics"],
        "api_endpoints": data["api_endpoints"],
        "initial_selected_plan": data["selected_plan"],
        "initial_selected_scenario": data["selected_scenario"],
    }
    try:
        context["initial_modules"] = serializers.TestModulesSerializer(
            models.TestModules.objects.all(), many=True
        ).data
    except Exception:
        context["initial_modules"] = []
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


@login_required
def automation_data_management_api_environment(request, section: str | None = None):
    """Render API Environments focused data management page."""
    data = _prepare_automation_data()
    context = {
        "initial_metrics": data["metrics"],
        "initial_environments": data["environments"],
        "initial_risks": data["risks"],
        "initial_mitigation_plans": data["mitigation_plans"],
        "initial_risk_mitigations": data["risk_mitigations"],
        "api_endpoints": data["api_endpoints"],
        "initial_section": section or "environments",
    }
    return render(request, "core/automation_data_management_api_environment.html", context)


@login_required
def automation_data_management_mitigation_plan(request, section: str | None = None):
    """Render mitigation plan focused data management page."""
    data = _prepare_automation_data()
    context = {
        "initial_metrics": data["metrics"],
        "initial_environments": data["environments"],
        "initial_risks": data["risks"],
        "initial_mitigation_plans": data["mitigation_plans"],
        "initial_risk_mitigations": data["risk_mitigations"],
        "api_endpoints": data["api_endpoints"],
        "initial_section": section or "mitigation",
    }
    return render(request, "core/automation_data_management_mitigation_plan.html", context)


@login_required
def automation_data_management_risk_registry(request, section: str | None = None):
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
    return render(request, "core/automation_data_management_risk_registry.html", context)


@login_required
def automation_data_management_test_tools(request, section: str | None = None):
    """Render Test Tools focused data management page."""
    data = _prepare_automation_data()
    context = {
        "initial_metrics": data["metrics"],
        "initial_environments": data["environments"],
        "initial_risks": data["risks"],
        "initial_mitigation_plans": data["mitigation_plans"],
        "initial_risk_mitigations": data["risk_mitigations"],
        "api_endpoints": data["api_endpoints"],
        "initial_section": section or "test-tools",
    }
    return render(request, "core/automation_data_management_test_tools.html", context)


@login_required
def automation_data_management_test_modules(request, section: str | None = None):
    """Render Test Modules focused data management page."""
    data = _prepare_automation_data()
    context = {
        "initial_metrics": data["metrics"],
        "initial_environments": data["environments"],
        "initial_risks": data["risks"],
        "initial_mitigation_plans": data["mitigation_plans"],
        "initial_risk_mitigations": data["risk_mitigations"],
        "initial_plans": data.get("plans", []),
        "api_endpoints": data["api_endpoints"],
        "initial_section": section or "test-modules",
    }
    return render(request, "core/automation_data_management_test_modules.html", context)



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
