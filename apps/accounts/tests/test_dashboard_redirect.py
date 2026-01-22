from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase

from apps.accounts import models


class DashboardRedirectTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='u2', email='u2@example.com', password='CorrectPass123!')
        self.role = Group.objects.create(name='Role1')
        self.user.groups.add(self.role)

    def test_dashboard_redirects_to_first_enabled_module_when_no_dashboard_perm(self):
        # Enable a module for the role (by linking it via RoleModule)
        module = models.Module.objects.create(
            name='User Accounts',
            description='User Accounts',
            codename='user_accounts',
            category=models.Module.Categories.USERMANAGEMENT,
            order=1,
        )
        models.RoleModule.objects.create(role=self.role, module=module)

        self.client.force_login(self.user)
        r = self.client.get('/')
        self.assertEqual(r.status_code, 302)
        self.assertEqual(r['Location'], '/users/')

    def test_dashboard_renders_when_dashboard_perm_present(self):
        # Give dashboard view permission
        ct = ContentType.objects.get_for_model(get_user_model())
        perm, _ = Permission.objects.get_or_create(
            codename='can_view_dashboard',
            name='Can view dashboard',
            content_type=ct,
        )
        self.role.permissions.add(perm)

        self.client.force_login(self.user)
        r = self.client.get('/')
        self.assertEqual(r.status_code, 200)
