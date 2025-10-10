from django.core.management.base import BaseCommand
from apps.accounts.models import Module, Role
from apps.accounts.services import role_update


class Command(BaseCommand):
	help = 'Ensure Super Admin role has all module permissions'

	def handle(self, *args, **options):
		role_name = 'Super Admin'
		role, _ = Role.objects.get_or_create(name=role_name)
		role_modules = []
		for module in Module.objects.all():
			perms = [mp.permission for mp in module.permissions.all() if mp.permission]
			role_modules.append({'module': module.pk, 'permissions': perms})
		role_update(role=role, data={'name': role_name, 'role_modules': role_modules})
		self.stdout.write(self.style.SUCCESS(f'Ensured role {role_name}'))
