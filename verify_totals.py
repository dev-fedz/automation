from django.utils import timezone
from apps.core import models, services

# create a report + run container
report = models.AutomationReport.objects.create(triggered_in="automation > example", started=timezone.now())

run = models.ApiRun.objects.create(status=models.ApiRun.Status.RUNNING, started_at=timezone.now())

# helper to create project/scenario/testcase
def create_tc(project_name, module_title, scenario_title, tc_id):
    project, _ = models.Project.objects.get_or_create(name=project_name)
    module, _ = models.TestModules.objects.get_or_create(title=module_title, project=project)
    scenario, _ = models.TestScenario.objects.get_or_create(project=project, module=module, title=scenario_title)
    tc, _ = models.TestCase.objects.get_or_create(scenario=scenario, testcase_id=tc_id)
    return tc

# Build example from your description:
# First Module:
# - Scenario 1: 4 testcases -> 1 FAILED, 3 BLOCKED
tc_a1 = create_tc("ProjA", "Module1", "Scenario1", "A1")
tc_a2 = create_tc("ProjA", "Module1", "Scenario1", "A2")
tc_a3 = create_tc("ProjA", "Module1", "Scenario1", "A3")
tc_a4 = create_tc("ProjA", "Module1", "Scenario1", "A4")
# Scenario 2: 1 testcase BLOCKED
tc_a5 = create_tc("ProjA", "Module1", "Scenario2", "A5")

# Second Module:
# Scenario 1: 1 testcase BLOCKED
tc_b1 = create_tc("ProjB", "Module2", "Scenario1", "B1")

# Create result rows: one FAILED, rest are blocked (use ERROR as blocked)
models.ApiRunResultReport.objects.create(run=run, testcase=tc_a1, status=models.ApiRunResult.Status.FAILED, automation_report=report)
models.ApiRunResultReport.objects.create(run=run, testcase=tc_a2, status=models.ApiRunResult.Status.ERROR, automation_report=report)
models.ApiRunResultReport.objects.create(run=run, testcase=tc_a3, status=models.ApiRunResult.Status.ERROR, automation_report=report)
models.ApiRunResultReport.objects.create(run=run, testcase=tc_a4, status=models.ApiRunResult.Status.ERROR, automation_report=report)
models.ApiRunResultReport.objects.create(run=run, testcase=tc_a5, status=models.ApiRunResult.Status.ERROR, automation_report=report)
models.ApiRunResultReport.objects.create(run=run, testcase=tc_b1, status=models.ApiRunResult.Status.ERROR, automation_report=report)

# Recompute totals for the report (the helper I added)
services.recompute_automation_report_totals(report)

# refresh from db and print results
report.refresh_from_db()
print("total_passed:", report.total_passed)
print("total_failed:", report.total_failed)
print("total_blocked:", report.total_blocked)
