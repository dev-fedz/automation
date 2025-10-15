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


class TestPlanWorkflowTests(APITestCase):
    def setUp(self) -> None:
        self.user = get_user_model().objects.create_user(
            username="planner",
            email="planner@example.com",
            password="secret123",
        )
        self.client.force_authenticate(self.user)

    def test_stlc_end_to_end_workflow(self) -> None:
        plan_payload = {
            "name": "Release 1 Automation",
            "objective": "Validate end-to-end flows before release.",
            "description": "Automation scope summary for release 1.",
            "modules_under_test": ["Accounts", "Billing"],
            "testing_types": {
                "functional": ["Regression", "Smoke"],
                "non_functional": ["Performance"],
            },
            "tools": ["Postman", "Locust"],
            "testing_timeline": {
                "kickoff": "2025-10-10",
                "signoff": "2025-10-20",
            },
            "testers": ["planner@example.com", "qa@example.com"],
            "approver": "qa-lead@example.com",
            "scopes": [
                {"category": "in_scope", "item": "API regression covering billing"},
                {"category": "out_scope", "item": "Manual UI verification"},
            ],
        }
        plan_response = self.client.post(
            reverse("core:core-test-plans-list"),
            data=plan_payload,
            format="json",
        )
        self.assertEqual(plan_response.status_code, status.HTTP_201_CREATED)
        plan_id = plan_response.data["id"]

        scenario_payload = {
            "plan": plan_id,
            "title": "User upgrades subscription",
            "description": "Covers billing and entitlement updates.",
            "preconditions": "User exists on basic tier.",
            "tags": ["billing", "critical"],
        }
        scenario_response = self.client.post(
            reverse("core:core-test-scenarios-list"),
            data=scenario_payload,
            format="json",
        )
        self.assertEqual(scenario_response.status_code, status.HTTP_201_CREATED)
        scenario_id = scenario_response.data["id"]

        case_payload = {
            "scenario": scenario_id,
            "title": "Upgrade via API",
            "steps": [
                {"action": "Call subscription upgrade endpoint", "method": "POST"},
                {"action": "Verify response payload"},
            ],
            "expected_results": [
                {"status_code": 200},
                {"json": {"plan": "premium"}},
            ],
            "dynamic_variables": {
                "expected_status": 200,
                "expected_plan": "premium",
            },
            "priority": "P1",
        }
        case_response = self.client.post(
            reverse("core:core-test-cases-list"),
            data=case_payload,
            format="json",
        )
        self.assertEqual(case_response.status_code, status.HTTP_201_CREATED)

        maintenance_payload = {
            "plan": plan_id,
            "version": "1.0",
            "summary": "Initial approval.",
            "updates": {"notes": "Baseline coverage"},
            "effective_date": "2025-10-11",
            "updated_by": "planner@example.com",
            "approved_by": "qa-lead@example.com",
        }
        maintenance_response = self.client.post(
            reverse("core:core-test-plan-maintenances-list"),
            data=maintenance_payload,
            format="json",
        )
        self.assertEqual(maintenance_response.status_code, status.HTTP_201_CREATED)

        detail_response = self.client.get(reverse("core:core-test-plans-detail", kwargs={"pk": plan_id}))
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.data["name"], plan_payload["name"])
        self.assertEqual(detail_response.data["description"], plan_payload["description"])
        self.assertEqual(len(detail_response.data["scopes"]), 2)
        self.assertEqual(detail_response.data["scopes"][0]["category"], "in_scope")
        self.assertEqual(detail_response.data["scopes"][0]["item"], "API regression covering billing")
        self.assertEqual(detail_response.data["scopes"][1]["category"], "out_scope")
        self.assertEqual(detail_response.data["scopes"][1]["item"], "Manual UI verification")
        self.assertEqual(len(detail_response.data["maintenances"]), 1)
        self.assertEqual(len(detail_response.data["scenarios"]), 1)
        scenario_data = detail_response.data["scenarios"][0]
        self.assertEqual(len(scenario_data["cases"]), 1)
        self.assertEqual(scenario_data["cases"][0]["dynamic_variables"]["expected_status"], 200)
