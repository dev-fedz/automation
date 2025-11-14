from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.core.models import Project, TestScenario, TestCase as TestCaseModel


class OwnerAssignmentTest(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='owner_user', password='pass')
        self.client = APIClient()
        # Authenticate the client as the created user so the API can infer ownership.
        self.client.force_authenticate(user=self.user)
        # Create the minimal project/scenario hierarchy required by TestCase creates.
        self.project = Project.objects.create(name='Project 1')
        self.scenario = TestScenario.objects.create(project=self.project, title='Scenario 1')

    def _base_payload(self) -> dict:
        return {
            'scenario': self.scenario.pk,
            'title': 'Owner test',
            'summary': 'testing owner assignment',
            'precondition': 'pre',
        }

    def _assert_owner_assigned(self, resp):
        self.assertEqual(resp.status_code, 201, msg=f'Unexpected response: {resp.data}')
        created_id = resp.data.get('id')
        self.assertIsNotNone(created_id)
        inst = TestCaseModel.objects.get(pk=created_id)
        self.assertIsNotNone(inst.owner)
        self.assertEqual(inst.owner.pk, self.user.pk)

    def test_owner_set_when_payload_owner_blank(self):
        payload = self._base_payload()
        payload['owner'] = ''

        resp = self.client.post('/api/core/test-cases/', payload, format='json')
        self._assert_owner_assigned(resp)

    def test_owner_set_when_owner_field_missing(self):
        payload = self._base_payload()

        resp = self.client.post('/api/core/test-cases/', payload, format='json')
        self._assert_owner_assigned(resp)
