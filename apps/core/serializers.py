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


class TestToolsSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.TestTools
        fields = ["id", "title", "description", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class TestModulesSerializer(serializers.ModelSerializer):
    plan = serializers.PrimaryKeyRelatedField(
        queryset=models.TestPlan.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    plan_id = serializers.IntegerField(source="plan.id", read_only=True)

    class Meta:
        model = models.TestModules
        fields = ["id", "title", "description", "plan", "plan_id", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at", "plan_id"]


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
    run_id = serializers.IntegerField(read_only=True)
    environment_name = serializers.SerializerMethodField()

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
            "run_id",
            "environment_name",
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
            "run_id",
            "environment_name",
            "created_at",
            "updated_at",
        ]

    def get_environment_name(self, obj):
        run = getattr(obj, "run", None)
        if run and getattr(run, "environment", None):
            return run.environment.name
        return None


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
    # Allow API clients to omit testcase_id; it will be generated in model.save()
    testcase_id = serializers.CharField(required=False, allow_blank=True, allow_null=True, default=None)
    # Title is a human-friendly field, editable by clients
    title = serializers.CharField(required=False, allow_blank=True)
    steps = serializers.ListField(child=serializers.JSONField(), required=False)
    expected_results = serializers.ListField(child=serializers.JSONField(), required=False)
    dynamic_variables = serializers.DictField(child=serializers.JSONField(), required=False)
    priority = serializers.CharField(required=False, allow_blank=True)
    owner_id = serializers.IntegerField(source="owner.id", read_only=True)
    owner = serializers.StringRelatedField(read_only=True)
    # Allow clients to select a related API request by id
    related_api_request = serializers.PrimaryKeyRelatedField(
        queryset=models.ApiRequest.objects.all(),
        required=False,
        allow_null=True,
    )
    # Read-only convenience field exposing the related ApiRequest's name
    related_api_request_name = serializers.CharField(source='related_api_request.name', read_only=True)

    class Meta:
        model = models.TestCase
        fields = [
            "id",
            "scenario",
            "testcase_id",
            "title",
            "steps",
            "description",
            "precondition",
            "requirements",
            "expected_results",
            "dynamic_variables",
            "priority",
            "owner",
            "owner_id",
            "related_api_request",
            "related_api_request_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {
            "testcase_id": {"required": False, "allow_null": True, "allow_blank": True}
        }
        # validators: uniqueness is checked in validate() only when a
        # testcase_id is supplied (so missing/testcase generation flows
        # are allowed)

    def create(self, validated_data: dict[str, Any]) -> models.TestCase:
        """
        Ensure that a provided related_api_request is applied to the created
        TestCase instance. Some callers or custom create flows may not set the
        FK during the initial model creation; set it explicitly afterward to
        guarantee persistence.
        """
        related = validated_data.pop('related_api_request', None)
        # Use the default ModelSerializer.create behavior to construct the
        # instance (which will call model.save() and trigger auto-generation
        # of testcase_id when needed).
        instance = super().create(validated_data)
        if related is not None:
            try:
                instance.related_api_request = related
                instance.save(update_fields=['related_api_request'])
            except Exception:
                # Do not raise here — validation and response have already
                # succeeded; best-effort persistence only.
                pass
        return instance

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        testcase_id = attrs.get("testcase_id")
        if testcase_id:
            testcase_id = str(testcase_id).strip()
            attrs["testcase_id"] = testcase_id
            # ensure uniqueness per scenario when provided
            scenario = attrs.get("scenario")
            if scenario and models.TestCase.objects.filter(scenario=scenario, testcase_id=testcase_id).exists():
                raise ValidationError({"testcase_id": "Test case ID must be unique per scenario."})
        return attrs

    def update(self, instance: models.TestCase, validated_data: dict[str, Any]) -> models.TestCase:
        """
        Prevent clients from changing the testcase_id via update requests.
        The testcase_id must be generated once by the model on create and
        should remain immutable afterwards.
        """
        # remove testcase_id if present in update payload to preserve existing value
        if 'testcase_id' in validated_data:
            validated_data.pop('testcase_id', None)
        return super().update(instance, validated_data)


class TestScenarioSerializer(serializers.ModelSerializer):
    cases = TestCaseSerializer(many=True, read_only=True)
    tags = serializers.ListField(child=serializers.CharField(), required=False)
    module = serializers.PrimaryKeyRelatedField(
        queryset=models.TestModules.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    module_id = serializers.IntegerField(source="module.id", read_only=True)

    class Meta:
        model = models.TestScenario
        fields = [
            "id",
            "plan",
            "module",
            "module_id",
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
    plan = serializers.PrimaryKeyRelatedField(queryset=models.TestPlan.objects.all(), required=False, allow_null=True)
    risk = serializers.PrimaryKeyRelatedField(queryset=models.Risk.objects.all())
    mitigation_plan = serializers.PrimaryKeyRelatedField(queryset=models.MitigationPlan.objects.all())
    risk_title = serializers.CharField(source="risk.title", read_only=True)
    risk_description = serializers.CharField(source="risk.description", read_only=True)
    mitigation_plan_title = serializers.CharField(source="mitigation_plan.title", read_only=True)
    mitigation_plan_description = serializers.CharField(source="mitigation_plan.description", read_only=True)

    def create(self, validated_data: dict[str, Any]) -> models.RiskAndMitigationPlan:
        """
        Make creation idempotent: if a mapping for the same (risk, mitigation_plan)
        already exists, return that instance instead of raising a uniqueness
        error. Update the impact field when a different value is provided.
        """
        plan = validated_data.get("plan")
        risk = validated_data.get("risk")
        mitigation = validated_data.get("mitigation_plan")
        impact = validated_data.get("impact", "")
        defaults = {"impact": impact}
        if plan is not None:
            defaults["plan"] = plan
        obj, created = models.RiskAndMitigationPlan.objects.get_or_create(
            risk=risk,
            mitigation_plan=mitigation,
            defaults=defaults,
        )
        # If an existing mapping was returned but a plan or impact was
        # provided in the request, ensure we update the existing record so
        # that mappings can be associated with a TestPlan after the fact.
        if not created:
            changed = False
            if impact and obj.impact != impact:
                obj.impact = impact
                changed = True
            if plan is not None and getattr(obj, "plan_id", None) != getattr(plan, "id", None):
                obj.plan = plan
                changed = True
            if changed:
                obj.save()
        return obj

    class Meta:
        model = models.RiskAndMitigationPlan
        fields = [
            "plan",
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
        # Disable automatic model validators (e.g. UniqueTogetherValidator)
        # so we can implement idempotent create() logic that safely
        # resolves existing mappings via get_or_create.
        validators = []


class TestPlanSerializer(serializers.ModelSerializer):
    modules_under_test = serializers.ListField(child=serializers.CharField(), required=False)
    testing_types = serializers.DictField(child=serializers.ListField(child=serializers.CharField()), required=False)
    tools = serializers.ListField(child=serializers.CharField(), required=False)
    testing_timeline = serializers.DictField(child=serializers.JSONField(), required=False)
    testers = serializers.ListField(child=serializers.CharField(), required=False)
    scopes = TestPlanScopeSerializer(many=True, required=False)
    maintenances = TestPlanMaintenanceSerializer(many=True, read_only=True)
    scenarios = TestScenarioSerializer(many=True, read_only=True)
    # The relationship was changed: RiskAndMitigationPlan now has a ForeignKey to
    # TestPlan with related_name='risk_mitigation_links'. Expose the detailed
    # link objects on the TestPlan serializer via that related_name. We no
    # longer expose a direct M2M of mapping ids on the plan.
    risk_mitigation_details = RiskAndMitigationPlanSerializer(
        source="risk_mitigation_links",
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
        plan = models.TestPlan.objects.create(**validated_data)
        self._replace_scopes(plan, scopes_data)
        return plan

    @transaction.atomic
    def update(self, instance: models.TestPlan, validated_data: dict[str, Any]) -> models.TestPlan:
        scopes_data = validated_data.pop("scopes", None)
        # The M2M relationship was removed; mappings are now separate objects
        # (RiskAndMitigationPlan) referencing the plan. Updates to links should
        # be performed via the RiskAndMitigationPlan endpoints.
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if scopes_data is not None:
            self._replace_scopes(instance, scopes_data)
        return instance
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
