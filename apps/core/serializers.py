"""Serializers powering the API automation feature set."""

from __future__ import annotations

from typing import Any, Iterable

from django.db import transaction
from rest_framework import serializers

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


class ApiRequestSerializer(serializers.ModelSerializer):
    assertions = ApiAssertionSerializer(many=True, required=False)

    class Meta:
        model = models.ApiRequest
        fields = [
            "id",
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
            "auth_type",
            "auth_basic",
            "auth_bearer",
            "pre_request_script",
            "tests_script",
            "assertions",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def create(self, validated_data: dict[str, Any]) -> models.ApiRequest:
        assertions_data = validated_data.pop("assertions", [])
        api_request = models.ApiRequest.objects.create(**validated_data)
        self._sync_assertions(api_request, assertions_data)
        return api_request

    def update(self, instance: models.ApiRequest, validated_data: dict[str, Any]) -> models.ApiRequest:
        assertions_data = validated_data.pop("assertions", None)
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
            "requests",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "slug", "created_at", "updated_at", "environments"]

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
            request_data.setdefault("order", index)
            request_payload = {k: v for k, v in request_data.items() if k != "id"}

            if request_id:
                api_request = collection.requests.filter(id=request_id).first()
                if api_request:
                    for attr, value in request_payload.items():
                        setattr(api_request, attr, value)
                    api_request.save()
                    ApiRequestSerializer()._sync_assertions(api_request, assertions_data)
                    keep_ids.append(api_request.id)
                    continue

            api_request = models.ApiRequest.objects.create(collection=collection, **request_payload)
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
    collection = serializers.StringRelatedField()
    environment = serializers.StringRelatedField()
    triggered_by = serializers.StringRelatedField()
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
