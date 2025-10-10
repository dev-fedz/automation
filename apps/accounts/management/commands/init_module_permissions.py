from django.core.management.base import BaseCommand
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.contrib.auth import get_user_model
from apps.accounts.models import Module, ModulePermission

User = get_user_model()


class Command(BaseCommand):
	help = 'Initialize module permissions (reference-derived)'

	def handle(self, *args, **options):
		# Curated subset referencing original pattern
		spec = {
			'dashboard': [('Read (View)', 'can_view_dashboard')],
			'user_roles': [
				('Create', 'can_add_group'),
				('Read (View)', 'can_view_group'),
				('Update (Edit)', 'can_change_group'),
				('Delete (Archive)', 'can_delete_group'),
			],
			'user_accounts': [
				('Create', 'can_add_user'),
				('Read (View)', 'can_view_user'),
				('Update (Edit)', 'can_change_user'),
				('Delete (Archive)', 'can_delete_user'),
			]
		}

		ct = ContentType.objects.get_for_model(User)

		for code, perms in spec.items():
			module = Module.objects.filter(codename=code).first()
			if not module:
				self.stdout.write(self.style.WARNING(f'Skipping missing module {code}'))
				continue
			# Clear old module permissions (only those tied to this module)
			module.permissions.all().delete()
			for label, pcode in perms:
				perm, _ = Permission.objects.get_or_create(codename=pcode, content_type=ct)
				ModulePermission.objects.get_or_create(module=module, permission=perm, defaults={'label': label})
			self.stdout.write(self.style.SUCCESS(f'Updated permissions for {code}'))
		self.stdout.write(self.style.SUCCESS('Module permission initialization complete'))
