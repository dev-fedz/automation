"""Business services supporting API automation flows."""

from __future__ import annotations

import re
import time
from copy import deepcopy
from typing import Any, Dict, Iterable, Tuple

import requests
from django.db import transaction
from django.utils import timezone

from . import models


VARIABLE_PATTERN = re.compile(r"{{\s*([\w\.-]+)\s*}}")


def _resolve_variables(value: Any, variables: Dict[str, Any]) -> Any:
    if isinstance(value, str):
        def replace(match: re.Match[str]) -> str:
            key = match.group(1)
            return str(variables.get(key, match.group(0)))

        return VARIABLE_PATTERN.sub(replace, value)
    if isinstance(value, dict):
        return {k: _resolve_variables(v, variables) for k, v in value.items()}
    if isinstance(value, list):
        return [_resolve_variables(item, variables) for item in value]
    return value


def _extract_json_path(data: Any, path: str) -> Any:
    if not path:
        return data
    current = data
    segments = [segment for segment in path.strip(".").split(".") if segment]
    for segment in segments:
        if isinstance(current, dict):
            current = current.get(segment)
        elif isinstance(current, list):
            try:
                index = int(segment)
            except ValueError:
                return None
            if index >= len(current):
                return None
            current = current[index]
        else:
            return None
    return current


def _compare_values(actual: Any, expected: Any, assertion: models.ApiAssertion) -> bool:
    comparator = (assertion.comparator or "equals").lower()
    if comparator == "equals":
        return actual == expected
    if comparator == "contains" and isinstance(actual, str):
        return str(expected) in actual

    numeric_comparators = {
        "lt": lambda a, b: a < b,
        "lte": lambda a, b: a <= b,
        "gt": lambda a, b: a > b,
        "gte": lambda a, b: a >= b,
    }
    if comparator in numeric_comparators:
        try:
            actual_float = float(actual)
            expected_float = float(expected)
        except (TypeError, ValueError):
            return False
        return numeric_comparators[comparator](actual_float, expected_float)

    if comparator == "subset" and isinstance(actual, dict) and isinstance(expected, dict):
        return all(actual.get(key) == value for key, value in expected.items())

    return False


def _evaluate_assertions(
    assertions: Iterable[models.ApiAssertion],
    response: requests.Response,
    response_time_ms: float,
) -> Tuple[bool, list[dict[str, Any]], list[dict[str, Any]]]:
    passed: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    try:
        json_body = response.json()
    except ValueError:
        json_body = None

    for assertion in assertions:
        result = {"id": assertion.id, "type": assertion.type, "field": assertion.field}
        success = False
        actual_value: Any = None
        expected_value: Any = assertion.expected_value

        if assertion.type == models.ApiAssertion.AssertionTypes.STATUS_CODE:
            actual_value = response.status_code
            try:
                expected_value = int(expected_value)
            except (TypeError, ValueError):
                pass
            success = actual_value == expected_value
        elif assertion.type == models.ApiAssertion.AssertionTypes.JSON_PATH:
            if json_body is not None:
                actual_value = _extract_json_path(json_body, assertion.field)
                success = _compare_values(actual_value, expected_value, assertion)
            else:
                result["message"] = "Response body is not JSON"
        elif assertion.type == models.ApiAssertion.AssertionTypes.HEADER:
            actual_value = response.headers.get(assertion.field or "")
            success = _compare_values(actual_value, expected_value, assertion)
        elif assertion.type == models.ApiAssertion.AssertionTypes.BODY_CONTAINS:
            actual_value = assertion.expected_value
            success = assertion.expected_value in response.text
        else:
            result["message"] = "Unsupported assertion type"

        result["expected"] = expected_value
        result["actual"] = actual_value
        result.setdefault("message", "")

        if success:
            passed.append(result)
        else:
            failed.append(result)

    return len(failed) == 0, passed, failed


