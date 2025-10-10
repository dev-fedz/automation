from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
import os, secrets, string

class Command(BaseCommand):
    help = "Ensure an admin user exists (email=admin@example.com or ADMIN_EMAIL env). Prints password if newly created or reset with RESET_ADMIN=1."

    def handle(self, *args, **options):
        User = get_user_model()
        email = os.getenv('ADMIN_EMAIL', 'admin@example.com')
        reset = os.getenv('RESET_ADMIN', '0') == '1'
        password_env = os.getenv('ADMIN_PASSWORD')

        def gen_password():
            alphabet = string.ascii_letters + string.digits + '!@#$%^&*?'
            return ''.join(secrets.choice(alphabet) for _ in range(16))

        user = User.objects.filter(email=email).first()
        created = False
        if not user:
            pwd = password_env or gen_password()
            user = User.objects.create_superuser(username=email.split('@')[0], email=email, password=pwd)
            created = True
            self.stdout.write(self.style.SUCCESS(f"Created admin {email} password={pwd}"))
            return
        if reset:
            pwd = password_env or gen_password()
            user.set_password(pwd)
            user.is_superuser = True
            user.is_staff = True
            user.save()
            self.stdout.write(self.style.SUCCESS(f"Reset admin {email} password={pwd}"))
        else:
            self.stdout.write(f"Admin user {email} already exists (id={user.id}). Use RESET_ADMIN=1 to reset password.")
