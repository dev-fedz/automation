from django.contrib.auth import login
from django.contrib.auth.models import Group
from django.shortcuts import render, redirect, get_object_or_404
from django.views.decorators.http import require_http_methods
from django.contrib import messages
from django_filters.rest_framework import DjangoFilterBackend
from knox.views import LoginView as KnoxLoginView, LogoutView as KnoxLogoutView
from rest_framework import exceptions, status
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.generics import ListAPIView
from rest_framework.permissions import BasePermission
from rest_framework.permissions import AllowAny, IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from rest_framework.serializers import Serializer as EmptySerializer
from rest_framework.views import APIView

from django.http import HttpResponseForbidden


class HasAccountsPermission(BasePermission):
    """Permission checks based on our custom 'accounts.can_*' permissions.

    We avoid IsAdminUser (is_staff) so non-superusers can access screens
    when their role grants the appropriate permissions.
    """

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser:
            return True

        required_perm = getattr(view, 'required_permission', None)
        if callable(required_perm):
            required_perm = required_perm(request)
        if not required_perm:
            return True
        return user.has_perm(required_perm)

from . import models, selectors, serializers, services


class LoginApi(KnoxLoginView):
    permission_classes = (AllowAny,)
    serializer_class = serializers.LoginSerializer

    def post(self, request, format=None):
        serializer = self.serializer_class(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data['user']
        login(request, user)
        # reset attempts & unlock on successful auth
        update_fields = []
        if user.login_attempt != 0:
            user.login_attempt = 0
            update_fields.append('login_attempt')
        if user.status != 'U':
            user.status = 'U'
            update_fields.append('status')
        if update_fields:
            user.save(update_fields=update_fields)
        try:
            services.log_user_action(user=user, action=models.UserAuditTrail.Actions.LOGIN)
        except Exception:
            pass
        return super().post(request, format=None)

    def get_post_response_data(self, request, token, instance):  # add user info
        data = super().get_post_response_data(request, token, instance)
        data['user'] = serializers.UserDetailsSerializer(request.user).data
        return data


class LogoutApi(KnoxLogoutView):
    def post(self, request, format=None):
        user = getattr(request, 'user', None)
        response = super().post(request, format=None)
        try:
            services.log_user_action(user=user, action=models.UserAuditTrail.Actions.LOGOUT)
        except Exception:
            pass
        return response


class ValidatePasswordAPI(APIView):
    permission_classes = (IsAuthenticated,)
    serializer_class = serializers.ValidatePasswordSerializer

    def post(self, request):
        s = self.serializer_class(data=request.data, context={'request': request})
        s.is_valid(raise_exception=True)
        services.password_validate(user=request.user, password=s.validated_data.get('current_password'))
        return Response(status=status.HTTP_200_OK)


class ChangePasswordAPI(APIView):
    permission_classes = (IsAuthenticated,)
    serializer_class = serializers.ChangePasswordSerializer

    def post(self, request):
        s = self.serializer_class(data=request.data, context={'request': request})
        s.is_valid(raise_exception=True)
        services.password_change(user=request.user, data=s.validated_data)
        return Response(status=status.HTTP_200_OK)


class ForgotPasswordAPI(APIView):
    permission_classes = (AllowAny,)
    serializer_class = serializers.ForgetPasswordSerializer

    def post(self, request):
        s = self.serializer_class(data=request.data, context={'request': request})
        s.is_valid(raise_exception=True)
        user = models.User.objects.filter(email=request.data['email']).first()
        if not user:
            raise exceptions.NotFound('User not found')
        services.forget_password(user=user, data=s.validated_data)
        return Response(status=status.HTTP_200_OK)


class TemporaryPasswordAPI(APIView):
    permission_classes = (IsAuthenticated,)
    serializer_class = serializers.TemporaryPasswordSerializer

    def post(self, request):
        s = self.serializer_class(data=request.data, context={'request': request})
        s.is_valid(raise_exception=True)
        user = models.User.objects.filter(email=request.data['email']).first()
        if not user:
            raise exceptions.NotFound('User not found')
        services.temporary_password(user=user)
        return Response(status=status.HTTP_200_OK)


class OtpAPI(APIView):
    permission_classes = (AllowAny,)
    serializer_class = serializers.TemporaryPasswordSerializer

    def post(self, request):
        s = self.serializer_class(data=request.data, context={'request': request})
        s.is_valid(raise_exception=True)
        user = models.User.objects.filter(email=request.data['email']).first()
        if not user:
            raise exceptions.NotFound('User not found')
        services.otp(user=user)
        return Response(status=status.HTTP_200_OK)


class UserListAPI(ListAPIView):
    serializer_class = serializers.UserListSerializer
    permission_classes = (IsAuthenticated, HasAccountsPermission)
    required_permission = 'accounts.can_view_user'
    filter_backends = [SearchFilter, OrderingFilter, DjangoFilterBackend]
    filterset_fields = {'groups__id': ['exact']}
    search_fields = ['username', 'email', 'first_name', 'last_name']
    ordering_fields = ['first_name']
    ordering = 'first_name'
    queryset = selectors.active_staff_get()


class UserDetailAPI(APIView):
    serializer_class = serializers.UserRetrieveSerializer
    permission_classes = (IsAuthenticated, HasAccountsPermission)
    required_permission = 'accounts.can_view_user'

    def get(self, request, pk):
        obj = selectors.active_staff_get().filter(pk=pk).first()
        if not obj:
            raise exceptions.NotFound()
        return Response(self.serializer_class(obj).data)


class UserCreateAPI(APIView):
    serializer_class = serializers.UserCreateSerializer
    permission_classes = (IsAuthenticated, HasAccountsPermission)
    required_permission = 'accounts.can_add_user'

    def post(self, request):
        s = self.serializer_class(data=request.data)
        s.is_valid(raise_exception=True)
        user = services.user_create(data=s.validated_data, creator=request.user)
        try:
            services.log_user_action(user=request.user, action=models.UserAuditTrail.Actions.CREATE_USER_ACCOUNT)
        except Exception:
            pass
        return Response(self.serializer_class(user).data, status=status.HTTP_201_CREATED)


class UserUpdateApi(APIView):
    serializer_class = serializers.UserUpdateSerializer
    permission_classes = (IsAuthenticated, HasAccountsPermission)
    required_permission = 'accounts.can_change_user'

    def get_obj(self, pk):
        obj = selectors.active_staff_get().filter(pk=pk).first()
        if not obj:
            raise exceptions.NotFound()
        return obj

    def put(self, request, pk):
        return self._update(request, pk, partial=False)

    def patch(self, request, pk):
        return self._update(request, pk, partial=True)

    def _update(self, request, pk, partial):
        obj = self.get_obj(pk)
        s = self.serializer_class(obj, data=request.data, partial=partial)
        s.is_valid(raise_exception=True)
        services.user_update(user=obj, data=s.validated_data)
        try:
            services.log_user_action(user=request.user, action=models.UserAuditTrail.Actions.UPDATE_USER_ACCOUNT)
        except Exception:
            pass
        return Response(self.serializer_class(obj).data)


class UserDeleteApi(APIView):
    serializer_class = EmptySerializer
    permission_classes = (IsAuthenticated, HasAccountsPermission)
    required_permission = 'accounts.can_delete_user'

    def delete(self, request, pk):
        obj = selectors.active_staff_get().filter(pk=pk).first()
        if not obj:
            raise exceptions.NotFound()
        obj.soft_delete()
        try:
            services.log_user_action(user=request.user, action=models.UserAuditTrail.Actions.DELETE_USER_ACCOUNT)
        except Exception:
            pass
        return Response(status=status.HTTP_200_OK)


class RoleListAPI(ListAPIView):
    serializer_class = serializers.RoleListSerializer
    permission_classes = (IsAuthenticated, HasAccountsPermission)
    required_permission = 'accounts.can_view_group'
    filter_backends = [SearchFilter, OrderingFilter]
    search_fields = ['name']
    ordering_fields = ['name']
    ordering = 'name'
    queryset = Group.objects.all()


class RoleDetailAPI(APIView):
    # Use detailed serializer including role_modules with permissions
    serializer_class = serializers.RoleDetailSerializer
    permission_classes = (IsAuthenticated, HasAccountsPermission)
    required_permission = 'accounts.can_view_group'
    queryset = Group.objects.all()

    def get(self, request, pk):
        obj = self.queryset.filter(pk=pk).first()
        if not obj:
            raise exceptions.NotFound()
        return Response(self.serializer_class(obj).data)


class RoleCreateAPI(APIView):
    serializer_class = serializers.RoleCreateSerializer
    permission_classes = (IsAuthenticated, HasAccountsPermission)
    required_permission = 'accounts.can_add_group'

    def post(self, request):
        s = self.serializer_class(data=request.data)
        s.is_valid(raise_exception=True)
        role = services.role_create(data=s.validated_data)
        try:
            services.log_user_action(user=request.user, action=models.UserAuditTrail.Actions.CREATE_ROLE)
        except Exception:
            pass
        return Response({'id': role.id, 'name': role.name}, status=status.HTTP_201_CREATED)


class RoleUpdateApi(APIView):
    serializer_class = serializers.RoleUpdateSerializer
    permission_classes = (IsAuthenticated, HasAccountsPermission)
    required_permission = 'accounts.can_change_group'
    queryset = Group.objects.all()

    def put(self, request, pk):
        return self._update(request, pk, partial=False)

    def patch(self, request, pk):
        return self._update(request, pk, partial=True)

    def _update(self, request, pk, partial):
        obj = self.queryset.filter(pk=pk).first()
        if not obj:
            raise exceptions.NotFound()
        s = self.serializer_class(obj, data=request.data, partial=partial)
        s.is_valid(raise_exception=True)
        services.role_update(role=obj, data=s.validated_data)
        try:
            services.log_user_action(user=request.user, action=models.UserAuditTrail.Actions.UPDATE_ROLE)
        except Exception:
            pass
        return Response({'id': obj.id, 'name': obj.name})


class RoleDeleteApi(APIView):
    serializer_class = EmptySerializer
    permission_classes = (IsAuthenticated, HasAccountsPermission)
    required_permission = 'accounts.can_delete_group'
    queryset = Group.objects.all()

    def delete(self, request, pk):
        obj = self.queryset.filter(pk=pk).first()
        if not obj:
            raise exceptions.NotFound()
        # Prevent delete if users are assigned
        user_count = models.User.objects.filter(groups=obj).count()
        if user_count > 0:
            return Response({'error': 'Cannot delete role assigned to users.'}, status=400)
        services.role_destroy(role=obj)
        try:
            services.log_user_action(user=request.user, action=models.UserAuditTrail.Actions.DELETE_ROLE)
        except Exception:
            pass
        return Response(status=status.HTTP_200_OK)


class ModuleListAPIView(ListAPIView):
    serializer_class = serializers.ModuleListSerializer
    permission_classes = (IsAuthenticated, HasAccountsPermission)
    # Modules are used to configure roles; treat as role-view permission.
    required_permission = 'accounts.can_view_group'

    def get_queryset(self):
        return selectors.module_list()

# ---------------- Web (HTML) Role CRUD ---------------- #

def _forbidden_or_login(request):
    if not request.user.is_authenticated:
        return redirect('login')
    return HttpResponseForbidden('Forbidden')


def _require_perm(user, perm_codename: str) -> bool:
    return user.is_authenticated and (user.is_superuser or user.has_perm(perm_codename))

def role_list_page(request):
    # if not _require_perm(request.user, 'accounts.can_view_group'):
    #     return _forbidden_or_login(request)
    roles = Group.objects.all().prefetch_related('modules')
    return render(request, 'roles/list.html', {'roles': roles})

def role_detail_page(request, pk):
    # if not _require_perm(request.user, 'accounts.can_view_group'):
    #     return _forbidden_or_login(request)
    role = get_object_or_404(Group, pk=pk)
    # reuse API serializer for modules/permissions structure
    ser = serializers.RoleListSerializer(role)
    return render(request, 'roles/detail.html', {'role': ser.data})

def _modules_permissions_context():
    from .models import Module
    modules = []
    for m in Module.objects.all().prefetch_related('permissions__permission').order_by('category','order','name'):
        perms = []
        for mp in m.permissions.all():
            perms.append({'permission': {'id': mp.permission.id if mp.permission else None, 'codename': mp.permission.codename if mp.permission else None}})
        modules.append({'id': m.id, 'name': m.name, 'category': m.get_category_display(), 'raw_category': m.category, 'permissions': perms})
    return modules

def role_create_page(request):
    if not _require_perm(request.user, 'accounts.can_add_group'):
        return _forbidden_or_login(request)
    if request.method == 'POST':
        name = request.POST.get('name','').strip()
        module_ids = request.POST.getlist('modules')
        role_modules_payload = []
        # build payload of {module: id, permissions: [perm ids]}
        for mid in module_ids:
            perm_key = f'perm_{mid}'
            perm_ids = request.POST.getlist(perm_key)
            perm_ids_clean = [int(pid) for pid in perm_ids if pid.isdigit()]
            role_modules_payload.append({'module': int(mid), 'permissions': perm_ids_clean})
        if name:
            from . import services
            try:
                services.role_create(data={'name': name, 'role_modules': role_modules_payload})
                try:
                    services.log_user_action(user=request.user, action=models.UserAuditTrail.Actions.CREATE_ROLE)
                except Exception:
                    pass
                messages.success(request, 'Role created successfully.')
                return redirect('/roles/')
            except Exception as e:
                messages.error(request, f'Failed to create role: {e}')
        else:
            messages.error(request, 'Role name is required.')
    modules = _modules_permissions_context()
    return render(request, 'roles/form.html', {
        'form_title': 'Create', 'role': {}, 'modules': modules,
        'selected_module_ids': [], 'selected_permission_ids': []})

def role_edit_page(request, pk):
    if not _require_perm(request.user, 'accounts.can_change_group'):
        return _forbidden_or_login(request)
    role = get_object_or_404(Group, pk=pk)
    if request.method == 'POST':
        name = request.POST.get('name','').strip()
        module_ids = request.POST.getlist('modules')
        role_modules_payload = []
        for mid in module_ids:
            perm_ids = request.POST.getlist(f'perm_{mid}')
            role_modules_payload.append({'module': int(mid), 'permissions': [int(pid) for pid in perm_ids if pid.isdigit()]})
        if name:
            from . import services
            try:
                services.role_update(role=role, data={'name': name, 'role_modules': role_modules_payload})
                try:
                    services.log_user_action(user=request.user, action=models.UserAuditTrail.Actions.UPDATE_ROLE)
                except Exception:
                    pass
                messages.success(request, 'Role updated successfully.')
                return redirect('/roles/')
            except Exception as e:
                messages.error(request, f'Failed to update role: {e}')
        else:
            messages.error(request, 'Role name is required.')
    modules = _modules_permissions_context()
    # determine selected modules & permissions
    selected_module_ids = list(role.modules.values_list('id', flat=True))
    selected_permission_ids = list(role.permissions.values_list('id', flat=True))
    return render(request, 'roles/form.html', {
        'form_title': 'Edit', 'role': role, 'modules': modules,
        'selected_module_ids': selected_module_ids, 'selected_permission_ids': selected_permission_ids})

def role_delete_page(request, pk):
    if not _require_perm(request.user, 'accounts.can_delete_group'):
        return _forbidden_or_login(request)
    role = get_object_or_404(Group, pk=pk)
    if request.method == 'POST':
        user_count = models.User.objects.filter(groups=role).count()
        if user_count > 0:
            messages.error(request, 'Cannot delete role assigned to users.')
        else:
            services.role_destroy(role=role)
            try:
                services.log_user_action(user=request.user, action=models.UserAuditTrail.Actions.DELETE_ROLE)
            except Exception:
                pass
            messages.success(request, 'Role deleted.')
            return redirect('/roles/')
    return render(request, 'roles/delete_confirm.html', {'role': role})

# ---------------- Web (HTML) User CRUD ---------------- #

def user_list_page(request):
    if not _require_perm(request.user, 'accounts.can_view_user'):
        return _forbidden_or_login(request)
    users = models.User.active_objects.select_related().prefetch_related('groups')
    return render(request, 'users/list.html', {'users': users})


def user_create_page(request):
    if not _require_perm(request.user, 'accounts.can_add_user'):
        return _forbidden_or_login(request)
    roles = Group.objects.all().order_by('name')
    if request.method == 'POST':
        data = {
            'first_name': request.POST.get('first_name','').strip(),
            'last_name': request.POST.get('last_name','').strip(),
            'username': request.POST.get('username','').strip(),
            'email': request.POST.get('email','').strip(),
            'mobile_no': request.POST.get('mobile_no','').strip(),
            'employee_no': request.POST.get('employee_no','').strip(),
            'role': request.POST.get('role') or None,
        }
        missing = [k for k in ['first_name','last_name','username','email','role'] if not data.get(k)]
        if missing:
            messages.error(request, 'Missing required fields: ' + ', '.join(missing))
        else:
            try:
                role_id = int(data.pop('role'))
                data['role'] = Group.objects.get(pk=role_id)
                user = services.user_create(data=data, creator=request.user)
                try:
                    services.log_user_action(user=request.user, action=models.UserAuditTrail.Actions.CREATE_USER_ACCOUNT)
                except Exception:
                    pass
                messages.success(request, 'User created successfully.')
                return redirect('/users/')
            except Exception as e:  # broad to surface any validation error quickly
                messages.error(request, f'Failed to create user: {e}')
    return render(request, 'users/form.html', {'form_title': 'Create', 'roles': roles, 'user_obj': {}, 'mode': 'create'})


def user_edit_page(request, pk):
    if not _require_perm(request.user, 'accounts.can_change_user'):
        return _forbidden_or_login(request)
    user = get_object_or_404(models.User, pk=pk)
    roles = Group.objects.all().order_by('name')
    if request.method == 'POST':
        data = {
            'first_name': request.POST.get('first_name','').strip(),
            'last_name': request.POST.get('last_name','').strip(),
            'username': request.POST.get('username','').strip(),
            'email': request.POST.get('email','').strip(),
            'mobile_no': request.POST.get('mobile_no','').strip(),
            'employee_no': request.POST.get('employee_no','').strip(),
            'role': request.POST.get('role') or None,
            'status': request.POST.get('status') or user.status,
        }
        missing = [k for k in ['first_name','last_name','username','email','role'] if not data.get(k)]
        if missing:
            messages.error(request, 'Missing required fields: ' + ', '.join(missing))
        else:
            try:
                role_id = int(data.pop('role'))
                data['role'] = Group.objects.get(pk=role_id)
                services.user_update(user=user, data=data)
                try:
                    services.log_user_action(user=request.user, action=models.UserAuditTrail.Actions.UPDATE_USER_ACCOUNT)
                except Exception:
                    pass
                messages.success(request, 'User updated successfully.')
                return redirect('/users/')
            except Exception as e:
                messages.error(request, f'Failed to update user: {e}')
    user_groups = list(user.groups.values_list('id', flat=True))
    return render(request, 'users/form.html', {'form_title': 'Edit', 'roles': roles, 'user_obj': user, 'user_groups': user_groups, 'mode': 'edit'})


def user_delete_page(request, pk):
    if not _require_perm(request.user, 'accounts.can_delete_user'):
        return _forbidden_or_login(request)
    user = get_object_or_404(models.User, pk=pk)
    if request.method == 'POST':
        user.soft_delete()
        try:
            services.log_user_action(user=request.user, action=models.UserAuditTrail.Actions.DELETE_USER_ACCOUNT)
        except Exception:
            pass
        messages.success(request, 'User deleted.')
        return redirect('/users/')
    return render(request, 'users/delete_confirm.html', {'user_obj': user})


def user_detail_page(request, pk):
    if not _require_perm(request.user, 'accounts.can_view_user'):
        return _forbidden_or_login(request)
    user = get_object_or_404(models.User, pk=pk)
    role = user.groups.first()
    return render(request, 'users/detail.html', {'user_obj': user, 'role_obj': role})
