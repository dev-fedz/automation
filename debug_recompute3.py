from django.utils import timezone
from apps.core import models, services

report = models.AutomationReport.objects.filter(triggered_in__startswith='automation > debug').order_by('-created_at').first()
if not report:
    print('No report found')
else:
    qs = models.ApiRunResultReport.objects.filter(automation_report=report, testcase__isnull=False)
    print('qs count', qs.count())
    latest_per_tc_qs = qs.order_by('testcase', '-created_at').distinct('testcase')
    latest_list = list(latest_per_tc_qs)
    print('latest_list length', len(latest_list))
    for r in latest_list:
        print('ROW', r.id, 'status', r.status, 'tc', getattr(r.testcase, 'testcase_id', None))
    statuses = [((getattr(r, 'status', '') or '') or '').lower() for r in latest_list]
    print('computed statuses', statuses)
    print('counts passed', statuses.count('passed'), 'failed', statuses.count('failed'))
    print('Calling recompute now...')
    services.recompute_automation_report_totals(report)
    report.refresh_from_db()
    print('After recompute totals:', report.total_passed, report.total_failed, report.total_blocked, 'finished', report.finished)
