#!/usr/bin/env python3
import os
import json

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django

django.setup()

from apps.core import models
from django.test import Client

def main():
    vars_map = {
      "amount": "100.00",
      "pmethod": "nonbank_otc",
      "pchannel": "711_ph",
      "realtime_mid": "0000001404114A546C5D",
      "realtime_mkey": "13ADA55C6A72E2FF0284DF82B80CFA74",
      "non_realtime_mid": "0000004598159J0T0D7E",
      "non_realtime_mkey": "TDB5BTDO6X016CTR6WDRQ4EO58U3GQL1",
      "realtime_password": "p45jr5taqkc22al",
      "realtime_username": "pnx_test",
      "non_integ_password": "AK122fxQmY",
      "non_integ_username": "pnx_test_dev_integ",
      "non_integ_channel_key": "2KX8TDISYL3RGANW15MQ9BEOUC4JPZ6H",
      "non_realtime_password": "qa^x4nn3e",
      "non_realtime_username": "qamidfalse"
    }

    env = models.ApiEnvironment.objects.filter(pk=1).first()
    if not env:
        print(json.dumps({'error': 'ApiEnvironment pk=1 not found'}))
        return
    env.variables = vars_map
    env.save()
    print(json.dumps({'updated_env_id': env.id, 'variables': env.variables}))

    # build execute payload from ApiRequest pk=2
    req = models.ApiRequest.objects.filter(pk=2).first()
    if not req:
        print(json.dumps({'error': 'ApiRequest pk=2 not found'}))
        return

    payload = {}
    payload['method'] = req.method
    payload['url'] = req.url
    payload['headers'] = req.headers or {}
    payload['params'] = req.query_params or {}
    if req.body_type == 'json':
        payload['json'] = req.body_json
    elif req.body_type == 'raw':
        payload['body'] = req.body_raw
    elif req.body_type == 'form':
        payload['form_data'] = [{'key': k, 'type': 'text', 'value': v} for k, v in (req.body_form or {}).items()]
    payload['collection_id'] = req.collection_id
    payload['environment'] = 1
    payload['body_transforms'] = req.body_transforms

    client = Client()
    User = __import__('django.contrib.auth').contrib.auth.get_user_model()
    user = User.objects.filter(is_active=True).first()
    if not user:
        user = User.objects.create_superuser('tempuser','temp@example.com','temppass')
    client.force_login(user)

    resp = client.post('/api/core/tester/execute/', data=json.dumps(payload), content_type='application/json')
    out = {'status': resp.status_code}
    try:
        out['json'] = resp.json()
    except Exception:
        out['text'] = resp.content.decode('utf-8', errors='replace')
    print(json.dumps({'execute_response': out}, indent=2))

if __name__ == '__main__':
    main()
