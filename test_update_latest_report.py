from django.utils import timezone
from apps.core import models

report = models.AutomationReport.objects.order_by('-created_at').first()
if not report:
    print('No AutomationReport found')
else:
    print('Before:', report.id, report.report_id, report.total_passed, report.total_failed, report.total_blocked, report.finished)
    report.total_passed = 0
    report.total_failed = 1
    report.total_blocked = 5
    report.finished = timezone.now()
    report.save(update_fields=['total_passed','total_failed','total_blocked','finished'])
    report.refresh_from_db()
    print('After:', report.id, report.report_id, report.total_passed, report.total_failed, report.total_blocked, report.finished)
