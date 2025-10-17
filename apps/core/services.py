"""Business services supporting API automation flows."""

from __future__ import annotations

import hashlib
import json
import re
import time
from copy import deepcopy
from typing import Any, Dict, Iterable, List, Tuple
from xml.etree import ElementTree as ET

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


def _split_path(path: str) -> list[str]:
    return [segment.strip() for segment in (path or "").split(".") if segment and segment.strip()]


def _get_nested_value(data: Any, path: str) -> Any:
    segments = _split_path(path)
    current = data
    for segment in segments:
        if isinstance(current, dict):
            current = current.get(segment)
        else:
            return None
    return current


def _ensure_nested_dict(data: dict[str, Any], path: list[str]) -> dict[str, Any]:
    current = data
    for segment in path:
        if segment not in current or not isinstance(current[segment], dict):
            current[segment] = {}
        current = current[segment]
    return current


def _set_nested_value(data: dict[str, Any], path: str, value: Any) -> None:
    segments = _split_path(path)
    if not segments:
        return
    *parents, leaf = segments
    target = _ensure_nested_dict(data, parents)
    target[leaf] = value


def _compute_hash_hex(algorithm: str, message: str) -> str:
    normalized = (algorithm or "sha512").lower()
    hash_functions = {
        "sha256": hashlib.sha256,
        "sha384": hashlib.sha384,
        "sha512": hashlib.sha512,
    }
    func = hash_functions.get(normalized)
    if func is None:
        raise ValueError(f"Unsupported hash algorithm: {algorithm}")
    return func(message.encode("utf-8")).hexdigest()


def _parse_signature_components(raw_text: str) -> list[dict[str, str]]:
    lines = [line.strip() for line in (raw_text or "").splitlines() if line.strip()]
    components: list[dict[str, str]] = []
    for entry in lines:
        if entry.startswith("literal:"):
            components.append({"type": "literal", "value": entry[len("literal:"):]})
        elif entry.startswith("path:"):
            components.append({"type": "path", "value": entry[len("path:"):]})
        elif (entry.startswith('"') and entry.endswith('"')) or (entry.startswith("'") and entry.endswith("'")):
            components.append({"type": "literal", "value": entry[1:-1]})
        else:
            components.append({"type": "path", "value": entry})
    return components


def _split_xml_path(path: str) -> list[str]:
    normalized = (path or "").replace("/", ".")
    return _split_path(normalized)


def _xml_local_name(tag: str) -> str:
    if not isinstance(tag, str):
        return ""
    if "}" in tag:
        return tag.split("}", 1)[1]
    if ":" in tag:
        return tag.split(":", 1)[1]
    return tag


def _parse_xml_segment(segment: str) -> tuple[str, int]:
    name = (segment or "").strip()
    index = 0
    if "[" in name and name.endswith("]"):
        base, bracket = name.split("[", 1)
        name = base.strip()
        try:
            index = int(bracket[:-1])
        except ValueError:
            index = 0
    if ":" in name:
        name = name.split(":", 1)[1]
    return name, index


def _find_xml_child(parent: ET.Element, segment: str) -> ET.Element | None:
    name, index = _parse_xml_segment(segment)
    if not name:
        return None
    matches = [child for child in list(parent) if _xml_local_name(child.tag) == name]
    if not matches:
        return None
    if index < 0 or index >= len(matches):
        return None
    return matches[index]


def _locate_xml_node(root: ET.Element, path: str) -> ET.Element | None:
    if root is None:
        return None
    segments = _split_xml_path(path)
    if not segments:
        return root
    first_name, first_index = _parse_xml_segment(segments[0])
    current = root
    if first_name and _xml_local_name(current.tag) == first_name and first_index in (0,):
        segments = segments[1:]
    for segment in segments:
        current = _find_xml_child(current, segment)
        if current is None:
            return None
    return current


def _get_xml_node_text(root: ET.Element, path: str) -> str | None:
    node = _locate_xml_node(root, path)
    if node is None:
        return None
    return node.text


