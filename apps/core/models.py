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


class ApiCollectionDirectory(TimeStampedModel):
    """Folders inside a collection used to organize requests."""

    collection = models.ForeignKey("ApiCollection", on_delete=models.CASCADE, related_name="directories")
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="children",
    )
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0, db_index=True)

    class Meta:
        ordering = ["collection", "parent_id", "order", "id"]
        unique_together = ("collection", "parent", "name")

    def __str__(self) -> str:  # pragma: no cover
        path = [self.name]
        parent = self.parent
        while parent:
            path.append(parent.name)
            parent = parent.parent
        return " / ".join(reversed(path))


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
    directory = models.ForeignKey(
        ApiCollectionDirectory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="requests",
    )
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
    body_raw_type = models.CharField(max_length=20, default="text")
    body_transforms = models.JSONField(default=dict, blank=True)

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

    collection = models.ForeignKey(
        ApiCollection,
        on_delete=models.CASCADE,
        related_name="runs",
        null=True,
        blank=True,
    )
    environment = models.ForeignKey(ApiEnvironment, on_delete=models.SET_NULL, null=True, blank=True, related_name="runs")
    triggered_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="api_runs")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    summary = models.JSONField(default=dict, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    def __str__(self) -> str:  # pragma: no cover
        collection_name = self.collection.name if self.collection else "Adhoc"
        return f"Run {self.pk} - {collection_name} ({self.status})"


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



class TestTools(TimeStampedModel):
    """Test Tool for test strategies."""
    title = models.CharField(max_length=150)
    description = models.TextField(blank=True)

    class Meta:
        ordering = ["title", "id"]

    def __str__(self) -> str:  # pragma: no cover
        return self.title


class TestPlan(TimeStampedModel):
    """High-level plan describing the scope and approach for automation testing."""

    class TestEnvironment(models.TextChoices):
        TEST_ENVIRONMENT = "T", "Test Environment"
        PRE_STAGING_ENVIRONMENT = "PS", "Pre Staging Environment"
        STAGING_ENVIRONMENT = "S", "Staging Environment"
        UAT_ENVIRONMENT = "UAT", "UAT Environment"
        PRODUCTION_ENVIRONMENT = "P", "Production Environment"

    test_environment = models.CharField(max_length=20, choices=TestEnvironment.choices, blank=True, null=True)
    test_tools = models.ForeignKey(
        TestTools,
        on_delete=models.SET_NULL,
        related_name="test_plans",
        blank=True,
        null=True,
    )
    name = models.CharField(max_length=150, unique=True)
    # allow drafts to be created before the rich-text objective is provided
    objective = models.TextField(blank=True, default="")
    objectives = models.JSONField(default=list, blank=True)
    description = models.TextField(blank=True)
    modules_under_test = models.JSONField(default=list, blank=True)
    testing_types = models.JSONField(default=dict, blank=True)
    tools = models.JSONField(default=list, blank=True)
    testing_timeline = models.JSONField(default=dict, blank=True)
    testers = models.JSONField(default=list, blank=True)
    approver = models.CharField(max_length=255, blank=True)
    risk_mitigations = models.ManyToManyField(
        "RiskAndMitigationPlan",
        related_name="test_plans",
        blank=True,
    )

    class Meta:
        ordering = ["name", "id"]

    def __str__(self) -> str:  # pragma: no cover
        return self.name

class TestPlanObjectives(TimeStampedModel):
    """Categorized objectives entries linked to a test plan."""

    plan = models.ForeignKey(TestPlan, on_delete=models.CASCADE, related_name="objective_entries")
    title = models.CharField(max_length=50)
    description = models.TextField(blank=True)
    goal = models.TextField(blank=True)

    class Meta:
        ordering = ["plan", "title", "id"]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.title}"


class TestPlanScope(TimeStampedModel):
    """Categorized scope entries linked to a test plan."""

    class ScopeCategory(models.TextChoices):
        IN_SCOPE = "in_scope", "In Scope"
        OUT_SCOPE = "out_scope", "Out of Scope"

    plan = models.ForeignKey(TestPlan, on_delete=models.CASCADE, related_name="scopes")
    category = models.CharField(max_length=20, choices=ScopeCategory.choices)
    item = models.CharField(max_length=255)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["plan", "category", "order", "id"]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.get_category_display()}: {self.item}"


