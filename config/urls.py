from django.apps import apps as django_apps
from django.conf import settings
from django.contrib import admin
from django.contrib.auth import logout as auth_logout
from django.contrib.auth.decorators import login_required
from django.contrib.staticfiles.urls import staticfiles_urlpatterns
from django.conf.urls.static import static
from django.http import JsonResponse, HttpResponseNotFound, HttpResponseServerError
from django.http import HttpResponseForbidden
from django.shortcuts import render, redirect
from django.urls import include, path
from django.views.decorators.http import require_GET
from django.views.generic import RedirectView
from rest_framework import routers

from apps.core import views as app_views

router = routers.DefaultRouter()

def healthz(_request):  # simple no-auth health endpoint
    return JsonResponse({'status': 'ok'})

@require_GET
def metrics_api(_request):
	# Static metrics; could be wired to DB/cache later
	return JsonResponse({
		'sales': 48000,
		'orders': 2300,
		'invoices': 6500,
		'alerts': 7200,
		'version': 1,
	})

def login_view(request):
	if request.user.is_authenticated:
		return redirect('dashboard')
	return render(request, 'base/login.html')


def _first_enabled_module_url_for_user(user):
	"""Return a URL for the first enabled module for the user, or None.

	"Enabled" is derived from the user's role-module assignments (not from sidebar markup).
	Order is determined by Module.order then id.
	"""
	# Avoid hard dependency if accounts app is removed.
	if not django_apps.is_installed('apps.accounts'):
		return None

	from apps.accounts.models import Module  # local import

	def url_for_module_code(code: str):
		# Only include modules that have a real page route.
		# Dashboard is handled separately (requires can_view_dashboard).
		if code in {'dashboard'}:
			return None
		if code in {'user_accounts', 'user_mgmt'}:
			return '/users/'
		if code in {'user_roles'}:
			return '/roles/'
		if code in {'api_tester'}:
			return '/automation/api-tester/'
		if code in {'projects_project'}:
			return '/automation/test-plans/'
		if code in {'projects_module'}:
			return '/data-management/test-modules/'
		if code in {'projects_scenario'}:
			return '/automation/test-scenarios/'
		if code in {'projects_testcase'}:
			return '/automation/test-cases/'
		if code in {'automation'}:
			return '/automation/'
		if code in {'api_environment'}:
			return '/data-management/environments/'
		return None

	qs = Module.objects.all()
	if not user.is_superuser:
		groups = user.groups.all()
		qs = qs.filter(rolemodule__role__in=groups).distinct()
	qs = qs.order_by('order', 'id')

	for m in qs:
		url = url_for_module_code(str(m.codename or '').strip())
		if url:
			return url
	return None

@login_required(login_url='/login/')
def dashboard_view(request):  # protected
	# If the user doesn't have dashboard access, don't render the dashboard content.
	# Redirect to the first enabled module instead.
	if not request.user.has_perm('accounts.can_view_dashboard'):
		target = _first_enabled_module_url_for_user(request.user)
		if target:
			return redirect(target)
		return HttpResponseForbidden('No enabled modules for this account.')
	return render(request, 'dashboard/index.html')

def logout_view(request):
	if request.method == 'POST' or request.GET.get('force') == '1':
		auth_logout(request)
		return redirect('login')
	# simple confirmation page (inline) to avoid new template
	return render(request, 'base/base.html', context={'logout_placeholder': True})

account_page_patterns = []
if django_apps.is_installed('apps.accounts'):
	from apps.accounts import views as account_pages  # noqa: WPS433 (import inside conditional)

	account_page_patterns = [
		path('roles/', account_pages.role_list_page, name='role-list-page'),
		path('roles/create/', account_pages.role_create_page, name='role-create-page'),
		path('roles/<int:pk>/', account_pages.role_detail_page, name='role-detail-page'),
		path('roles/<int:pk>/edit/', account_pages.role_edit_page, name='role-edit-page'),
		path('roles/<int:pk>/delete/', account_pages.role_delete_page, name='role-delete-page'),
		path('users/', account_pages.user_list_page, name='user-list-page'),
		path('users/create/', account_pages.user_create_page, name='user-create-page'),
		path('users/<int:pk>/', account_pages.user_detail_page, name='user-detail-page'),
		path('users/<int:pk>/edit/', account_pages.user_edit_page, name='user-edit-page'),
		path('users/<int:pk>/delete/', account_pages.user_delete_page, name='user-delete-page'),
	]


urlpatterns = [
	path('admin/', admin.site.urls),
	path('login/', login_view, name='login'),
	# Root path now serves the dashboard (default landing after auth)
	path('', dashboard_view, name='dashboard'),
	# Preserve old /dashboard/ URL as a redirect for existing links/bookmarks
	path('dashboard/', RedirectView.as_view(pattern_name='dashboard', permanent=False), name='dashboard_redirect'),
	path('logout/', logout_view, name='logout'),
	path('automation/', app_views.automation_overview, name='automation-overview'),
	path('automation/run/', app_views.automation_run, name='automation-run'),
	path('automation/reports/', app_views.automation_reports, name='automation-reports'),
	path('automation/reports/export/', app_views.automation_reports_export, name='automation-reports-export'),
	path('automation/reports/testcases/export/', app_views.automation_testcase_reports_export, name='automation-testcase-reports-export'),
	path('automation/test-plans/', app_views.automation_test_plans, name='automation-test-plans'),
	path('automation/test-scenarios/', app_views.automation_test_scenarios, name='automation-test-scenarios'),
	path('automation/test-cases/', app_views.automation_test_cases, name='automation-test-cases'),
	path('automation/test-plan-maintenance/', app_views.automation_test_plan_maintenance, name='automation-test-plan-maintenance'),
	path('automation/data-management/', RedirectView.as_view(pattern_name='data-management', permanent=False)),
	path('data-management/', app_views.automation_data_management, name='data-management'),
	path('data-management/risks/', app_views.automation_data_management_risk_registry, {"section": "risks"}, name='data-management-risks'),
	path('data-management/mitigation-plans/', app_views.automation_data_management_mitigation_plan, {"section": "mitigation"}, name='data-management-mitigation'),
	path('data-management/environments/', app_views.automation_data_management_api_environment, {"section": "environments"}, name='data-management-environments'),
	path('data-management/test-tools/', app_views.automation_data_management_test_tools, {"section": "test-tools"}, name='data-management-test-tools'),
	path('data-management/test-modules/', app_views.automation_data_management_test_modules, {"section": "test-modules"}, name='data-management-test-modules'),
	path('data-management/risk-matrix/', app_views.automation_data_management, {"section": "matrix"}, name='data-management-matrix'),
	path('automation/api-tester/', app_views.api_tester_page, name='api-tester'),
	path('healthz/', healthz, name='healthz'),
	path('healthz', healthz),  # fallback no slash
	path('api/metrics/', metrics_api, name='metrics'),
	path('api/core/', include(('apps.core.urls', 'core'), namespace='core')),
	path('tinymce/', include('tinymce.urls')),
] + account_page_patterns

if django_apps.is_installed('apps.accounts'):
	urlpatterns.append(path('api/accounts/', include('apps.accounts.urls')))

def handler404(request, exception):  # noqa: ARG001
    return render(request, 'errors/404.html', status=404)

def handler500(request):  # noqa: D401
    return render(request, 'errors/500.html', status=500)

if settings.DEBUG:
	urlpatterns += staticfiles_urlpatterns()
	urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