def _apply_body_transforms(
    json_payload: Any,
    transforms: Dict[str, Any] | None,
    variables: Dict[str, Any],
) -> Dict[str, str]:
    if not isinstance(json_payload, dict):
        return {}
    overrides: Dict[str, str] = {}
    config = transforms or {}

    for override in config.get("overrides", []) or []:
        path = str(override.get("path", "")).strip()
        if not path:
            continue
        raw_value = override.get("value", "")
        resolved_value = _resolve_variables(str(raw_value), variables)
        _set_nested_value(json_payload, path, resolved_value)

    for signature in config.get("signatures", []) or []:
        target_path = (
            signature.get("target_path")
            or signature.get("targetPath")
            or signature.get("target")
            or ""
        )
        target_path = str(target_path).strip()
        if not target_path:
            continue
        algorithm = str(signature.get("algorithm", "sha512")).lower()
        components = _parse_signature_components(str(signature.get("components", "")))
        if not components:
            continue
        parts: list[str] = []
        for component in components:
            if component.get("type") == "literal":
                literal_raw = component.get("value", "")
                parts.append(_resolve_variables(str(literal_raw), variables))
            else:
                value = _get_nested_value(json_payload, component.get("value", ""))
                parts.append("" if value is None else str(value))
        try:
            signature_value = _compute_hash_hex(algorithm, "".join(parts))
        except ValueError as error:  # pragma: no cover - configuration error path
            raise ValueError(f"Unable to compute signature for '{target_path}': {error}") from error
        _set_nested_value(json_payload, target_path, signature_value)
        store_name = signature.get("store_as") or signature.get("storeAs")
        if store_name:
            normalized = str(store_name).strip()
            if normalized:
                overrides[normalized] = signature_value
                variables[normalized] = signature_value
    return overrides


def _apply_xml_body_transforms(
    xml_text: str,
    transforms: Dict[str, Any] | None,
    variables: Dict[str, Any],
) -> str:
    if not isinstance(xml_text, str) or not xml_text.strip():
        return xml_text
    if not transforms:
        return xml_text
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return xml_text

    config = transforms or {}

    for override in config.get("overrides", []) or []:
        path = str(override.get("path", "")).strip()
        if not path:
            continue
        raw_value = override.get("value", "")
        resolved_value = _resolve_variables(str(raw_value), variables)
        target = _locate_xml_node(root, path)
        if target is None:
            continue
        target.text = resolved_value

    for signature in config.get("signatures", []) or []:
        target_path = (
            signature.get("target_path")
            or signature.get("targetPath")
            or signature.get("target")
            or ""
        )
        target_path = str(target_path).strip()
        if not target_path:
            continue
        algorithm = str(signature.get("algorithm", "sha512")).lower()
        components = _parse_signature_components(str(signature.get("components", "")))
        if not components:
            continue
        parts: list[str] = []
        for component in components:
            if component.get("type") == "literal":
                literal_raw = component.get("value", "")
                parts.append(_resolve_variables(str(literal_raw), variables))
            else:
                value = _get_xml_node_text(root, component.get("value", ""))
                parts.append("" if value is None else str(value))
        try:
            signature_value = _compute_hash_hex(algorithm, "".join(parts))
        except ValueError as error:  # pragma: no cover - configuration error path
            raise ValueError(f"Unable to compute signature for '{target_path}': {error}") from error
        target_node = _locate_xml_node(root, target_path)
        if target_node is None:
            continue
        target_node.text = signature_value
        store_name = signature.get("store_as") or signature.get("storeAs")
        if store_name:
            normalized = str(store_name).strip()
            if normalized:
                variables[normalized] = signature_value

    return ET.tostring(root, encoding="unicode")


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
        if isinstance(json_payload, dict):
            _apply_body_transforms(json_payload, api_request.body_transforms, variables)
    elif api_request.body_type == models.ApiRequest.BodyTypes.FORM:
        data = _resolve_variables(deepcopy(api_request.body_form), variables)
    elif api_request.body_type == models.ApiRequest.BodyTypes.RAW:
        raw_body = _resolve_variables(api_request.body_raw, variables)
        if isinstance(raw_body, str):
            raw_type = (api_request.body_raw_type or "").lower()
            if raw_type == "xml":
                raw_body = _apply_xml_body_transforms(raw_body, api_request.body_transforms, variables)
        data = raw_body

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


