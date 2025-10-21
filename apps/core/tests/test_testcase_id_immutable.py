from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .. import models


class TestCaseIdImmutableTest(APITestCase):
    def setUp(self):
        # create a plan, scenario and initial testcase
        from .test_testcase_id_generation import create_sample_plan_scenario  # reuse helper if present

        try:
            self.plan, self.scenario = create_sample_plan_scenario()
        except Exception:
            # fallback: create minimal objects inline
            plan = models.TestPlan.objects.create(name='Test Plan (API)')
            scenario = models.TestScenario.objects.create(plan=plan, title='Scenario X')
            self.plan = plan
            self.scenario = scenario

        self.testcase = models.TestCase.objects.create(scenario=self.scenario, description='orig')

    def test_update_cannot_change_testcase_id(self):
        url = reverse('testcase-detail', args=[self.testcase.id])
        # Attempt to change testcase_id
        payload = {
            'testcase_id': 'SHOULDCHANGE',
            'description': 'updated',
        }
        resp = self.client.put(url, payload, format='json')
        # Expect failure (400) or success but id unchanged. Prefer 400 from view-level check.
        if resp.status_code == status.HTTP_200_OK:
            self.testcase.refresh_from_db()
            self.assertNotEqual(self.testcase.testcase_id, 'SHOULDCHANGE')
        else:
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_partial_update_cannot_change_testcase_id(self):
        url = reverse('testcase-detail', args=[self.testcase.id])
        payload = {'testcase_id': 'ANOTHER',}
        resp = self.client.patch(url, payload, format='json')
        if resp.status_code == status.HTTP_200_OK:
            self.testcase.refresh_from_db()
            self.assertNotEqual(self.testcase.testcase_id, 'ANOTHER')
        else:
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
