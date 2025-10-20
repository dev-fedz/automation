from django.test import Client
import re, json

c = Client()
ok = c.login(username="admin@example.com", password="password")
print("login_ok", ok)
r = c.get('/automation/test-plans/')
html = r.content.decode('utf-8')


def extract(id):
    m = re.search(r'<script id="%s" type="application/json">(.*?)</script>' % id, html, flags=re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception as e:
        print('json error', id, e)
        return None

sel = extract('automation-initial-risk-mitigations-for-selected')
by = extract('automation-initial-risk-mitigations-by-plan')
allm = extract('automation-initial-risk-mitigations')
api = extract('automation-api-endpoints')
plans = extract('automation-initial-plans')

print('selected_present', sel is not None)
print('selected_len', len(sel) if isinstance(sel, list) else type(sel))
print('by_present', by is not None)
if isinstance(by, dict):
    print('by_keys', sorted(list(by.keys())))
    for k in sorted(by.keys()):
        print('by', k, 'len', len(by[k]) if isinstance(by[k], list) else type(by[k]))
else:
    print('by_keys', type(by))
print('all_present', allm is not None)
print('all_len', len(allm) if isinstance(allm, list) else type(allm))
print('api_endpoints', api)
print('plans_count', len(plans) if isinstance(plans, list) else type(plans))
if isinstance(plans, list) and plans:
    print('server_selected_plan_id:', plans[0].get('id'))
