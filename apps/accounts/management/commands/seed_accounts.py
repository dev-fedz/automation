from django.core.management.base import BaseCommand
from django.contrib.auth.models import Group, Permission
from apps.accounts.models import Module, ModulePermission, RoleModule
from django.db import transaction

MODULE_DEFS = [
    {
        'name': 'User Management',
        'codename': 'user_mgmt',
        'category': 'UM',
        'order': 1,
        'permissions': [
            ('Can view users', 'view_user'),
            ('Can add users', 'add_user'),
            ('Can change users', 'change_user'),
            ('Can delete users', 'delete_user'),
        ],
    },
]

ROLES = [
    {
        'name': 'Admin',
        'modules': {
            'user_mgmt': ['view_user', 'add_user', 'change_user', 'delete_user'],
        },
    },
]

class Command(BaseCommand):
    help = 'Seed default roles, modules, and module permissions.'

    @transaction.atomic
    def handle(self, *args, **options):
        self.stdout.write(self.style.MIGRATE_HEADING('Seeding modules'))
        module_map = {}
        for data in MODULE_DEFS:
            module, _ = Module.objects.get_or_create(
                codename=data['codename'],
                defaults={
                    'name': data['name'],
                    'category': data['category'],
                    'order': data['order'],
                },
            )
            module_map[data['codename']] = module
            for label, perm_codename in data['permissions']:
                # Ensure a Django permission exists (link by codename)
                perm = Permission.objects.filter(codename=perm_codename).first()
                mp, created = ModulePermission.objects.get_or_create(
                    module=module,
                    permission=perm,
                    label=label,
                )
                if created:
                    self.stdout.write(self.style.SUCCESS(f"  Added module permission {label}"))
        self.stdout.write(self.style.MIGRATE_HEADING('Seeding roles'))
        for role_def in ROLES:
            role, _ = Group.objects.get_or_create(name=role_def['name'])
            for mod_code, perms in role_def['modules'].items():
                module = module_map.get(mod_code)
                if not module:
                    self.stdout.write(self.style.WARNING(f"  Skipping unknown module {mod_code}"))
                    continue
                role_module, _ = RoleModule.objects.get_or_create(role=role, module=module)
                if perms:
                    qs = Permission.objects.filter(codename__in=perms)
                    role_module.permissions.set(qs)
            self.stdout.write(self.style.SUCCESS(f"  Ensured role {role.name}"))
        self.stdout.write(self.style.SUCCESS('Seeding complete'))
