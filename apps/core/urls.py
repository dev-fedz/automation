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
router.register(r"scenario-comments", views.ScenarioCommentViewSet, basename="core-scenario-comments")
router.register(r"test-case-comments", views.TestCaseCommentViewSet, basename="core-test-case-comments")
router.register(r"test-cases", views.TestCaseViewSet, basename="core-test-cases")
router.register(r"test-modules", views.TestModulesViewSet, basename="core-test-modules")
router.register(r"ui-testing-records", views.UITestingRecordViewSet, basename="core-ui-testing-records")

urlpatterns = router.urls

urlpatterns += [
	path("tester/execute/", views.ApiAdhocRequestView.as_view(), name="core-request-execute"),
	path("automation-report/finalize/", views.AutomationReportFinalizeView.as_view(), name="core-automation-report-finalize"),
	path("automation-report/create/", views.AutomationReportCreateView.as_view(), name="core-automation-report-create"),
	path("automation-report/<int:pk>/testcase/<str:testcase_id>/", views.AutomationReportTestcaseDetailView.as_view(), name="core-automation-report-testcase-detail"),
	path("load-tests/", views.LoadTestRunsApiView.as_view(), name="core-load-tests"),
	path("load-tests/<int:pk>/", views.LoadTestRunDetailApiView.as_view(), name="core-load-test-detail"),
	path("load-tests/<int:pk>/stop/", views.LoadTestRunStopApiView.as_view(), name="core-load-test-stop"),
]
