from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.core.models import Project, TestScenario, TestCase as TestCaseModel


class TestCaseDependencyPersistenceTest(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='dep_user', password='pass')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.project = Project.objects.create(name='Project 1')
        self.scenario = TestScenario.objects.create(project=self.project, title='Scenario 1')

        # Base payload values for creating cases in this scenario.
        self.base_payload = {
            'scenario': self.scenario.pk,
            'title': 'Base dependency test',
            'summary': 'testing dependency persistence',
            'precondition': 'pre',
        }

    def _create_case(self, payload: dict) -> TestCaseModel:
        resp = self.client.post('/api/core/test-cases/', payload, format='json')
        self.assertEqual(resp.status_code, 201, msg=f'Unexpected response: {resp.data}')
        created_id = resp.data.get('id')
        self.assertIsNotNone(created_id)
        return TestCaseModel.objects.get(pk=created_id)

    def test_dependency_fields_persist_on_create(self):
        dependency_case = self._create_case({
            **self.base_payload,
            'title': 'Dependency case',
        })

        payload = {
            **self.base_payload,
            'title': 'Dependent case',
            'requires_dependency': True,
            'test_case_dependency': dependency_case.pk,
            'dependency_response_key': 'data.token',
        }
        dependent_case = self._create_case(payload)

        self.assertTrue(dependent_case.requires_dependency)
        self.assertEqual(dependent_case.test_case_dependency_id, dependency_case.pk)
        self.assertEqual(dependent_case.dependency_response_key, 'data.token')

    def test_dependency_fields_persist_on_update(self):
        target_case = self._create_case(self.base_payload)
        dependency_case = self._create_case({
            **self.base_payload,
            'title': 'Dependency case',
        })

        update_payload = {
            **self.base_payload,
            'title': 'Updated case',
            'requires_dependency': True,
            'test_case_dependency': dependency_case.pk,
            'dependency_response_key': 'result.user_id',
        }

        url = f'/api/core/test-cases/{target_case.pk}/'
        resp = self.client.put(url, update_payload, format='json')
        self.assertEqual(resp.status_code, 200, msg=f'Unexpected response: {resp.data}')
        target_case.refresh_from_db()
        self.assertTrue(target_case.requires_dependency)
        self.assertEqual(target_case.test_case_dependency_id, dependency_case.pk)
        self.assertEqual(target_case.dependency_response_key, 'result.user_id')
