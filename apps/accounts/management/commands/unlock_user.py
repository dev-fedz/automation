from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model

class Command(BaseCommand):
    help = 'Unlock a user by email (reset status to U and login_attempt=0)'

    def add_arguments(self, parser):
        parser.add_argument('email', type=str, help='User email to unlock')

    def handle(self, *args, **options):
        email = options['email']
        User = get_user_model()
        user = User.objects.filter(email=email).first()
        if not user:
            raise CommandError('User not found')
        user.status = 'U'
        user.login_attempt = 0
        user.save(update_fields=['status','login_attempt'])
        self.stdout.write(self.style.SUCCESS(f'Unlocked user {email}'))