def _extract_postman_scripts(events: Iterable[dict[str, Any]] | None) -> Tuple[str, str]:
    pre_script_lines: List[str] = []
    test_script_lines: List[str] = []
    if not events:
        return "", ""
    for event in events:
        listen = (event or {}).get("listen")
        script = (event or {}).get("script") or {}
        exec_lines = script.get("exec") or []
        if not isinstance(exec_lines, list):
            continue
        text = "\n".join(line for line in exec_lines if isinstance(line, str)).strip()
        if not text:
            continue
        if listen == "prerequest":
            pre_script_lines.append(text)
        elif listen == "test":
            test_script_lines.append(text)
    return "\n\n".join(pre_script_lines), "\n\n".join(test_script_lines)


def _coerce_postman_url(url_payload: Any) -> Tuple[str, Dict[str, Any]]:
    if isinstance(url_payload, str):
        return url_payload, {}
    if not isinstance(url_payload, dict):
        return "", {}
    raw = url_payload.get("raw") or ""
    if not raw:
        host = url_payload.get("host") or []
        path = url_payload.get("path") or []
        if isinstance(host, list) and isinstance(path, list):
            raw = "https://" + ".".join(filter(None, host)) + "/" + "/".join(filter(None, path))
    query_params: Dict[str, Any] = {}
    for entry in url_payload.get("query") or []:
        if not isinstance(entry, dict):
            continue
        key = (entry.get("key") or "").strip()
        if not key:
            continue
        if entry.get("disabled"):
            continue
        query_params[key] = entry.get("value", "")
    return raw, query_params


def _coerce_postman_headers(headers_payload: Any) -> Dict[str, Any]:
    headers: Dict[str, Any] = {}
    for header in headers_payload or []:
        if not isinstance(header, dict):
            continue
        key = (header.get("key") or "").strip()
        if not key or header.get("disabled"):
            continue
        headers[key] = header.get("value", "")
    return headers


def _extract_postman_body(body_payload: Any) -> Tuple[str, Dict[str, Any], Dict[str, Any], str]:
    body_type = models.ApiRequest.BodyTypes.NONE
    body_json: Dict[str, Any] = {}
    body_form: Dict[str, Any] = {}
    body_raw = ""

    if not isinstance(body_payload, dict):
        return body_type, body_json, body_form, body_raw

    mode = body_payload.get("mode")
    if mode == "raw":
        raw_value = body_payload.get("raw") or ""
        language = ((body_payload.get("options") or {}).get("raw") or {}).get("language")
        if language == "json":
            try:
                body_json = json.loads(raw_value) if raw_value else {}
                body_type = models.ApiRequest.BodyTypes.JSON
            except ValueError:
                body_raw = raw_value
                body_type = models.ApiRequest.BodyTypes.RAW
        else:
            body_raw = raw_value
            body_type = models.ApiRequest.BodyTypes.RAW
    elif mode in {"urlencoded", "formdata"}:
        entries = body_payload.get(mode) or []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            if entry.get("type") == "file":
                # Binary form-data entries are not supported yet; skip them.
                continue
            key = (entry.get("key") or "").strip()
            if not key or entry.get("disabled"):
                continue
            body_form[key] = entry.get("value", "")
        if body_form:
            body_type = models.ApiRequest.BodyTypes.FORM
    elif mode == "file":
        body_type = models.ApiRequest.BodyTypes.RAW
        body_raw = ""

    return body_type, body_json, body_form, body_raw


def _extract_postman_auth(auth_payload: Any) -> Tuple[str, Dict[str, Any], str]:
    if not isinstance(auth_payload, dict):
        return models.ApiRequest.AuthTypes.NONE, {}, ""
    auth_type = (auth_payload.get("type") or "none").lower()
    if auth_type == "basic":
        username = ""
        password = ""
        for entry in auth_payload.get("basic") or []:
            if not isinstance(entry, dict):
                continue
            key = entry.get("key")
            if key == "username":
                username = entry.get("value", "")
            elif key == "password":
                password = entry.get("value", "")
        return models.ApiRequest.AuthTypes.BASIC, {"username": username, "password": password}, ""
    if auth_type == "bearer":
        token = ""
        for entry in auth_payload.get("bearer") or []:
            if not isinstance(entry, dict):
                continue
            if entry.get("key") == "token":
                token = entry.get("value", "")
                break
        return models.ApiRequest.AuthTypes.BEARER, {}, token
    return models.ApiRequest.AuthTypes.NONE, {}, ""