def _build_request_payload(
    api_request: models.ApiRequest,
    variables: Dict[str, Any],
    environment: models.ApiEnvironment | None,
) -> Dict[str, Any]:
    merged_headers: Dict[str, Any] = {}
    if environment:
        merged_headers.update(_resolve_variables(deepcopy(environment.default_headers), variables))
    merged_headers.update(_resolve_variables(deepcopy(api_request.headers), variables))
    merged_headers = {key: value for key, value in merged_headers.items() if value not in (None, "")}

    params = _resolve_variables(deepcopy(api_request.query_params), variables)
    url = _resolve_variables(api_request.url, variables)

    data: Dict[str, Any] | str = {}
    json_payload: Any = None

    if api_request.body_type == models.ApiRequest.BodyTypes.JSON:
        json_payload = _resolve_variables(deepcopy(api_request.body_json), variables)
    elif api_request.body_type == models.ApiRequest.BodyTypes.FORM:
        data = _resolve_variables(deepcopy(api_request.body_form), variables)
    elif api_request.body_type == models.ApiRequest.BodyTypes.RAW:
        data = _resolve_variables(api_request.body_raw, variables)

    auth = None
    if api_request.auth_type == models.ApiRequest.AuthTypes.BASIC:
        username = _resolve_variables(api_request.auth_basic.get("username", ""), variables)
        password = _resolve_variables(api_request.auth_basic.get("password", ""), variables)
        auth = (username, password)
    elif api_request.auth_type == models.ApiRequest.AuthTypes.BEARER:
        token = _resolve_variables(api_request.auth_bearer, variables)
        if token:
            merged_headers.setdefault("Authorization", f"Bearer {token}")

    timeout_seconds = max(1, api_request.timeout_ms) / 1000

    return {
        "method": api_request.method,
        "url": url,
        "headers": merged_headers,
        "params": params,
        "data": None if json_payload is not None else data,
        "json": json_payload,
        "auth": auth,
        "timeout": timeout_seconds,
    }


def _summarize_run(total: int, passed: int) -> Dict[str, Any]:
    return {
        "total_requests": total,
        "passed_requests": passed,
        "failed_requests": total - passed,
    }


@transaction.atomic
def run_collection(
    *,
    collection: models.ApiCollection,
    environment: models.ApiEnvironment | None = None,
    overrides: Dict[str, Any] | None = None,
    user: Any = None,
) -> models.ApiRun:
    variables: Dict[str, Any] = {}
    if environment:
        variables.update(environment.variables or {})
    if overrides:
        variables.update(overrides)

    run = models.ApiRun.objects.create(
        collection=collection,
        environment=environment,
        triggered_by=user,
        status=models.ApiRun.Status.RUNNING,
        started_at=timezone.now(),
    )

    total_requests = 0
    passed_requests = 0

    for order, api_request in enumerate(collection.requests.all(), start=1):
        total_requests += 1
        payload = _build_request_payload(api_request, variables, environment)
        result = models.ApiRunResult.objects.create(
            run=run,
            request=api_request,
            order=order,
            status=models.ApiRunResult.Status.ERROR,
        )
        try:
            start = time.perf_counter()
            response = requests.request(
                method=payload["method"],
                url=payload["url"],
                headers=payload["headers"],
                params=payload["params"],
                data=payload["data"],
                json=payload["json"],
                auth=payload["auth"],
                timeout=payload["timeout"],
            )
            elapsed_ms = (time.perf_counter() - start) * 1000
            success, passed, failed = _evaluate_assertions(api_request.assertions.all(), response, elapsed_ms)

            result.response_status = response.status_code
            result.response_headers = dict(response.headers)
            result.response_body = response.text[:20000]
            result.response_time_ms = elapsed_ms
            result.assertions_passed = passed
            result.assertions_failed = failed
            result.status = models.ApiRunResult.Status.PASSED if success else models.ApiRunResult.Status.FAILED
            if success:
                passed_requests += 1
        except requests.RequestException as exc:
            result.error = str(exc)
            result.status = models.ApiRunResult.Status.ERROR

        result.save()

    run.finished_at = timezone.now()
    run.summary = _summarize_run(total_requests, passed_requests)
    run.status = models.ApiRun.Status.PASSED if passed_requests == total_requests else models.ApiRun.Status.FAILED
    run.save(update_fields=["finished_at", "summary", "status", "updated_at"])
    return run
