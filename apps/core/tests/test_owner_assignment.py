from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.core.models import TestCase as TestCaseModel


class OwnerAssignmentTest(TestCase):
    def test_owner_set_when_payload_owner_blank(self):
        User = get_user_model()
        user = User.objects.create_user(username='owner_user', password='pass')

        client = APIClient()
        # Authenticate the client as the created user
        client.force_authenticate(user=user)

        # Create a minimal TestPlan and TestScenario required by TestCase
        from apps.core.models import TestPlan, TestScenario
        plan = TestPlan.objects.create(name='Plan 1')
        scenario = TestScenario.objects.create(plan=plan, title='Scenario 1')

        payload = {
            'scenario': scenario.pk,
            'title': 'Owner test',
            'summary': 'testing owner assignment',
            'precondition': 'pre',
            'owner': '',
        }

        resp = client.post('/api/core/test-cases/', payload, format='json')
        self.assertEqual(resp.status_code, 201, msg=f'Unexpected response: {resp.data}')

        created_id = resp.data.get('id')
        self.assertIsNotNone(created_id)

        inst = TestCaseModel.objects.get(pk=created_id)
        self.assertIsNotNone(inst.owner)
        self.assertEqual(inst.owner.pk, user.pk)
