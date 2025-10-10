from django.apps import apps as django_apps
from django.conf import settings
from django.contrib import admin
from django.contrib.auth import logout as auth_logout
from django.contrib.auth.decorators import login_required
from django.contrib.staticfiles.urls import staticfiles_urlpatterns
from django.http import JsonResponse, HttpResponseNotFound, HttpResponseServerError
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

@login_required(login_url='/login/')
def dashboard_view(request):  # protected
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
	path('automation/api-tester/', app_views.api_tester_page, name='api-tester'),
	path('healthz/', healthz, name='healthz'),
	path('healthz', healthz),  # fallback no slash
	path('api/metrics/', metrics_api, name='metrics'),
	path('api/core/', include('apps.core.urls')),
] + account_page_patterns

if django_apps.is_installed('apps.accounts'):
	urlpatterns.append(path('api/accounts/', include('apps.accounts.urls')))

def handler404(request, exception):  # noqa: ARG001
    return render(request, 'errors/404.html', status=404)

def handler500(request):  # noqa: D401
    return render(request, 'errors/500.html', status=500)

if settings.DEBUG:
	urlpatterns += staticfiles_urlpatterns()
