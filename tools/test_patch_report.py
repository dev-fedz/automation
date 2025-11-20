from django.test import RequestFactory
from django.contrib.auth import get_user_model
import json
from apps.core import views, models

User = get_user_model()
user = User.objects.filter(is_active=True).first()
if not user:
    try:
        user = User.objects.create_user('apitestuser3', 'apitest3@example.com', 'password')
    except Exception:
        user = User.objects.filter(is_active=True).first()

report = models.AutomationReport.objects.create(triggered_in='cli-test')
rf = RequestFactory()
body = json.dumps({'total_passed': 0, 'total_failed': 1, 'total_blocked': 5, 'finished': '2025-11-19T00:00:00Z'})
req = rf.patch(f'/api/core/automation-report/{report.pk}/', data=body, content_type='application/json')
req.user = user
# bypass CSRF checks when invoking view directly in test-like context
try:
    req._dont_enforce_csrf_checks = True
except Exception:
    pass

resp = views.AutomationReportDetailView.as_view()(req, pk=report.pk)
print('status', getattr(resp, 'status_code', None))
try:
    print(resp.data)
except Exception:
    print('no json')

report.refresh_from_db()
print('db', report.pk, report.report_id, report.total_passed, report.total_failed, report.total_blocked, report.finished)
