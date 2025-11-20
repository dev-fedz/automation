from django.utils import timezone
from apps.core import models, services

# Create a fresh report and run
report = models.AutomationReport.objects.create(triggered_in="automation > debug", started=timezone.now())
run = models.ApiRun.objects.create(status=models.ApiRun.Status.RUNNING, started_at=timezone.now())

# helper to create project/scenario/testcase
def create_tc(project_name, module_title, scenario_title, tc_id):
    project, _ = models.Project.objects.get_or_create(name=project_name)
    module, _ = models.TestModules.objects.get_or_create(title=module_title, project=project)
    scenario, _ = models.TestScenario.objects.get_or_create(project=project, module=module, title=scenario_title)
    tc, _ = models.TestCase.objects.get_or_create(scenario=scenario, testcase_id=tc_id)
    return tc

# Create testcases
tc1 = create_tc('D1', 'M1', 'S1', 'D1-1')
tc2 = create_tc('D1', 'M1', 'S1', 'D1-2')

# Create report rows
r1 = models.ApiRunResultReport.objects.create(run=run, testcase=tc1, status=models.ApiRunResultReport.Status.PASSED, automation_report=report)
r2 = models.ApiRunResultReport.objects.create(run=run, testcase=tc2, status=models.ApiRunResultReport.Status.FAILED, automation_report=report)

print('Before recompute:')
qs = models.ApiRunResultReport.objects.filter(automation_report=report).order_by('testcase', '-created_at')
for row in qs:
    print('id', row.id, 'tc', getattr(row.testcase, 'testcase_id', None), 'status', row.status, 'created_at', row.created_at)

print('qs.exists()', qs.exists(), 'count', qs.count())

services.recompute_automation_report_totals(report)
report.refresh_from_db()
print('After recompute totals: passed', report.total_passed, 'failed', report.total_failed, 'blocked', report.total_blocked, 'finished', report.finished)
