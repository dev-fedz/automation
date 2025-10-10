import os
from django.test import TestCase, override_settings
from django.core.management import call_command
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

class RateLimitTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='u1', email='u1@example.com', password='CorrectPass123!')
        self.client = APIClient()

    def test_rate_limit_triggers(self):
        # Force small window for test
        with override_settings():
            os.environ['LOGIN_RATE_LIMIT_MAX'] = '3'
            os.environ['LOGIN_RATE_LIMIT_WINDOW'] = '30'
            # 3 bad tries
            for _ in range(3):
                r = self.client.post('/api/accounts/auth/login/', {'email': 'u1@example.com', 'password': 'bad'}, format='json')
                self.assertEqual(r.status_code, 400)
            # 4th should hit rate limit or lock
            r = self.client.post('/api/accounts/auth/login/', {'email': 'u1@example.com', 'password': 'bad'}, format='json')
            self.assertEqual(r.status_code, 400)

    def test_unlock_command(self):
        User = get_user_model()
        u = self.user
        u.status = 'L'
        u.login_attempt = 3
        u.save(update_fields=['status','login_attempt'])
        call_command('unlock_user', 'u1@example.com')
        u.refresh_from_db()
        self.assertEqual(u.status, 'U')
        self.assertEqual(u.login_attempt, 0)
