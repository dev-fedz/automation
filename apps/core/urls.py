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
router.register(r"test-plans", views.ProjectViewSet, basename="core-test-plans")
router.register(r"test-scenarios", views.TestScenarioViewSet, basename="core-test-scenarios")
router.register(r"test-cases", views.TestCaseViewSet, basename="core-test-cases")
router.register(r"test-modules", views.TestModulesViewSet, basename="core-test-modules")

urlpatterns = router.urls

urlpatterns += [
	path("tester/execute/", views.ApiAdhocRequestView.as_view(), name="core-request-execute"),
	path("automation-report/finalize/", views.AutomationReportFinalizeView.as_view(), name="core-automation-report-finalize"),
	path("automation-report/create/", views.AutomationReportCreateView.as_view(), name="core-automation-report-create"),
	path("automation-report/<int:pk>/", views.AutomationReportDetailView.as_view(), name="core-automation-report-detail"),
	path("automation-report/<int:pk>/testcase/<str:testcase_id>/", views.AutomationReportTestcaseDetailView.as_view(), name="core-automation-report-testcase-detail"),
]
