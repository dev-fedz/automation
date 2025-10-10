"""Core models providing API automation similar to Postman collections."""

from __future__ import annotations

import uuid
from typing import Any

from django.conf import settings
from django.db import models


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class ApiEnvironment(TimeStampedModel):
    """Stores reusable variables and headers for request execution."""

    name = models.CharField(max_length=150, unique=True)
    description = models.TextField(blank=True)
    variables = models.JSONField(default=dict, blank=True)
    default_headers = models.JSONField(default=dict, blank=True)

    def __str__(self) -> str:  # pragma: no cover - display helper
        return self.name


class ApiCollection(TimeStampedModel):
    """Group of API requests that can be executed together."""

    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    environments = models.ManyToManyField(ApiEnvironment, related_name="collections", blank=True)
    slug = models.SlugField(max_length=180, unique=True, default="")

    def save(self, *args: Any, **kwargs: Any) -> None:
        if not self.slug:
            self.slug = uuid.uuid4().hex
        super().save(*args, **kwargs)

    def __str__(self) -> str:  # pragma: no cover - display helper
        return self.name


class ApiRequest(TimeStampedModel):
    """Defines a single HTTP request configuration."""

    class BodyTypes(models.TextChoices):
        NONE = "none", "None"
        JSON = "json", "JSON"
        FORM = "form", "Form"
        RAW = "raw", "Raw"

    class AuthTypes(models.TextChoices):
        NONE = "none", "None"
        BASIC = "basic", "Basic Auth"
        BEARER = "bearer", "Bearer Token"

    HTTP_METHOD_CHOICES = [
        ("GET", "GET"),
        ("POST", "POST"),
        ("PUT", "PUT"),
        ("PATCH", "PATCH"),
        ("DELETE", "DELETE"),
        ("HEAD", "HEAD"),
        ("OPTIONS", "OPTIONS"),
    ]

    collection = models.ForeignKey(ApiCollection, on_delete=models.CASCADE, related_name="requests")
    name = models.CharField(max_length=150)
    method = models.CharField(max_length=10, choices=HTTP_METHOD_CHOICES, default="GET")
    url = models.CharField(max_length=500)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0, db_index=True)
    timeout_ms = models.PositiveIntegerField(default=30000)

    headers = models.JSONField(default=dict, blank=True)
    query_params = models.JSONField(default=dict, blank=True)

    body_type = models.CharField(max_length=10, choices=BodyTypes.choices, default=BodyTypes.NONE)
    body_json = models.JSONField(default=dict, blank=True)
    body_form = models.JSONField(default=dict, blank=True)
    body_raw = models.TextField(blank=True)

    auth_type = models.CharField(max_length=10, choices=AuthTypes.choices, default=AuthTypes.NONE)
    auth_basic = models.JSONField(default=dict, blank=True)
    auth_bearer = models.CharField(max_length=512, blank=True)

    pre_request_script = models.TextField(blank=True)
    tests_script = models.TextField(blank=True)

    class Meta:
        ordering = ["collection", "order", "id"]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.collection.name}: {self.name}"


class ApiAssertion(TimeStampedModel):
    """Assertion to run against an API response."""

    class AssertionTypes(models.TextChoices):
        STATUS_CODE = "status_code", "Status Code"
        JSON_PATH = "json_path", "JSON Path"
        HEADER = "header", "Header"
        BODY_CONTAINS = "body_contains", "Body Contains"

    request = models.ForeignKey(ApiRequest, on_delete=models.CASCADE, related_name="assertions")
    type = models.CharField(max_length=20, choices=AssertionTypes.choices)
    field = models.CharField(max_length=255, blank=True)
    expected_value = models.CharField(max_length=1024, blank=True)
    comparator = models.CharField(max_length=50, default="equals")
    allow_partial = models.BooleanField(default=False)

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.request.name}: {self.type}"


class ApiRun(TimeStampedModel):
    """Represents a collection execution."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        PASSED = "passed", "Passed"
        FAILED = "failed", "Failed"

    collection = models.ForeignKey(ApiCollection, on_delete=models.CASCADE, related_name="runs")
    environment = models.ForeignKey(ApiEnvironment, on_delete=models.SET_NULL, null=True, blank=True, related_name="runs")
    triggered_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="api_runs")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    summary = models.JSONField(default=dict, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    def __str__(self) -> str:  # pragma: no cover
        return f"Run {self.pk} - {self.collection.name} ({self.status})"


class ApiRunResult(TimeStampedModel):
    """Holds per-request result for a run."""

    class Status(models.TextChoices):
        PASSED = "passed", "Passed"
        FAILED = "failed", "Failed"
        ERROR = "error", "Error"

    run = models.ForeignKey(ApiRun, on_delete=models.CASCADE, related_name="results")
    request = models.ForeignKey(ApiRequest, on_delete=models.SET_NULL, null=True, related_name="results")
    order = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=10, choices=Status.choices)
    response_status = models.IntegerField(null=True, blank=True)
    response_headers = models.JSONField(default=dict, blank=True)
    response_body = models.TextField(blank=True)
    response_time_ms = models.FloatField(null=True, blank=True)
    assertions_passed = models.JSONField(default=list, blank=True)
    assertions_failed = models.JSONField(default=list, blank=True)
    error = models.TextField(blank=True)

    class Meta:
        ordering = ["run", "order", "id"]

    def __str__(self) -> str:  # pragma: no cover
        return f"Result {self.pk} ({self.status})"
