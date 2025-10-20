"""Query helpers for API automation models."""

from __future__ import annotations

from django.db.models import Prefetch, QuerySet

from . import models


def api_environment_list() -> QuerySet[models.ApiEnvironment]:
    return models.ApiEnvironment.objects.all()


def api_collection_base_queryset() -> QuerySet[models.ApiCollection]:
    request_qs = (
        models.ApiRequest.objects.select_related("directory")
        .order_by("order", "id")
        .prefetch_related("assertions")
    )
    directory_qs = models.ApiCollectionDirectory.objects.select_related("parent").order_by("parent_id", "order", "id")
    return models.ApiCollection.objects.prefetch_related(
        "environments",
        Prefetch("requests", queryset=request_qs),
        Prefetch("directories", queryset=directory_qs),
    )


def api_collection_list() -> QuerySet[models.ApiCollection]:
    return api_collection_base_queryset().order_by("name", "id")


def api_collection_get(pk: int) -> models.ApiCollection | None:
    return api_collection_base_queryset().filter(pk=pk).first()


def api_run_list() -> QuerySet[models.ApiRun]:
    result_qs = models.ApiRunResult.objects.order_by("order", "id")
    return models.ApiRun.objects.select_related("collection", "environment", "triggered_by").prefetch_related(
        Prefetch("results", queryset=result_qs)
    )


def api_run_get(pk: int) -> models.ApiRun | None:
    return api_run_list().filter(pk=pk).first()


def test_plan_list() -> QuerySet[models.TestPlan]:
    scenario_qs = models.TestScenario.objects.prefetch_related(
            Prefetch("cases", queryset=models.TestCase.objects.order_by("testcase_id", "id"))
    ).order_by("title", "id")
    maintenance_qs = models.TestPlanMaintenance.objects.order_by("-effective_date", "-created_at", "id")
    scope_qs = models.TestPlanScope.objects.order_by("category", "order", "id")
    # RiskAndMitigationPlan now references TestPlan via FK named `plan` and the
    # related_name on TestPlan is `risk_mitigation_links`.
    risk_mitigation_qs = models.RiskAndMitigationPlan.objects.select_related("risk", "mitigation_plan").order_by(
        "risk__title",
        "mitigation_plan__title",
        "id",
    )
    return (
        models.TestPlan.objects.order_by("name", "id")
        .prefetch_related(
            Prefetch("scenarios", queryset=scenario_qs),
            Prefetch("maintenances", queryset=maintenance_qs),
            Prefetch("scopes", queryset=scope_qs),
            Prefetch("risk_mitigation_links", queryset=risk_mitigation_qs),
        )
    )


def test_plan_get(pk: int) -> models.TestPlan | None:
    return test_plan_list().filter(pk=pk).first()


def test_scenario_list() -> QuerySet[models.TestScenario]:
    return models.TestScenario.objects.select_related("plan").prefetch_related("cases").order_by("plan", "title", "id")


def test_case_list() -> QuerySet[models.TestCase]:
    return models.TestCase.objects.select_related("scenario", "scenario__plan", "related_api_request").order_by("scenario", "testcase_id", "id")


def test_plan_maintenance_list() -> QuerySet[models.TestPlanMaintenance]:
    return models.TestPlanMaintenance.objects.select_related("plan").order_by("-effective_date", "-created_at", "id")


def risk_list() -> QuerySet[models.Risk]:
    return models.Risk.objects.order_by("title", "id")


def mitigation_plan_list() -> QuerySet[models.MitigationPlan]:
    return models.MitigationPlan.objects.order_by("title", "id")


def risk_and_mitigation_list(plan_id: int | None = None) -> QuerySet[models.RiskAndMitigationPlan]:
    """Return RiskAndMitigationPlan queryset, optionally filtered by plan id.

    Args:
        plan_id: If provided, filter mappings belonging to the given TestPlan id.
    """
    qs = models.RiskAndMitigationPlan.objects.select_related("risk", "mitigation_plan").order_by(
        "risk__title",
        "mitigation_plan__title",
        "id",
    )
    if plan_id is not None:
        try:
            qs = qs.filter(plan_id=int(plan_id))
        except (TypeError, ValueError):
            # If plan_id is invalid, return an empty queryset instead of raising
            return qs.none()
    return qs
