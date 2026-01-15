from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase

from apps.accounts import models, services


class RoleUpdatePermissionsTests(TestCase):
    def test_role_update_allows_clearing_all_permissions(self):
        # Setup a module and a couple of permissions
        ct = ContentType.objects.get_for_model(models.User)
        p1 = Permission.objects.create(codename='can_create_dummy', name='Can create dummy', content_type=ct)
        p2 = Permission.objects.create(codename='can_delete_dummy', name='Can delete dummy', content_type=ct)

        module = models.Module.objects.create(name='Dummy', description='Dummy', codename='dummy', category=models.Module.Categories.USERMANAGEMENT)

        role = Group.objects.create(name='Test Role')

        # Seed role with one module and two permissions
        services.role_update(
            role=role,
            data={
                'name': role.name,
                'role_modules': [
                    {
                        'module': module.id,
                        'permissions': [p1.id, p2.id],
                    }
                ],
            },
        )

        role.refresh_from_db()
        self.assertEqual(role.permissions.count(), 2)
        self.assertEqual(role.rolemodule_set.count(), 1)

        # Now simulate "uncheck all CRUD" -> UI sends empty role_modules list
        services.role_update(
            role=role,
            data={
                'name': role.name,
                'role_modules': [],
            },
        )

        role.refresh_from_db()
        self.assertEqual(role.permissions.count(), 0)
        self.assertEqual(role.rolemodule_set.count(), 0)
