from django.contrib.auth import authenticate
from django.contrib.auth.hashers import check_password
from django.contrib.auth.models import Group, Permission
from rest_framework import serializers
from rest_framework.authtoken.serializers import AuthTokenSerializer

from . import models, selectors, services


class LoginSerializer(AuthTokenSerializer):
    username = None
    email = serializers.EmailField(required=False, allow_blank=True)

    def validate(self, data):
        email = data.get('email')
        password = data.get('password')

        if not (email and password):
            raise serializers.ValidationError('Must include "email" and "password".')

        user = models.User.objects.filter(email=email).first()
        if not user:
            services.login_attempts(email)
            raise serializers.ValidationError('Unable to log in with provided credentials.')

        # rate limiting (redis-backed if available)
        if not services.rate_limit_check(email):
            raise serializers.ValidationError('Too many attempts. Please wait and try again.')

        if user.login_attempt >= 3:
            raise serializers.ValidationError('You have made 3 incorrect login attempts.')

        if user.status == 'L':
            raise serializers.ValidationError('Account Locked. Please Contact the administrator')

        if not check_password(password, user.password):
            services.login_attempts(email)
            # refresh user for latest attempts / lock state
            user = models.User.objects.filter(email=email).first()
            if user and user.login_attempt >= 3:
                raise serializers.ValidationError('You have made 3 incorrect login attempts.')
            raise serializers.ValidationError('Unable to log in with provided credentials.')

        data['user'] = user
        return data


class ValidatePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    password1 = serializers.CharField(write_only=True)
    password2 = serializers.CharField(write_only=True)


class ForgetPasswordSerializer(serializers.Serializer):
    email = serializers.CharField(write_only=True)
    otp = serializers.CharField(allow_blank=True, required=False)
    password1 = serializers.CharField(write_only=True)
    password2 = serializers.CharField(write_only=True)


class TemporaryPasswordSerializer(serializers.Serializer):
    email = serializers.CharField(write_only=True)


class TwoFactorVerifySerializer(serializers.Serializer):
    token = serializers.CharField(write_only=True)
    otp = serializers.CharField(write_only=True)


class TwoFactorConfirmSerializer(serializers.Serializer):
    otp = serializers.CharField(write_only=True)


class TwoFactorSetupVerifySerializer(serializers.Serializer):
    token = serializers.CharField(write_only=True)
    otp = serializers.CharField(write_only=True)


class UserDetailsSerializer(serializers.ModelSerializer):
    class RoleModuleObjectSerializer(serializers.Serializer):
        name = serializers.CharField()
        description = serializers.CharField()
        codename = serializers.CharField()
        permissions = serializers.JSONField()

    role = serializers.SerializerMethodField()
    modules = serializers.SerializerMethodField()

    class Meta:
        model = models.User
        fields = (
            'id', 'username', 'email', 'first_name', 'last_name', 'is_temporary', 'status', 'login_attempt', 'role', 'modules'
        )

    def get_modules(self, obj):
        return selectors.user_role_modules_data_get(user=obj)

    def get_role(self, obj):
        role = obj.groups.first()
        if role:
            return {'id': role.id, 'name': role.name}
        return None


class UserListSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()

    class Meta:
        model = models.User
    fields = ('id', 'first_name', 'last_name', 'username', 'email', 'mobile_no', 'status', 'role', 'employee_no')

    def get_role(self, obj):
        role = obj.groups.first()
        if role:
            return {'id': role.id, 'name': role.name}
        return None


class UserRetrieveSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()

    class Meta:
        model = models.User
    fields = ('id', 'username', 'first_name', 'last_name', 'email', 'mobile_no', 'role', 'employee_no')

    def get_role(self, obj):
        role = obj.groups.first()
        if role:
            return {'id': role.id, 'name': role.name}
        return None


class UserCreateSerializer(serializers.ModelSerializer):
    role = serializers.PrimaryKeyRelatedField(queryset=Group.objects.all(), write_only=True)

    class Meta:
        model = models.User
    fields = ('id', 'first_name', 'last_name', 'username', 'mobile_no', 'email', 'role', 'employee_no')


class UserUpdateSerializer(serializers.ModelSerializer):
    role = serializers.PrimaryKeyRelatedField(queryset=Group.objects.all(), write_only=True)

    class Meta:
        model = models.User
    fields = ('first_name', 'last_name', 'username', 'email', 'mobile_no', 'role', 'status', 'employee_no')


class ModuleListSerializer(serializers.Serializer):
    category = serializers.ChoiceField(choices=models.Module.Categories)
    modules = serializers.SerializerMethodField()

    def get_modules(self, obj):
        modules = obj.get('modules', []) if isinstance(obj, dict) else []
        data = []
        for m in modules:
            perms = []
            for p in m.permissions.all():
                perms.append({
                    'id': p.id,
                    'codename': p.codename,
                })
            data.append({
                'id': m.id,
                'name': m.name,
                'description': m.description,
                'codename': m.codename,
                'permissions': [
                    {
                        'id': mp.id,
                        'label': mp.label,
                        'permission': {'id': mp.permission.id, 'codename': mp.permission.codename} if mp.permission else None,
                    }
                    for mp in m.permissions.all()
                ],
            })
        return data


class ModuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.Module
        fields = ('id', 'name', 'description', 'codename', 'category')


class RoleModuleSerializer(serializers.ModelSerializer):
    class PermissionSerializer(serializers.ModelSerializer):
        class Meta:
            model = Permission
            fields = ('id', 'codename')

    module = ModuleSerializer()
    permissions = PermissionSerializer(many=True)

    class Meta:
        model = models.RoleModule
        fields = ('module', 'permissions')


class RoleListSerializer(serializers.ModelSerializer):
    modules = serializers.SerializerMethodField()
    role_modules = serializers.SerializerMethodField()

    class Meta:
        model = models.Role
        fields = ('id', 'name', 'modules', 'role_modules')

    def get_modules(self, obj):
        modules = obj.modules.all()
        return ModuleSerializer(modules, many=True).data

    def get_role_modules(self, obj):
        role_modules = obj.rolemodule_set.all()
        return RoleModuleSerializer(role_modules, many=True).data


class RoleDetailSerializer(serializers.ModelSerializer):
    role_modules = serializers.SerializerMethodField()

    class Meta:
        model = Group
        fields = ('id', 'name', 'role_modules')

    def get_role_modules(self, obj):
        from .models import RoleModule
        items = []
        for rm in RoleModule.objects.filter(role=obj):
            items.append({
                'module': {
                    'id': rm.module.id,
                    'name': rm.module.name,
                    'description': rm.module.description,
                    'codename': rm.module.codename,
                    'category': rm.module.category,
                },
                'permissions': [
                    {'id': p.id, 'codename': p.codename} for p in rm.permissions.all()
                ],
            })
        return items


class RoleCreateSerializer(serializers.ModelSerializer):
    role_modules = serializers.ListField(child=serializers.DictField(), write_only=True)

    class Meta:
        model = Group
        fields = ('id', 'name', 'role_modules')


class RoleUpdateSerializer(serializers.ModelSerializer):
    role_modules = serializers.ListField(child=serializers.DictField(), write_only=True)

    class Meta:
        model = Group
        fields = ('id', 'name', 'role_modules')