def _flatten_postman_items(items: Iterable[dict[str, Any]] | None, parents: Iterable[str] | None = None) -> List[dict[str, Any]]:
    if not items:
        return []
    parents_list = list(parents or [])
    requests: List[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = (item.get("name") or "Untitled").strip() or "Untitled"
        if "item" in item:
            requests.extend(_flatten_postman_items(item.get("item"), parents_list + [name]))
            continue
        request_payload = item.get("request")
        if not isinstance(request_payload, dict):
            continue
        url_value, query_params = _coerce_postman_url(request_payload.get("url"))
        if not url_value:
            continue
        headers = _coerce_postman_headers(request_payload.get("header"))
        body_type, body_json, body_form, body_raw = _extract_postman_body(request_payload.get("body"))
        auth_type, auth_basic, auth_bearer = _extract_postman_auth(request_payload.get("auth"))
        pre_script, test_script = _extract_postman_scripts(item.get("event"))
        display_name = name or url_value
        requests.append(
            {
                "name": display_name,
                "method": (request_payload.get("method") or "GET").upper(),
                "url": url_value,
                "description": item.get("description", ""),
                "headers": headers,
                "query_params": query_params,
                "body_type": body_type,
                "body_json": body_json,
                "body_form": body_form,
                "body_raw": body_raw,
                "auth_type": auth_type,
                "auth_basic": auth_basic,
                "auth_bearer": auth_bearer,
                "pre_request_script": pre_script,
                "tests_script": test_script,
                "timeout_ms": 30000,
                "directory_path": list(parents_list),
            }
        )
    return requests


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
        result = models.ApiRunResult.objects.create(
            run=run,
            request=api_request,
            order=order,
            status=models.ApiRunResult.Status.ERROR,
        )
        try:
            payload = _build_request_payload(api_request, variables, environment)
        except ValueError as exc:
            result.error = str(exc)
            result.save(update_fields=["error", "updated_at"])
            continue
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


@transaction.atomic
def import_postman_collection(collection_payload: Dict[str, Any]) -> models.ApiCollection:
    if not isinstance(collection_payload, dict):
        raise ValueError("Collection payload must be a JSON object.")

    items = collection_payload.get("item")
    if not isinstance(items, list):
        raise ValueError("Collection payload is missing request items.")

    info = collection_payload.get("info") or {}
    name = info.get("name") or "Imported Collection"
    description = info.get("description", "")

    collection = models.ApiCollection.objects.create(name=name, description=description)

    requests_payload = _flatten_postman_items(items)
    if not requests_payload:
        return collection

    directory_cache: Dict[tuple[str, ...], models.ApiCollectionDirectory] = {}
    directory_order: Dict[int | None, int] = {}
    request_order: Dict[int | None, int] = {}

    for request_payload in requests_payload:
        directory_path = request_payload.pop("directory_path", []) or []
        directory_instance: models.ApiCollectionDirectory | None = None
        if directory_path:
            current_parent: models.ApiCollectionDirectory | None = None
            path_so_far: list[str] = []
            for segment in directory_path:
                normalized = (segment or "Untitled").strip() or "Untitled"
                path_so_far.append(normalized)
                path_key = tuple(path_so_far)
                if path_key in directory_cache:
                    current_parent = directory_cache[path_key]
                    continue
                parent_id = current_parent.id if current_parent else None
                next_order = directory_order.get(parent_id, 0)
                current_parent = models.ApiCollectionDirectory.objects.create(
                    collection=collection,
                    parent=current_parent,
                    name=normalized,
                    order=next_order,
                )
                directory_cache[path_key] = current_parent
                directory_order[parent_id] = next_order + 1
            directory_instance = current_parent

        parent_id = directory_instance.id if directory_instance else None
        next_request_order = request_order.get(parent_id, 0)
        request_payload.setdefault("order", next_request_order)
        models.ApiRequest.objects.create(
            collection=collection,
            directory=directory_instance,
            **request_payload,
        )
        request_order[parent_id] = next_request_order + 1

    return collection
