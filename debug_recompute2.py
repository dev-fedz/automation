from django.utils import timezone
from apps.core import models

report = models.AutomationReport.objects.filter(triggered_in__startswith='automation > debug').order_by('-created_at').first()
if not report:
    print('No report found')
else:
    qs = models.ApiRunResultReport.objects.filter(automation_report=report, testcase__isnull=False)
    print('qs count', qs.count())
    try:
        latest_per_tc = qs.order_by('testcase', '-created_at').distinct('testcase')
        print('latest_per_tc count', latest_per_tc.count())
        print('latest_per_tc list:')
        for r in latest_per_tc:
            print('id', r.id, 'tc', getattr(r.testcase, 'testcase_id', None), 'status', r.status)
        print('filter passed', latest_per_tc.filter(status='passed').count())
        print('filter failed', latest_per_tc.filter(status='failed').count())
        print('filter error', latest_per_tc.filter(status='error').count())
    except Exception as exc:
        import traceback
        traceback.print_exc()
        print('exception', exc)
