from django.utils import timezone
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from apps.core import models

User = get_user_model()
user, _ = User.objects.get_or_create(username='apitestuser')
client = APIClient()
client.force_authenticate(user=user)

# Create report via API
resp = client.post('/api/core/automation-report/create/', {'triggered_in': 'smoke-test'}, format='json')
print('create status', resp.status_code)
print('create resp', resp.json())
if resp.status_code != 201:
    raise SystemExit('create failed')
report = models.AutomationReport.objects.get(pk=resp.json()['id'])
print('created report', report.id, report.report_id)

# Call execute with automation_report_id
payload = {
    'method': 'GET',
    'url': 'https://example.com',
    'headers': {},
    'params': {},
    'timeout': 5,
    'automation_report_id': report.id,
}
exec_resp = client.post('/api/core/tester/execute/', payload, format='json')
print('execute status', exec_resp.status_code)
try:
    print('execute resp', exec_resp.json())
except Exception:
    print('execute text', exec_resp.text)

# Inspect report-linked ApiRunResultReport rows
from django.db import connection
print('db vendor', connection.vendor)

linked = list(models.ApiRunResultReport.objects.filter(automation_report=report).values('id','status','testcase_id','created_at'))
print('linked rows', linked)