class TestPlanMaintenance(TimeStampedModel):
    """Tracks revisions made to a test plan across the STLC lifecycle."""

    plan = models.ForeignKey(TestPlan, on_delete=models.CASCADE, related_name="maintenances")
    version = models.CharField(max_length=50)
    summary = models.TextField()
    updates = models.JSONField(default=dict, blank=True)
    effective_date = models.DateField(null=True, blank=True)
    updated_by = models.CharField(max_length=255, blank=True)
    approved_by = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-effective_date", "-created_at", "id"]
        unique_together = ("plan", "version")

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.plan.name} v{self.version}"


class Risk(TimeStampedModel):
    """Catalog of identified project risks."""

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)

    class Meta:
        ordering = ["title", "id"]

    def __str__(self) -> str:  # pragma: no cover
        return self.title


class MitigationPlan(TimeStampedModel):
    """Mitigation strategies that can address project risks."""

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)

    class Meta:
        ordering = ["title", "id"]

    def __str__(self) -> str:  # pragma: no cover
        return self.title


class RiskAndMitigationPlan(TimeStampedModel):
    """Links risks to mitigation plans with contextual impact notes."""

    risk = models.ForeignKey(Risk, on_delete=models.CASCADE, related_name="mitigation_links")
    mitigation_plan = models.ForeignKey(
        MitigationPlan,
        on_delete=models.CASCADE,
        related_name="risk_links",
    )
    impact = models.TextField(blank=True)

    class Meta:
        ordering = ["risk", "mitigation_plan", "id"]
        unique_together = ("risk", "mitigation_plan")

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.risk} → {self.mitigation_plan}"


class TestStrategy(TimeStampedModel):
    """Test strategies that can address project risks."""

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)

    class Meta:
        ordering = ["title", "id"]

    def __str__(self) -> str:  # pragma: no cover
        return self.title
    
class VersionHistory(TimeStampedModel):
    """Version history for test strategies."""

    version = models.CharField(max_length=50)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="version_histories_authored",
    )
    description_of_change = models.TextField(blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="version_histories_approved",
    )

    class Meta:
        ordering = ["version", "id"]

    def __str__(self) -> str:  # pragma: no cover
        return self.version


class TestDataAndAccounts(TimeStampedModel):
    """Test Data and Accounts for test strategies."""

    class AccountType(models.TextChoices):
        IN_SCOPE = "in_scope", "In Scope"
        OUT_SCOPE = "out_scope", "Out of Scope"

    account_type = models.CharField(max_length=20, choices=AccountType.choices)
    description = models.TextField(blank=True)
    purpose = models.TextField(blank=True)

    class Meta:
        ordering = ["account_type", "id"]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.get_account_type_display()}"


class TeamMember(TimeStampedModel):
    """Team members involved in test strategies."""

    class Role(models.TextChoices):
        DEVELOPER = "developer", "Developer"
        TESTER = "tester", "Tester"
        MANAGER = "manager", "Manager"

    name = models.CharField(max_length=255)
    role = models.CharField(max_length=20, choices=Role.choices)

    class Meta:
        ordering = ["role", "id"]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.get_role_display()}"


class TestModules(TimeStampedModel):
    """Test Module for test strategies."""
    title = models.CharField(max_length=150)
    description = models.TextField(blank=True)

    class Meta:
        ordering = ["title", "id"]

    def __str__(self) -> str:  # pragma: no cover
        return self.title
    

class TestScenario(TimeStampedModel):
    """Concrete scenario derived from the test plan, grouping related test cases."""

    plan = models.ForeignKey(TestPlan, on_delete=models.CASCADE, related_name="scenarios")
    title = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    preconditions = models.TextField(blank=True)
    postconditions = models.TextField(blank=True)
    tags = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["plan", "title", "id"]
        unique_together = ("plan", "title")

    def __str__(self) -> str:  # pragma: no cover
        return self.title
    

class TestCase(TimeStampedModel):
    """Executable test case with dynamic variables for API validation."""

    scenario = models.ForeignKey(TestScenario, on_delete=models.CASCADE, related_name="cases")
    testcase_id = models.CharField(max_length=50)
    description = models.TextField(blank=True)
    precondition = models.TextField(blank=True)
    requirements = models.TextField(blank=True)
    expected_results = models.JSONField(default=list, blank=True)
    related_api_request = models.ForeignKey(ApiRequest, on_delete=models.SET_NULL, null=True, blank=True, related_name="test_cases")

    class Meta:
        ordering = ["scenario", "testcase_id", "id"]
        unique_together = ("scenario", "testcase_id")

    def __str__(self) -> str:  # pragma: no cover
        return self.testcase_id
