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


class TestModulesSerializer(serializers.ModelSerializer):
    project = serializers.PrimaryKeyRelatedField(
        queryset=models.Project.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    project_id = serializers.IntegerField(source="project.id", read_only=True)

    class Meta:
        model = models.TestModules
        fields = ["id", "title", "description", "project", "project_id", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at", "project_id"]


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


class AutomationReportSerializer(serializers.ModelSerializer):
    triggered_by = serializers.StringRelatedField(read_only=True)

    class Meta:
        model = models.AutomationReport
        fields = [
            "id",
            "report_id",
            "triggered_in",
            "triggered_by",
            "total_passed",
            "total_failed",
            "total_blocked",
            "started",
            "finished",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "report_id", "triggered_by", "created_at", "updated_at"]


class ApiRunResultReportSerializer(serializers.ModelSerializer):
    request_name = serializers.CharField(source="request.name", read_only=True)
    run_id = serializers.IntegerField(source="run.id", read_only=True)
    testcase_id = serializers.SerializerMethodField()

    class Meta:
        model = models.ApiRunResultReport
        fields = [
            "id",
            "testcase_id",
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
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_testcase_id(self, obj):
        try:
            if obj.testcase:
                return obj.testcase.testcase_id or obj.testcase.id
        except Exception:
            return None
        return None


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
    test_case_dependency = serializers.PrimaryKeyRelatedField(
        queryset=models.TestCase.objects.all(),
        required=False,
        allow_null=True,
    )
    requires_dependency = serializers.BooleanField(required=False)
    dependency_response_key = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    is_response_encrypted = serializers.BooleanField(required=False)

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
            "test_case_dependency",
            "requires_dependency",
            "dependency_response_key",
            "is_response_encrypted",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {
            "testcase_id": {"required": False, "allow_null": True, "allow_blank": True},
            "dependency_response_key": {"required": False, "allow_blank": True, "allow_null": True},
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

        # Dependency validation
        requires_dependency = attrs.get("requires_dependency")
        if requires_dependency is None and self.instance is not None:
            requires_dependency = self.instance.requires_dependency

        dependency = attrs.get("test_case_dependency")
        if dependency is None and self.instance is not None:
            dependency = self.instance.test_case_dependency

        dependency_key = attrs.get("dependency_response_key")
        if dependency_key is None and self.instance is not None:
            dependency_key = self.instance.dependency_response_key

        dependency_requested = bool(
            requires_dependency
            or dependency
            or (dependency_key and str(dependency_key).strip())
        )

        if dependency_requested and dependency is None:
            raise ValidationError({
                "test_case_dependency": "Select a dependency test case when dependency data is required.",
            })

        if dependency_requested:
            key_str = str(dependency_key or "").strip()
            if not key_str:
                raise ValidationError({
                    "dependency_response_key": "Enter the response key that must exist in the dependency output.",
                })
            attrs["dependency_response_key"] = key_str
            attrs["requires_dependency"] = True
            scenario_obj = attrs.get("scenario") or (self.instance.scenario if self.instance else None)
            if scenario_obj and dependency and dependency.scenario_id != scenario_obj.id:
                raise ValidationError({
                    "test_case_dependency": "Dependency must belong to the same scenario.",
                })
            if dependency and self.instance and dependency.pk == self.instance.pk:
                raise ValidationError({
                    "test_case_dependency": "A test case cannot depend on itself.",
                })
        else:
            attrs["requires_dependency"] = False
            # Avoid persisting stale key data when dependency is not required
            attrs["dependency_response_key"] = ""
            # If dependency field not provided explicitly, leave existing value untouched on update
            if "test_case_dependency" not in attrs and self.instance is not None:
                pass

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


class TestCaseAttachmentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    storage_backend = serializers.SerializerMethodField()
    storage_bucket = serializers.SerializerMethodField()
    storage_key = serializers.SerializerMethodField()
    uploaded_by = serializers.StringRelatedField(read_only=True)

    class Meta:
        model = models.TestCaseAttachment
        fields = [
            "id",
            "test_case",
            "original_name",
            "content_type",
            "size",
            "url",
            "storage_backend",
            "storage_bucket",
            "storage_key",
            "uploaded_by",
            "created_at",
        ]
        read_only_fields = fields

    def get_url(self, obj):
        try:
            return obj.file.url if obj.file else None
        except Exception:
            return None

    def get_storage_key(self, obj):
        try:
            return obj.file.name if obj.file else None
        except Exception:
            return None

    def get_storage_bucket(self, obj):
        try:
            storage = obj.file.storage if obj.file else None
            if storage is None:
                return None
            bucket_name = getattr(storage, "bucket_name", None)
            if bucket_name:
                return str(bucket_name)
            return None
        except Exception:
            return None

    def get_storage_backend(self, obj):
        try:
            storage = obj.file.storage if obj.file else None
            if storage is None:
                return None
            module = (storage.__class__.__module__ or "").lower()
            name = (storage.__class__.__name__ or "").lower()
            if "s3" in module or "boto" in module or "s3" in name or getattr(storage, "bucket_name", None):
                return "s3"
            if "filesystemstorage" in name or "django.core.files.storage" in module:
                return "local"
            return "other"
        except Exception:
            return None


class TestCaseCommentAttachmentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    storage_backend = serializers.SerializerMethodField()
    storage_bucket = serializers.SerializerMethodField()
    storage_key = serializers.SerializerMethodField()
    uploaded_by = serializers.StringRelatedField(read_only=True)

    class Meta:
        model = models.TestCaseCommentAttachment
        fields = [
            "id",
            "comment",
            "original_name",
            "content_type",
            "size",
            "url",
            "storage_backend",
            "storage_bucket",
            "storage_key",
            "uploaded_by",
            "created_at",
        ]
        read_only_fields = fields

    def get_url(self, obj):
        try:
            return obj.file.url if obj.file else None
        except Exception:
            return None

    def get_storage_key(self, obj):
        try:
            return obj.file.name if obj.file else None
        except Exception:
            return None

    def get_storage_bucket(self, obj):
        try:
            storage = obj.file.storage if obj.file else None
            if storage is None:
                return None
            bucket_name = getattr(storage, "bucket_name", None)
            if bucket_name:
                return str(bucket_name)
            return None
        except Exception:
            return None

    def get_storage_backend(self, obj):
        try:
            storage = obj.file.storage if obj.file else None
            if storage is None:
                return None
            module = (storage.__class__.__module__ or "").lower()
            name = (storage.__class__.__name__ or "").lower()
            if "s3" in module or "boto" in module or "s3" in name or getattr(storage, "bucket_name", None):
                return "s3"
            if "filesystemstorage" in name or "django.core.files.storage" in module:
                return "local"
            return "other"
        except Exception:
            return None


class TestScenarioSerializer(serializers.ModelSerializer):
    cases = TestCaseSerializer(many=True, read_only=True)
    is_automated = serializers.BooleanField(required=False, default=True)
    module = serializers.PrimaryKeyRelatedField(
        queryset=models.TestModules.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    module_id = serializers.IntegerField(source="module.id", read_only=True)
    project = serializers.PrimaryKeyRelatedField(
        queryset=models.Project.objects.all(),
        write_only=True,
        required=True,
    )
    project_id = serializers.IntegerField(source="project.id", read_only=True)

    class Meta:
        model = models.TestScenario
        fields = [
            "id",
            "project",
            "project_id",
            "module",
            "module_id",
            "title",
            "description",
            "is_automated",
            "cases",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "cases", "created_at", "updated_at", "project_id"]


class ScenarioCommentSerializer(serializers.ModelSerializer):
    user_email = serializers.EmailField(source="user.email", read_only=True)
    user_name = serializers.SerializerMethodField()
    is_edited = serializers.SerializerMethodField()
    replies = serializers.SerializerMethodField()
    likes_count = serializers.SerializerMethodField()
    user_has_liked = serializers.SerializerMethodField()
    user_reaction = serializers.SerializerMethodField()
    reactions_summary = serializers.SerializerMethodField()

    class Meta:
        model = models.ScenarioComment
        fields = [
            "id",
            "scenario",
            "user",
            "user_email",
            "user_name",
            "content",
            "parent",
            "created_at",
            "updated_at",
            "is_edited",
            "replies",
            "likes_count",
            "user_has_liked",
            "user_reaction",
            "reactions_summary",
        ]
        read_only_fields = [
            "id",
            "user",
            "created_at",
            "updated_at",
            "likes_count",
            "user_has_liked",
            "user_reaction",
            "reactions_summary",
        ]

    def get_user_name(self, obj):
        if obj.user:
            return f"{obj.user.first_name} {obj.user.last_name}".strip() or obj.user.email
        return "Unknown"

    def get_is_edited(self, obj):
        # Consider edited if updated_at is more than 1 second after created_at
        if obj.updated_at and obj.created_at:
            delta = (obj.updated_at - obj.created_at).total_seconds()
            return delta > 1
        return False

    def get_replies(self, obj):
        # Only include replies for top-level comments to avoid deep nesting
        if obj.parent is None:
            replies = obj.replies.all()
            return ScenarioCommentSerializer(replies, many=True, context=self.context).data
        return []

    def get_likes_count(self, obj):
        return obj.likes.count()

    def get_user_has_liked(self, obj):
        request = self.context.get('request')
        if request and request.user and request.user.is_authenticated:
            return obj.likes.filter(user=request.user).exists()
        return False

    def get_user_reaction(self, obj):
        request = self.context.get('request')
        if request and request.user and request.user.is_authenticated:
            try:
                # Prefer prefetched reactions to avoid N+1 queries.
                for item in obj.reactions.all():
                    if getattr(item, 'user_id', None) == request.user.id:
                        return getattr(item, 'reaction', None) or None
            except Exception:
                pass
            reaction = obj.reactions.filter(user=request.user).values_list('reaction', flat=True).first()
            return reaction or None
        return None

    def get_reactions_summary(self, obj):
        counts = {}
        try:
            # Use prefetched reactions when present.
            for item in obj.reactions.all():
                key = getattr(item, 'reaction', None)
                if not key:
                    continue
                counts[key] = counts.get(key, 0) + 1
        except Exception:
            # Fallback (may query)
            for key in obj.reactions.values_list('reaction', flat=True):
                if not key:
                    continue
                counts[key] = counts.get(key, 0) + 1

        # Sort by count desc, then reaction for stable output
        return [
            {"reaction": reaction, "count": count}
            for reaction, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        ]


class TestCaseCommentSerializer(serializers.ModelSerializer):
    user_email = serializers.EmailField(source="user.email", read_only=True)
    user_name = serializers.SerializerMethodField()
    is_edited = serializers.SerializerMethodField()
    replies = serializers.SerializerMethodField()
    likes_count = serializers.SerializerMethodField()
    user_has_liked = serializers.SerializerMethodField()
    user_reaction = serializers.SerializerMethodField()
    reactions_summary = serializers.SerializerMethodField()
    attachments = TestCaseCommentAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = models.TestCaseComment
        fields = [
            "id",
            "test_case",
            "user",
            "user_email",
            "user_name",
            "content",
            "parent",
            "attachments",
            "created_at",
            "updated_at",
            "is_edited",
            "replies",
            "likes_count",
            "user_has_liked",
            "user_reaction",
            "reactions_summary",
        ]
        read_only_fields = [
            "id",
            "user",
            "attachments",
            "created_at",
            "updated_at",
            "likes_count",
            "user_has_liked",
            "user_reaction",
            "reactions_summary",
        ]

    def get_user_name(self, obj):
        if obj.user:
            return f"{obj.user.first_name} {obj.user.last_name}".strip() or obj.user.email
        return "Unknown"

    def get_is_edited(self, obj):
        if obj.updated_at and obj.created_at:
            delta = (obj.updated_at - obj.created_at).total_seconds()
            return delta > 1
        return False

    def get_replies(self, obj):
        if obj.parent is None:
            replies = obj.replies.all()
            return TestCaseCommentSerializer(replies, many=True, context=self.context).data
        return []

    def get_likes_count(self, obj):
        return obj.likes.count()

    def get_user_has_liked(self, obj):
        request = self.context.get('request')
        if request and request.user and request.user.is_authenticated:
            return obj.likes.filter(user=request.user).exists()
        return False

    def get_user_reaction(self, obj):
        request = self.context.get('request')
        if request and request.user and request.user.is_authenticated:
            try:
                for item in obj.reactions.all():
                    if getattr(item, 'user_id', None) == request.user.id:
                        return getattr(item, 'reaction', None) or None
            except Exception:
                pass
            reaction = obj.reactions.filter(user=request.user).values_list('reaction', flat=True).first()
            return reaction or None
        return None

    def get_reactions_summary(self, obj):
        counts = {}
        try:
            for item in obj.reactions.all():
                key = getattr(item, 'reaction', None)
                if not key:
                    continue
                counts[key] = counts.get(key, 0) + 1
        except Exception:
            for key in obj.reactions.values_list('reaction', flat=True):
                if not key:
                    continue
                counts[key] = counts.get(key, 0) + 1

        return [
            {"reaction": reaction, "count": count}
            for reaction, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        ]


class ProjectSerializer(serializers.ModelSerializer):
    description = serializers.CharField(allow_blank=True, required=False)
    test_modules = TestModulesSerializer(many=True, read_only=True)
    scenarios = TestScenarioSerializer(many=True, read_only=True)
    modules_count = serializers.SerializerMethodField()
    scenarios_count = serializers.SerializerMethodField()

    class Meta:
        model = models.Project
        fields = [
            "id",
            "name",
            "description",
            "test_modules",
            "scenarios",
            "modules_count",
            "scenarios_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "test_modules",
            "scenarios",
            "modules_count",
            "scenarios_count",
            "created_at",
            "updated_at",
        ]

    def get_modules_count(self, obj: models.Project) -> int:
        related = getattr(obj, "test_modules", None)
        if related is None:
            return obj.test_modules.count()
        if hasattr(related, "count"):
            try:
                return related.count()
            except TypeError:
                pass
        try:
            return len(related)
        except TypeError:
            return obj.test_modules.count()

    def get_scenarios_count(self, obj: models.Project) -> int:
        related = getattr(obj, "scenarios", None)
        if related is None:
            return obj.scenarios.count()
        if hasattr(related, "count"):
            try:
                return related.count()
            except TypeError:
                pass
        try:
            return len(related)
        except TypeError:
            return obj.scenarios.count()
