"""Serializers powering the API automation feature set."""

from __future__ import annotations

from typing import Any, Iterable

from django.db import transaction
from django.db.models import Max
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from . import models


class ApiEnvironmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.ApiEnvironment
        fields = [
            "id",
            "name",
            "description",
            "variables",
            "default_headers",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class ApiAssertionSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.ApiAssertion
        fields = [
            "id",
            "type",
            "field",
            "expected_value",
            "comparator",
            "allow_partial",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class ApiCollectionDirectorySerializer(serializers.ModelSerializer):
    collection_id = serializers.IntegerField(source="collection.id", read_only=True)
    parent_id = serializers.IntegerField(source="parent.id", read_only=True)

    class Meta:
        model = models.ApiCollectionDirectory
        fields = [
            "id",
            "collection",
            "collection_id",
            "parent",
            "parent_id",
            "name",
            "description",
            "order",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "collection_id", "parent_id", "created_at", "updated_at"]
        extra_kwargs = {
            "collection": {"write_only": True},
            "parent": {"write_only": True},
        }


class ApiRequestSerializer(serializers.ModelSerializer):
    assertions = ApiAssertionSerializer(many=True, required=False)
    collection = serializers.PrimaryKeyRelatedField(
        queryset=models.ApiCollection.objects.all(),
        write_only=True,
        required=False,
    )
    collection_id = serializers.IntegerField(source="collection.id", read_only=True)
    directory = serializers.PrimaryKeyRelatedField(
        queryset=models.ApiCollectionDirectory.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    directory_id = serializers.IntegerField(source="directory.id", read_only=True)

    class Meta:
        model = models.ApiRequest
        fields = [
            "id",
            "collection",
            "collection_id",
            "directory",
            "directory_id",
            "name",
            "method",
            "url",
            "description",
            "order",
            "timeout_ms",
            "headers",
            "query_params",
            "body_type",
            "body_json",
            "body_form",
            "body_raw",
            "body_raw_type",
            "body_transforms",
            "auth_type",
            "auth_basic",
            "auth_bearer",
            "pre_request_script",
            "tests_script",
            "assertions",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "collection_id", "directory_id", "created_at", "updated_at"]

    def create(self, validated_data: dict[str, Any]) -> models.ApiRequest:
        assertions_data = validated_data.pop("assertions", [])
        collection = validated_data.pop("collection", None)
        directory = validated_data.pop("directory", None)
        if collection is None:
            raise ValidationError({"collection": "Collection is required."})
        if directory and directory.collection_id != collection.id:
            raise ValidationError({"directory": "Directory must belong to the same collection."})
        if "order" not in validated_data:
            scope = collection.requests
            if directory:
                scope = scope.filter(directory=directory)
            next_order = scope.aggregate(Max("order"))
            validated_data["order"] = (next_order.get("order__max") or -1) + 1
        api_request = models.ApiRequest.objects.create(collection=collection, directory=directory, **validated_data)
        self._sync_assertions(api_request, assertions_data)
        return api_request

    def update(self, instance: models.ApiRequest, validated_data: dict[str, Any]) -> models.ApiRequest:
        assertions_data = validated_data.pop("assertions", None)
        validated_data.pop("collection", None)
        directory = validated_data.pop("directory", serializers.empty)
        if directory is not serializers.empty:
            if directory and directory.collection_id != instance.collection_id:
                raise ValidationError({"directory": "Directory must belong to the same collection."})
            instance.directory = directory if directory is not None else None
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if assertions_data is not None:
            self._sync_assertions(instance, assertions_data)
        return instance

    def _sync_assertions(self, api_request: models.ApiRequest, assertions_data: Iterable[dict[str, Any]]) -> None:
        keep_ids: list[int] = []
        for assertion_data in assertions_data:
            assertion_id = assertion_data.get("id")
            assertion_payload = {k: v for k, v in assertion_data.items() if k != "id"}
            if assertion_id:
                assertion = api_request.assertions.filter(id=assertion_id).first()
                if assertion:
                    for attr, value in assertion_payload.items():
                        setattr(assertion, attr, value)
                    assertion.save()
                    keep_ids.append(assertion.id)
                    continue
            assertion = models.ApiAssertion.objects.create(request=api_request, **assertion_payload)
            keep_ids.append(assertion.id)
        api_request.assertions.exclude(id__in=keep_ids).delete()


class ApiCollectionSerializer(serializers.ModelSerializer):
    requests = ApiRequestSerializer(many=True)
    environments = ApiEnvironmentSerializer(many=True, read_only=True)
    directories = ApiCollectionDirectorySerializer(many=True, read_only=True)
    environment_ids = serializers.PrimaryKeyRelatedField(
        source="environments",
        queryset=models.ApiEnvironment.objects.all(),
        many=True,
        required=False,
        write_only=True,
    )

    class Meta:
        model = models.ApiCollection
        fields = [
            "id",
            "name",
            "description",
            "slug",
            "environment_ids",
            "environments",
            "directories",
            "requests",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "slug", "created_at", "updated_at", "environments", "directories"]

    @transaction.atomic
    def create(self, validated_data: dict[str, Any]) -> models.ApiCollection:
        requests_data = validated_data.pop("requests", [])
        environments = validated_data.pop("environments", [])
        collection = models.ApiCollection.objects.create(**validated_data)
        if environments:
            collection.environments.set(environments)
        self._sync_requests(collection, requests_data)
        return collection

    @transaction.atomic
    def update(self, instance: models.ApiCollection, validated_data: dict[str, Any]) -> models.ApiCollection:
        requests_data = validated_data.pop("requests", None)
        environments = validated_data.pop("environments", None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if environments is not None:
            instance.environments.set(environments)

        if requests_data is not None:
            self._sync_requests(instance, requests_data)

        return instance

    def _sync_requests(self, collection: models.ApiCollection, requests_data: Iterable[dict[str, Any]]) -> None:
        keep_ids: list[int] = []
        for index, request_data in enumerate(requests_data):
            request_id = request_data.get("id")
            assertions_data = request_data.pop("assertions", [])
            directory = request_data.pop("directory", None)
            request_data.setdefault("order", index)

            if directory and directory.collection_id != collection.id:
                raise ValidationError({"directory": "Directory must belong to the same collection."})

            if request_id:
                api_request = collection.requests.filter(id=request_id).first()
                if api_request:
                    if directory is not None:
                        api_request.directory = directory
                    for attr, value in request_data.items():
                        setattr(api_request, attr, value)
                    api_request.save()
                    ApiRequestSerializer()._sync_assertions(api_request, assertions_data)
                    keep_ids.append(api_request.id)
                    continue

            api_request = models.ApiRequest.objects.create(
                collection=collection,
                directory=directory,
                **request_data,
            )
            ApiRequestSerializer()._sync_assertions(api_request, assertions_data)
            keep_ids.append(api_request.id)

        collection.requests.exclude(id__in=keep_ids).delete()


class ApiRunResultSerializer(serializers.ModelSerializer):
    request_name = serializers.CharField(source="request.name", read_only=True)

    class Meta:
        model = models.ApiRunResult
        fields = [
            "id",
            "order",
            "status",
            "request",
            "request_name",
            "response_status",
            "response_headers",
            "response_body",
            "response_time_ms",
            "assertions_passed",
            "assertions_failed",
            "error",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "order",
            "status",
            "request",
            "request_name",
            "response_status",
            "response_headers",
            "response_body",
            "response_time_ms",
            "assertions_passed",
            "assertions_failed",
            "error",
            "created_at",
            "updated_at",
        ]


class ApiRunSerializer(serializers.ModelSerializer):
    collection = serializers.StringRelatedField(allow_null=True)
    environment = serializers.StringRelatedField(allow_null=True)
    triggered_by = serializers.StringRelatedField(allow_null=True)
    results = ApiRunResultSerializer(many=True, read_only=True)

    class Meta:
        model = models.ApiRun
        fields = [
            "id",
            "collection",
            "environment",
            "triggered_by",
            "status",
            "summary",
            "started_at",
            "finished_at",
            "results",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class TestCaseSerializer(serializers.ModelSerializer):
    title = serializers.CharField(source="testcase_id", read_only=True)
    expected_results = serializers.ListField(child=serializers.JSONField(), required=False)

    class Meta:
        model = models.TestCase
        fields = [
            "id",
            "scenario",
            "testcase_id",
            "title",
            "description",
            "precondition",
            "requirements",
            "expected_results",
            "related_api_request",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "title"]
        validators = [
            serializers.UniqueTogetherValidator(
                queryset=models.TestCase.objects.all(),
                fields=["scenario", "testcase_id"],
                message="Test case ID must be unique per scenario.",
            )
        ]

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        testcase_id = attrs.get("testcase_id")
        if testcase_id:
            attrs["testcase_id"] = str(testcase_id).strip()
        return attrs


class TestScenarioSerializer(serializers.ModelSerializer):
    cases = TestCaseSerializer(many=True, read_only=True)
    tags = serializers.ListField(child=serializers.CharField(), required=False)

    class Meta:
        model = models.TestScenario
        fields = [
            "id",
            "plan",
            "title",
            "description",
            "preconditions",
            "postconditions",
            "tags",
            "cases",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "cases", "created_at", "updated_at"]


class TestPlanScopeSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.TestPlanScope
        fields = [
            "id",
            "category",
            "item",
            "order",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "order", "created_at", "updated_at"]


class TestPlanMaintenanceSerializer(serializers.ModelSerializer):
    updates = serializers.DictField(child=serializers.JSONField(), required=False)

    class Meta:
        model = models.TestPlanMaintenance
        fields = [
            "id",
            "plan",
            "version",
            "summary",
            "updates",
            "effective_date",
            "updated_by",
            "approved_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class RiskSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.Risk
        fields = ["id", "title", "description", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class MitigationPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.MitigationPlan
        fields = ["id", "title", "description", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class RiskAndMitigationPlanSerializer(serializers.ModelSerializer):
    risk = serializers.PrimaryKeyRelatedField(queryset=models.Risk.objects.all())
    mitigation_plan = serializers.PrimaryKeyRelatedField(queryset=models.MitigationPlan.objects.all())
    risk_title = serializers.CharField(source="risk.title", read_only=True)
    risk_description = serializers.CharField(source="risk.description", read_only=True)
    mitigation_plan_title = serializers.CharField(source="mitigation_plan.title", read_only=True)
    mitigation_plan_description = serializers.CharField(source="mitigation_plan.description", read_only=True)

    class Meta:
        model = models.RiskAndMitigationPlan
        fields = [
            "id",
            "risk",
            "risk_title",
            "risk_description",
            "mitigation_plan",
            "mitigation_plan_title",
            "mitigation_plan_description",
            "impact",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "risk_title",
            "risk_description",
            "mitigation_plan_title",
            "mitigation_plan_description",
            "created_at",
            "updated_at",
        ]


class TestPlanSerializer(serializers.ModelSerializer):
    modules_under_test = serializers.ListField(child=serializers.CharField(), required=False)
    testing_types = serializers.DictField(child=serializers.ListField(child=serializers.CharField()), required=False)
    tools = serializers.ListField(child=serializers.CharField(), required=False)
    testing_timeline = serializers.DictField(child=serializers.JSONField(), required=False)
    testers = serializers.ListField(child=serializers.CharField(), required=False)
    scopes = TestPlanScopeSerializer(many=True, required=False)
    maintenances = TestPlanMaintenanceSerializer(many=True, read_only=True)
    scenarios = TestScenarioSerializer(many=True, read_only=True)
    risk_mitigations = serializers.PrimaryKeyRelatedField(
        queryset=models.RiskAndMitigationPlan.objects.all(),
        many=True,
        required=False,
    )
    risk_mitigation_details = RiskAndMitigationPlanSerializer(
        source="risk_mitigations",
        many=True,
        read_only=True,
    )

    class Meta:
        model = models.TestPlan
        fields = [
            "id",
            "name",
            "objective",
            "objectives",
            "description",
            "modules_under_test",
            "testing_types",
            "tools",
            "testing_timeline",
            "testers",
            "approver",
            "scopes",
            "risk_mitigations",
            "risk_mitigation_details",
            "maintenances",
            "scenarios",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "maintenances", "scenarios", "created_at", "updated_at"]

    def validate_testing_types(self, value: dict[str, list[str]]) -> dict[str, list[str]]:
        if not isinstance(value, dict):
            raise ValidationError({"testing_types": "Testing types must be an object with functional categories."})
        allowed_keys = {"functional", "non_functional"}
        for key, tests in value.items():
            if key not in allowed_keys:
                raise ValidationError({"testing_types": f"Unsupported category '{key}'."})
            if not isinstance(tests, list):
                raise ValidationError({"testing_types": f"Category '{key}' must be a list."})
        return value

    def validate_objectives(self, value: Any) -> list[dict[str, str]]:
        if value in (None, serializers.empty):
            if self.instance is not None:
                return self.instance.objectives

            raise ValidationError({"objectives": "At least one objective/goal pair is required."})
        if not isinstance(value, list):
            raise ValidationError({"objectives": "Objectives must be a list of entries."})

        normalized: list[dict[str, str]] = []
        for index, entry in enumerate(value, start=1):
            if not isinstance(entry, dict):
                raise ValidationError({"objectives": f"Entry {index} must be an object."})
            title = str(entry.get("title", "")).strip()
            objective_text = str(entry.get("objective", "")).strip()
            goal = str(entry.get("goal", "")).strip()
            if not title or not objective_text or not goal:
                raise ValidationError(
                    {
                        "objectives": f"Entry {index} requires title, objective, and goal values.",
                    }
                )
            normalized.append({
                "title": title,
                "objective": objective_text,
                "goal": goal,
            })

        if not normalized:
            raise ValidationError({"objectives": "At least one objective/goal pair is required."})

        return normalized

    @transaction.atomic
    def create(self, validated_data: dict[str, Any]) -> models.TestPlan:
        scopes_data = validated_data.pop("scopes", [])
        risk_mitigations = validated_data.pop("risk_mitigations", [])
        plan = models.TestPlan.objects.create(**validated_data)
        self._replace_scopes(plan, scopes_data)
        if risk_mitigations:
            plan.risk_mitigations.set(risk_mitigations)
        return plan

    @transaction.atomic
    def update(self, instance: models.TestPlan, validated_data: dict[str, Any]) -> models.TestPlan:
        scopes_data = validated_data.pop("scopes", None)
        risk_mitigations = validated_data.pop("risk_mitigations", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if scopes_data is not None:
            self._replace_scopes(instance, scopes_data)
        if risk_mitigations is not None:
            instance.risk_mitigations.set(risk_mitigations)
        return instance

    def _replace_scopes(self, plan: models.TestPlan, scopes_data: list[dict[str, Any]]) -> None:
        plan.scopes.all().delete()
        if not scopes_data:
            return
        for index, entry in enumerate(scopes_data):
            models.TestPlanScope.objects.create(
                plan=plan,
                order=index,
                **entry,
            )
