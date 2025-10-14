"""Tests for API automation collections and execution."""

from __future__ import annotations

from unittest import mock

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.core import models, selectors, services


class ApiAutomationTests(APITestCase):
    def setUp(self) -> None:
        self.user = get_user_model().objects.create_user(
            username="runner",
            email="runner@example.com",
            password="secret123",
        )
        self.client.force_authenticate(self.user)

        self.environment = models.ApiEnvironment.objects.create(
            name="Staging",
            variables={"base_url": "https://example.org"},
            default_headers={"X-Env": "staging"},
        )
        self.collection = models.ApiCollection.objects.create(
            name="Sample Collection",
            description="Demonstrates automation run",
        )
        self.collection.environments.add(self.environment)
        self.request = models.ApiRequest.objects.create(
            collection=self.collection,
            name="List Widgets",
            method="GET",
            url="{{ base_url }}/widgets",
            headers={"Accept": "application/json"},
        )
        models.ApiAssertion.objects.create(
            request=self.request,
            type=models.ApiAssertion.AssertionTypes.STATUS_CODE,
            expected_value="200",
        )

    @mock.patch("apps.core.services.requests.request")
    def test_run_collection_service(self, mock_request: mock.MagicMock) -> None:
        mock_response = mock.Mock()
        mock_response.status_code = 200
        mock_response.headers = {"Content-Type": "application/json"}
        mock_response.text = "{\"widgets\": []}"
        mock_response.json.return_value = {"widgets": []}
        mock_request.return_value = mock_response

        run = services.run_collection(
            collection=self.collection,
            environment=self.environment,
            overrides={"base_url": "https://override.local"},
            user=self.user,
        )

        self.assertEqual(run.status, models.ApiRun.Status.PASSED)
        self.assertEqual(run.results.count(), 1)
        result = run.results.first()
        assert result is not None
        self.assertEqual(result.status, models.ApiRunResult.Status.PASSED)
        self.assertEqual(run.summary["total_requests"], 1)
        mock_request.assert_called_once()
        kwargs = mock_request.call_args.kwargs
        self.assertEqual(kwargs["url"], "https://override.local/widgets")
        self.assertEqual(kwargs["headers"]["X-Env"], "staging")
        self.assertEqual(run.triggered_by, self.user)

    @mock.patch("apps.core.services.requests.request")
    def test_run_collection_via_api(self, mock_request: mock.MagicMock) -> None:
        mock_response = mock.Mock()
        mock_response.status_code = 200
        mock_response.headers = {}
        mock_response.text = "{}"
        mock_response.json.return_value = {}
        mock_request.return_value = mock_response

        url = reverse("core:core-collections-run", kwargs={"pk": self.collection.pk})
        payload = {"environment": self.environment.pk, "overrides": {"base_url": "https://api.local"}}
        response = self.client.post(url, data=payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["status"], models.ApiRun.Status.PASSED)
        self.assertEqual(response.data["summary"]["total_requests"], 1)

    def test_selectors_include_prefetched_relations(self) -> None:
        collections = selectors.api_collection_list()
        self.assertEqual(collections.count(), 1)
        prefetched_requests = list(collections.first().requests.all())  # type: ignore[union-attr]
        self.assertEqual(len(prefetched_requests), 1)

        runs = selectors.api_run_list()
        self.assertEqual(runs.count(), 0)

        environments = selectors.api_environment_list()
        self.assertEqual(environments.count(), 1)

    @mock.patch("apps.core.views.requests.request")
    def test_adhoc_execute_records_run(self, mock_request: mock.MagicMock) -> None:
        mock_response = mock.Mock()
        mock_response.status_code = 200
        mock_response.headers = {"Content-Type": "application/json"}
        mock_response.text = "{\"widgets\": []}"
        mock_response.json.return_value = {"widgets": []}
        mock_response.ok = True
        mock_request.return_value = mock_response

        url = reverse("core:core-request-execute")
        payload = {
            "method": "GET",
            "url": "{{ base_url }}/widgets",
            "headers": {"Accept": "application/json"},
            "environment": self.environment.pk,
            "params": {},
            "overrides": {"base_url": "https://api.local"},
            "collection_id": self.collection.pk,
            "request_id": self.request.pk,
        }

        response = self.client.post(url, data=payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        run = models.ApiRun.objects.get()
        self.assertEqual(run.collection, self.collection)
        self.assertEqual(run.environment, self.environment)
        self.assertEqual(run.triggered_by, self.user)
        self.assertEqual(run.status, models.ApiRun.Status.PASSED)
        self.assertEqual(run.summary, {"total_requests": 1, "passed_requests": 1, "failed_requests": 0})

        result = run.results.get()
        self.assertEqual(result.request, self.request)
        self.assertEqual(result.status, models.ApiRunResult.Status.PASSED)
        self.assertEqual(result.response_status, 200)
        self.assertTrue(result.response_time_ms is not None)

        self.assertEqual(response.data["run_id"], run.id)
        self.assertEqual(response.data["run_result_id"], result.id)
        mock_request.assert_called_once()

    @mock.patch("apps.core.views.requests.request")
    def test_adhoc_execute_records_run_without_collection(self, mock_request: mock.MagicMock) -> None:
        mock_response = mock.Mock()
        mock_response.status_code = 204
        mock_response.headers = {}
        mock_response.text = ""
        mock_response.json.side_effect = ValueError()
        mock_response.ok = True
        mock_request.return_value = mock_response

        url = reverse("core:core-request-execute")
        payload = {
            "method": "DELETE",
            "url": "https://api.example.com/widgets/1",
            "headers": {},
        }

        response = self.client.post(url, data=payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        run = models.ApiRun.objects.get()
        self.assertIsNone(run.collection)
        self.assertIsNone(run.environment)
        self.assertEqual(run.triggered_by, self.user)
        self.assertEqual(run.status, models.ApiRun.Status.PASSED)
        self.assertEqual(run.summary, {"total_requests": 1, "passed_requests": 1, "failed_requests": 0})

        result = run.results.get()
        self.assertIsNone(result.request)
        self.assertEqual(result.status, models.ApiRunResult.Status.PASSED)
        self.assertEqual(result.response_status, 204)

        self.assertEqual(response.data["run_id"], run.id)
        self.assertEqual(response.data["run_result_id"], result.id)
        mock_request.assert_called_once()
