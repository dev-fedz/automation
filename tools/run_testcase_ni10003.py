#!/usr/bin/env python3
"""Execute TestCase NI10003 with dependency and decrypt the response body."""

import base64
import json
import os
import random
import string
import sys
from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path

import requests

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

try:
    import django
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import pad, unpad
except ImportError as exc:  # pragma: no cover - dependency guard
    sys.stderr.write("Missing dependency: {}\n".format(exc))
    sys.exit(1)

django.setup()

from apps.core.models import ApiRequest  # noqa: E402


def aes_encrypt(plaintext: str, key_bytes: bytes, iv_bytes: bytes) -> str:
    cipher = AES.new(key_bytes, AES.MODE_CBC, iv_bytes)
    data = pad(plaintext.encode("utf-8"), AES.block_size)
    return base64.b64encode(cipher.encrypt(data)).decode("utf-8")


def aes_decrypt(encoded: str, key_bytes: bytes, iv_bytes: bytes) -> str:
    cipher = AES.new(key_bytes, AES.MODE_CBC, iv_bytes)
    decrypted = cipher.decrypt(base64.b64decode(encoded))
    return unpad(decrypted, AES.block_size).decode("utf-8")


def run_dependency() -> dict:
    """Execute ApiRequest 56 and return the parsed JSON body."""
    request = ApiRequest.objects.get(pk=56)
    body = deepcopy(request.body_json)
    transaction = body["transaction"]
    customer = body["customer_info"]

    suffix = datetime.utcnow().strftime("%Y%m%d%H%M%S") + "".join(
        random.choices(string.ascii_uppercase + string.digits, k=4)
    )
    transaction["request_id"] = f"OTCFALSEqaFP{suffix[-6:]}"
    future_expiry = datetime.utcnow() + timedelta(days=2)
    transaction["expiry_limit"] = future_expiry.strftime("%Y-%m-%dT%H:%M:%S+08:00")

    merchant_id = "0000004598159J0T0D7E"
    merchant_key = "TDB5BTDO6X016CTR6WDRQ4EO58U3GQL1"
    raw_trx = (
        merchant_id
        + transaction["request_id"]
        + transaction.get("notification_url", "")
        + (transaction.get("response_url") or "")
        + (transaction.get("cancel_url") or "")
        + transaction.get("pmethod", "")
        + transaction.get("payment_action", "")
        + transaction.get("collection_method", "")
        + transaction.get("amount", "")
        + transaction.get("currency", "")
        + transaction.get("payment_notification_status", "")
        + (transaction.get("payment_notification_channel") or "")
        + merchant_key
    )
    transaction["signature"] = hashlib_sha512(raw_trx)

    raw_customer = (
        (customer.get("fname") or "")
        + (customer.get("lname") or "")
        + (customer.get("mname") or "")
        + (customer.get("email") or "")
        + ((customer.get("phone") or "") if customer.get("phone") is not None else "")
        + (customer.get("mobile") or "")
        + (customer.get("dob") or "")
        + merchant_key
    )
    customer["signature"] = hashlib_sha512(raw_customer)

    headers = {k: v for k, v in (request.headers or {}).items() if v}
    timeout = max(1, request.timeout_ms) / 1000
    auth = (
        request.auth_basic.get("username", ""),
        request.auth_basic.get("password", ""),
    )

    response = requests.post(
        request.url,
        headers=headers,
        json=body,
        timeout=timeout,
        auth=auth,
    )
    print(f"[dependency] status={response.status_code}")
    try:
        payload = response.json()
    except ValueError as error:
        print("[dependency] raw response:", response.text)
        raise SystemExit(error) from error
    print("[dependency] body:", json.dumps(payload, indent=2))
    if response.status_code != 200:
        raise SystemExit("Dependency request failed")
    return payload


def hashlib_sha512(message: str) -> str:
    import hashlib

    return hashlib.sha512(message.encode("utf-8")).hexdigest()


def resolve_pay_reference(payload: dict) -> str:
    pay_ref = payload.get("pay_reference")
    if pay_ref:
        return pay_ref
    entries = payload.get("direct_otc_info")
    if isinstance(entries, list):
        for item in entries:
            if isinstance(item, dict) and item.get("pay_reference"):
                return item["pay_reference"]
    raise SystemExit("Unable to determine pay_reference from dependency response")


def run_validation(pay_reference: str) -> tuple[dict, dict]:
    request = ApiRequest.objects.get(pk=34)
    body = deepcopy(request.body_json)

    key_bytes = b"kRdVzIqmQsfpRGItSLP5SDz0jkRLO9Cm"
    iv_bytes = b"1gJFNMeeQODA7wJA"
    channel_key = "dgzCF9eJw2uX9LNV4JrkQLxSHxBlZeGV"

    envelope = {
        "pchannel": "sbc_ph",
        "amount": "1.00",
        "pay_reference": pay_reference,
    }
    signature_input = (
        envelope["amount"]
        + envelope["pay_reference"]
        + envelope["pchannel"]
        + channel_key
    )
    envelope["signature"] = aes_encrypt(signature_input, key_bytes, iv_bytes)

    encrypted_data = aes_encrypt(json.dumps(envelope, separators=(",", ":")), key_bytes, iv_bytes)
    body["data"] = encrypted_data

    headers = {k: v for k, v in (request.headers or {}).items() if v}
    timeout = max(1, request.timeout_ms) / 1000
    auth = (
        request.auth_basic.get("username", ""),
        request.auth_basic.get("password", ""),
    )

    response = requests.post(
        request.url,
        headers=headers,
        json=body,
        timeout=timeout,
        auth=auth,
    )
    print(f"[validate] status={response.status_code}")
    try:
        payload = response.json()
    except ValueError as error:
        print("[validate] raw response:", response.text)
        raise SystemExit(error) from error
    print("[validate] body:", json.dumps(payload, indent=2))
    if response.status_code != 200:
        raise SystemExit("Validation request failed")

    decrypted = None
    encrypted_field = payload.get("data")
    if encrypted_field:
        try:
            decrypted_text = aes_decrypt(encrypted_field, key_bytes, iv_bytes)
            decrypted = json.loads(decrypted_text)
            print("[validate] decrypted:", json.dumps(decrypted, indent=2))
        except Exception as error:
            print("[validate] failed to decrypt:", error)
    else:
        print("[validate] no encrypted data present in response")

    return payload, decrypted or {}


def main() -> None:
    dependency_payload = run_dependency()
    pay_reference = resolve_pay_reference(dependency_payload)
    print(f"[dependency] pay_reference={pay_reference}")
    _, decrypted = run_validation(pay_reference)
    print("[result] decrypted payload:")
    print(json.dumps(decrypted, indent=2))
    expected_code = "GR121"
    actual_code = decrypted.get("response_code")
    print(f"[result] decrypted response_code={actual_code}")
    print(f"[result] expected response_code={expected_code}")
    print(f"[result] matches expected? {actual_code == expected_code}")


if __name__ == "__main__":
    main()
