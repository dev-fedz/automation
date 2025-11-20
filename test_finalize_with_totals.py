from django.utils import timezone
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from apps.core import models

User = get_user_model()
user, _ = User.objects.get_or_create(username='apitestuser')
# create report and sample rows
report = models.AutomationReport.objects.create(triggered_in='api-test-finalize', started=timezone.now())
run = models.ApiRun.objects.create(status=models.ApiRun.Status.RUNNING, started_at=timezone.now())
# create testcase and a single result (we'll rely on totals payload for final counts)
project, _ = models.Project.objects.get_or_create(name='FinalProject')
module, _ = models.TestModules.objects.get_or_create(title='FinalModule', project=project)
scenario, _ = models.TestScenario.objects.get_or_create(project=project, module=module, title='FinalScenario')
(tc, _ ) = models.TestCase.objects.get_or_create(scenario=scenario, testcase_id='F1')
models.ApiRunResultReport.objects.create(run=run, testcase=tc, status=models.ApiRunResultReport.Status.FAILED, automation_report=report)

client = APIClient()
client.force_authenticate(user=user)
# send totals that include blocked cases
payload = {'report_id': report.id, 'totals': {'passed': 0, 'failed': 1, 'blocked': 5}}
resp = client.post('/api/core/automation-report/finalize/', payload, format='json')
print('status', resp.status_code)
try:
    print('resp json', resp.json())
except Exception:
    print('resp text', resp.text)
report.refresh_from_db()
print('report totals', report.total_passed, report.total_failed, report.total_blocked, 'finished', report.finished)
