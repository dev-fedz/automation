from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

app_name = "core"

router = DefaultRouter()
router.register(r"collections", views.ApiCollectionViewSet, basename="core-collections")
router.register(r"environments", views.ApiEnvironmentViewSet, basename="core-environments")
router.register(r"runs", views.ApiRunViewSet, basename="core-runs")

urlpatterns = router.urls + [
	path("tester/execute/", views.ApiAdhocRequestView.as_view(), name="core-request-execute"),
]
