from __future__ import annotations

import uuid
from django.contrib.auth.models import AbstractUser, Group, GroupManager, Permission, UserManager
from django.db import models
from django.utils import timezone


class ChoiceFieldMixin:
    def __init__(self, **kwargs):
        choices_cls = kwargs.pop('choices_cls', None)
        if choices_cls:
            kwargs['choices'] = choices_cls.choices
        super().__init__(**kwargs)


class TextChoiceField(ChoiceFieldMixin, models.CharField):
    pass


class SoftDeleteMixin(models.Model):
    deleted_at = models.DateTimeField(null=True, blank=True, default=None, db_index=True)

    class Meta:
        abstract = True

    def soft_delete(self, commit: bool = True):
        self.deleted_at = timezone.now()
        if commit:
            self.save(update_fields=['deleted_at'])

    def restore(self):
        self.deleted_at = None
        self.save(update_fields=['deleted_at'])


class SoftDeleteManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)


class User(SoftDeleteMixin, AbstractUser):
    class Types(models.TextChoices):
        ADMIN = 'A', 'Admin'
        GUEST = 'G', 'Guest'
        NONE = 'N', 'None'

    class Statuses(models.TextChoices):
        LOCKED = 'L', 'Locked'
        UNLOCKED = 'U', 'Unlocked'

    status = TextChoiceField(max_length=5, choices_cls=Statuses, default=Statuses.UNLOCKED)
    is_temporary = models.BooleanField(default=False)
    otp = models.CharField(max_length=20, null=True, blank=True)
    login_attempt = models.IntegerField(default=0)
    two_factor_secret = models.CharField(max_length=64, null=True, blank=True)
    two_factor_enabled = models.BooleanField(default=False)
    mobile_no = models.CharField(max_length=150, null=True, blank=True)
    employee_no = models.CharField(max_length=50, null=True, blank=True, unique=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    objects = UserManager()
    active_objects = SoftDeleteManager()
    type = TextChoiceField(max_length=5, choices_cls=Types, default=Types.NONE)

    def __str__(self):  # pragma: no cover - string repr
        return f"{self.username} - {self.first_name} {self.last_name}"  # noqa: E501


class AdminRoleManager(GroupManager):
    def get_queryset(self):
        return super().get_queryset()


class Role(Group):
    class Meta:
        proxy = True

    objects = GroupManager()
    admin_objects = AdminRoleManager()

    def __repr__(self):  # pragma: no cover
        return f"<Role {self.name} ({self.pk})>"


class Module(models.Model):
    name = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    codename = models.CharField(max_length=255)

    class Categories(models.TextChoices):
        BASE = 'B', 'Base'
        DASHBOARD = 'DB', 'Dashboard'
        USERMANAGEMENT = 'UM', 'User Management'
        APITESTER = 'API', 'API Tester'
        CORE = 'CORE', 'Core'
        AUTOMATION = 'AUTO', 'Automation'
        CMS = 'CMS', 'CMS'
        REPORTS = 'R', 'Reports'

    roles = models.ManyToManyField(
        Group,
        through='RoleModule',
        through_fields=('module', 'role'),
        related_name='modules',
    )
    category = TextChoiceField(max_length=5, choices_cls=Categories, default=Categories.BASE)
    order = models.IntegerField(default=0)

    def __str__(self):  # pragma: no cover
        return self.name


class ModulePermission(models.Model):
    module = models.ForeignKey(Module, on_delete=models.CASCADE, related_name='permissions')
    permission = models.ForeignKey(Permission, on_delete=models.CASCADE, related_name='modules', null=True)
    label = models.CharField(max_length=150)

    def __str__(self):  # pragma: no cover
        return f"{self.module} - {self.label}"


class RoleModule(models.Model):
    role = models.ForeignKey(Group, on_delete=models.CASCADE)
    module = models.ForeignKey(Module, on_delete=models.CASCADE)
    permissions = models.ManyToManyField(Permission)

    def __str__(self):  # pragma: no cover
        return f"{self.role} - {self.module}"


def uploaded_file_path(instance, filename):
    file_ext = filename.split('.')[-1]
    file_name = str(uuid.uuid4()).replace('-', '')
    return f"docs/{file_name}.{file_ext}"


class Assets(models.Model):
    name = models.CharField(max_length=150)
    url = models.FileField(upload_to=uploaded_file_path)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):  # pragma: no cover
        return self.name


