from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .. import models


class RelatedApiRequestTest(APITestCase):
    def setUp(self):
        # create a collection and request to reference
        self.collection = models.ApiCollection.objects.create(name='Test Coll', slug='test-coll')
        self.api_request = models.ApiRequest.objects.create(collection=self.collection, name='Sample', method='GET', url='https://example.com')
        # TestScenario requires a non-null Project foreign key; create a simple project
        self.project = models.Project.objects.create(name='Project 1')
        self.scenario = models.TestScenario.objects.create(title='S', project=self.project)
        # create and authenticate a user
        from django.contrib.auth import get_user_model
        User = get_user_model()
        self.user = User.objects.create_user(username='testuser', email='test@example.com', password='pass')
        self.client.force_authenticate(user=self.user)

    def test_create_testcase_with_related_api_request(self):
        url = '/api/core/test-cases/'
        payload = {
            'scenario': self.scenario.id,
            'title': 'Case with related',
            'related_api_request': self.api_request.id,
        }
        resp = self.client.post(url, payload, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        data = resp.json()
        self.assertIn('id', data)
        tc = models.TestCase.objects.get(pk=data['id'])
        self.assertEqual(getattr(tc, 'related_api_request_id'), self.api_request.id)
