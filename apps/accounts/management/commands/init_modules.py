from django.core.management.base import BaseCommand
from apps.accounts.models import Module


class Command(BaseCommand):
	help = 'Initialize core modules (reference-based subset)'

	def handle(self, *args, **options):
		# Minimal curated list derived from reference project (trimmed)
		base_modules = [
			('dashboard', ' Dashboard', Module.Categories.DASHBOARD),
			('user_roles', 'User Roles', Module.Categories.USERMANAGEMENT),
			('user_accounts', 'User Accounts', Module.Categories.USERMANAGEMENT),
			('user_logs', 'User Logs', Module.Categories.USERMANAGEMENT),
			('projects_project', 'Projects', Module.Categories.CORE),
			('projects_module', 'Modules', Module.Categories.CORE),
			('projects_scenario', 'Scenarios', Module.Categories.CORE),
			('projects_testcase', 'Test Cases', Module.Categories.CORE),
			('api_tester', 'API Tester', Module.Categories.APITESTER),
			('automation', 'Automation', Module.Categories.AUTOMATION),
			('api_environment', 'API Environment', Module.Categories.CMS),
		]

		wanted_codes = [c for c, *_ in base_modules]
		# Remove obsolete modules not in curated list
		Module.objects.exclude(codename__in=wanted_codes).delete()

		for order, (code, name, category) in enumerate(base_modules):
			obj, created = Module.objects.update_or_create(
				codename=code,
				defaults={'name': name, 'category': category, 'order': order},
			)
			self.stdout.write(self.style.SUCCESS(f"{'Created' if created else 'Updated'} module {code}"))
		self.stdout.write(self.style.SUCCESS('Module initialization complete'))
