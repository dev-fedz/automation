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
