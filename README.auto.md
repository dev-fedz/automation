# Automation project notes

This small Django project implements an admin UI to create TestSuites and TestRequests, run automation (sequential requests) and run a lightweight load test (threaded requests). It stores API responses (JSON, XML, HTML) in `APIResponse`.

See the repository README for references (Django REST, Knox, CORS, Celery, etc.).

Quick start:

1. python -m venv .venv
2. source .venv/Scripts/activate (Windows: .venv\Scripts\activate)
3. pip install -r requirements.txt
4. python manage.py migrate
5. python manage.py createsuperuser
6. python manage.py runserver

From admin: create TestSuite and add TestRequests; select a suite and use action 'Run selected test suites' or 'Start load test...'
