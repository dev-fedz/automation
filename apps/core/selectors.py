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


def project_list(*, automated_scenarios_only: bool = False) -> QuerySet[models.Project]:
    cases_qs = models.TestCase.objects.order_by("testcase_id", "id")

    scenario_qs = models.TestScenario.objects.select_related("module")
    if automated_scenarios_only:
        scenario_qs = scenario_qs.filter(is_automated=True)
    scenario_qs = scenario_qs.prefetch_related(Prefetch("cases", queryset=cases_qs)).order_by("title", "id")
    modules_qs = models.TestModules.objects.order_by("title", "id")
    return (
        models.Project.objects.order_by("name", "id")
        .prefetch_related(
            Prefetch("scenarios", queryset=scenario_qs),
            Prefetch("test_modules", queryset=modules_qs),
        )
    )


def project_get(pk: int) -> models.Project | None:
    return project_list().filter(pk=pk).first()


def test_scenario_list() -> QuerySet[models.TestScenario]:
    return (
        models.TestScenario.objects.select_related("project")
        .prefetch_related("cases")
        .order_by("project", "title", "id")
    )


def test_case_list() -> QuerySet[models.TestCase]:
    return (
        models.TestCase.objects
        .select_related("scenario", "scenario__project", "test_case_dependency", "related_api_request")
        .order_by("scenario", "testcase_id", "id")
    )
