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
