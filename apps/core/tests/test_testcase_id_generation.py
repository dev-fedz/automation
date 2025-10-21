from django.test import TestCase

from apps.core.models import TestPlan, TestScenario, TestCase as TestCaseModel
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient


class TestTestcaseIdGeneration(TestCase):
    def test_sequence_generation_single_scenario(self):
        plan = TestPlan.objects.create(name='Plan A')
        scenario = TestScenario.objects.create(plan=plan, title='Scenario Test 1')

        c1 = TestCaseModel.objects.create(scenario=scenario)
        c2 = TestCaseModel.objects.create(scenario=scenario)
        c3 = TestCaseModel.objects.create(scenario=scenario)

        self.assertEqual(c1.testcase_id, 'ST10001')
        self.assertEqual(c2.testcase_id, 'ST10002')
        self.assertEqual(c3.testcase_id, 'ST10003')

    def test_initials_multiple_words(self):
        plan = TestPlan.objects.create(name='Plan B')
        scenario = TestScenario.objects.create(plan=plan, title='My New Scenario Title')

        c1 = TestCaseModel.objects.create(scenario=scenario)
        # initials: M N S -> MNS
        self.assertEqual(c1.testcase_id, 'MNS10001')

    def test_increment_after_manual(self):
        plan = TestPlan.objects.create(name='Plan C')
        scenario = TestScenario.objects.create(plan=plan, title='Scenario Test 2')

        # create an existing case with a numeric suffix for the same initials
        existing = TestCaseModel.objects.create(scenario=scenario, testcase_id='ST20005')
        c1 = TestCaseModel.objects.create(scenario=scenario)

        # next number should be max(existing numeric) + 1 -> 20006
        self.assertEqual(c1.testcase_id, 'ST20006')

    def test_serializer_allows_missing_testcase_id(self):
        from apps.core.serializers import TestCaseSerializer

        plan = TestPlan.objects.create(name='Plan D')
        scenario = TestScenario.objects.create(plan=plan, title='Scenario Test 3')

        data = {'scenario': scenario.id, 'description': 'created via serializer'}
        ser = TestCaseSerializer(data=data)
        self.assertTrue(ser.is_valid(), msg=ser.errors)
        inst = ser.save()
        self.assertTrue(inst.testcase_id.startswith('ST'))

    def test_api_create_without_testcase_id(self):
        """POST to the API endpoint without testcase_id should create and return generated id."""
        User = get_user_model()
        user = User.objects.create_user(username='tester', password='pass')
        client = APIClient()
        client.force_authenticate(user=user)

        plan = TestPlan.objects.create(name='Plan API')
        scenario = TestScenario.objects.create(plan=plan, title='Scenario Test API')

        data = {'scenario': scenario.id, 'title': 'API created case', 'description': 'via API'}
        resp = client.post('/api/core/test-cases/', data, format='json')
        self.assertEqual(resp.status_code, 201, msg=resp.content)
        body = resp.json()
        self.assertIn('testcase_id', body)
        self.assertTrue(body['testcase_id'].startswith('ST'))
