"""API views for automation testing akin to Postman collections."""

from __future__ import annotations

from typing import Any

from django.http import Http404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import models, selectors, serializers, services


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