class UserAuditTrail(models.Model):
    class Actions(models.TextChoices):
        # Authentication
        LOGIN = 'auth_login', 'Authentication - Login'
        LOGOUT = 'auth_logout', 'Authentication - Logout'

        # User Accounts
        CREATE_USER_ACCOUNT = 'user_create', 'User Accounts - Create User Account'
        UPDATE_USER_ACCOUNT = 'user_update', 'User Accounts - Update User Account'
        DELETE_USER_ACCOUNT = 'user_delete', 'User Accounts - Delete User Account'

        # Role
        CREATE_ROLE = 'role_create', 'Role - Create Role'
        UPDATE_ROLE = 'role_update', 'Role - Update Role'
        DELETE_ROLE = 'role_delete', 'Role - Delete Role'

        # Project
        CREATE_PROJECT = 'project_create', 'Project - Create Project'
        UPDATE_PROJECT = 'project_update', 'Project - Update Project'

        # Projects (Automation Runs)
        RUN_AUTOMATION_PROJECT = 'project_run', 'Projects - Run Automation on Projects'
        RUN_AUTOMATION_MODULE = 'module_run', 'Projects - Run Automation on Modules'
        RUN_AUTOMATION_SCENARIO = 'scenario_run', 'Projects - Run Automation on Scenarios'
        RUN_AUTOMATION_TEST_CASE = 'testcase_run_automation', 'Projects - Run Automation on Test Cases'

        # Modules
        CREATE_MODULE = 'module_create', 'Modules - Create Modules'
        UPDATE_MODULE = 'module_update', 'Modules - Update Modules'
        DELETE_MODULE = 'module_delete', 'Modules - Delete Modules'
        CREATE_SCENARIO_FROM_MODULE = 'module_scenario_create', 'Modules - Create Scenario from Modules'
        UPDATE_SCENARIO_FROM_MODULE = 'module_scenario_update', 'Modules - Update Scenario From Modules'
        DELETE_SCENARIO_FROM_MODULE = 'module_scenario_delete', 'Modules - Delete Scenario From Modules'

        # Scenarios
        CREATE_SCENARIO = 'scenario_create', 'Scenarios - Create Scenarios'
        UPDATE_SCENARIO = 'scenario_update', 'Scenarios - Update Scenarios'
        DELETE_SCENARIO = 'scenario_delete', 'Scenarios - Delete Scenarios'

        # Test Case
        CREATE_TEST_CASE = 'testcase_create', 'Test Case - Create Test Case'
        UPDATE_TEST_CASE = 'testcase_update', 'Test Case - Update Test Case'
        RUN_TEST_CASE = 'testcase_run', 'Test Case - Run Test Case'
        DELETE_TEST_CASE = 'testcase_delete', 'Test Case - Delete Test Case'

        # Reports
        EXPORT_AUTOMATED_REPORT = 'report_export_automated', 'Reports - Export Automated Report'
        EXPORT_TESTCASE_REPORT = 'report_export_testcase', 'Reports - Export Test Case Report'

        # API Environment
        CREATE_API_ENVIRONMENT = 'environment_create', 'API Environment - Create Environment'
        UPDATE_API_ENVIRONMENT = 'environment_update', 'API Environment - Update Environment'
        DELETE_API_ENVIRONMENT = 'environment_delete', 'API Environment - Delete Environment'

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='audit_trails')
    action = TextChoiceField(max_length=40, choices_cls=Actions)
    datetime = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-datetime', '-id']

    def __str__(self):  # pragma: no cover
        return f"{self.user_id} - {self.action} - {self.datetime}"
