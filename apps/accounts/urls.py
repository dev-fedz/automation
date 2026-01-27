from django.urls import include, path

from . import views

app_name = 'accounts'

auth_patterns = [
    path('login/', views.LoginApi.as_view(), name='login'),
    path('2fa/setup/', views.TwoFactorSetupAPI.as_view(), name='2fa-setup'),
    path('2fa/confirm/', views.TwoFactorConfirmAPI.as_view(), name='2fa-confirm'),
    path('2fa/setup/verify/', views.TwoFactorSetupVerifyAPI.as_view(), name='2fa-setup-verify'),
    path('2fa/verify/', views.TwoFactorVerifyAPI.as_view(), name='2fa-verify'),
    path('logout/', views.LogoutApi.as_view(), name='logout'),
    path('validate-password/', views.ValidatePasswordAPI.as_view(), name='validate-password'),
    path('change-password/', views.ChangePasswordAPI.as_view(), name='change-password'),
    path('forget-password/', views.ForgotPasswordAPI.as_view(), name='forget-password'),
    path('temporary-password/', views.TemporaryPasswordAPI.as_view(), name='temporary-password'),
    path('otp/', views.OtpAPI.as_view(), name='otp'),
]

user_admin = [
    path('', views.UserListAPI.as_view(), name='list'),
    path('create/', views.UserCreateAPI.as_view(), name='create'),
    path('<pk>/', views.UserDetailAPI.as_view(), name='detail'),
    path('<pk>/update/', views.UserUpdateApi.as_view(), name='update'),
    path('<pk>/delete/', views.UserDeleteApi.as_view(), name='delete'),
]

role_admin = [
    path('', views.RoleListAPI.as_view(), name='list'),
    path('create/', views.RoleCreateAPI.as_view(), name='create'),
    path('<pk>/', views.RoleDetailAPI.as_view(), name='detail'),
    path('<pk>/update/', views.RoleUpdateApi.as_view(), name='update'),
    path('<pk>/delete/', views.RoleDeleteApi.as_view(), name='delete'),
]

urlpatterns = [
    path('auth/', include((auth_patterns, 'auth'))),
    path('users/', include((user_admin, 'users'))),
    path('roles/', include((role_admin, 'roles'))),
    path('modules/', views.ModuleListAPIView.as_view(), name='modules-list'),
]
