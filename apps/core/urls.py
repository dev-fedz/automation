from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

app_name = "core"

router = DefaultRouter()
router.register(r"collections", views.ApiCollectionViewSet, basename="core-collections")
router.register(r"environments", views.ApiEnvironmentViewSet, basename="core-environments")
router.register(r"runs", views.ApiRunViewSet, basename="core-runs")
router.register(r"requests", views.ApiRequestViewSet, basename="core-requests")
router.register(r"directories", views.ApiCollectionDirectoryViewSet, basename="core-directories")
router.register(r"test-plans", views.TestPlanViewSet, basename="core-test-plans")
router.register(r"test-plan-maintenances", views.TestPlanMaintenanceViewSet, basename="core-test-plan-maintenances")
router.register(r"test-plan-scopes", views.TestPlanScopeViewSet, basename="core-test-plan-scopes")
router.register(r"test-scenarios", views.TestScenarioViewSet, basename="core-test-scenarios")
router.register(r"test-cases", views.TestCaseViewSet, basename="core-test-cases")
router.register(r"risks", views.RiskViewSet, basename="core-risks")
router.register(r"mitigation-plans", views.MitigationPlanViewSet, basename="core-mitigation-plans")
router.register(r"risk-mitigations", views.RiskAndMitigationPlanViewSet, basename="core-risk-mitigation-plans")
router.register(r"test-tools", views.TestToolsViewSet, basename="core-test-tools")

urlpatterns = router.urls + [
	path("tester/execute/", views.ApiAdhocRequestView.as_view(), name="core-request-execute"),
]
