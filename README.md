## Dev Setup Requirements

- [Docker (18.06.0+)](https://docs.docker.com/engine/install/)
- [Docker Compose](https://docs.docker.com/compose/install/)

## Django Style Guide

I followed [HackSoftware's Django Style Guide](https://github.com/HackSoftware/Django-Styleguide)
to create scalable and testable Django code.

The most important concept is [Services](https://github.com/HackSoftware/Django-Styleguide#services)
where the business logic lives.

# Authentication: Django REST Knox
https://james1345.github.io/django-rest-knox/

# dj-rest-auth
https://dj-rest-auth.readthedocs.io/en/latest/

# Django REST Framework
https://www.django-rest-framework.org/

# Django JS Reverse
https://github.com/ierror/django-js-reverse

# CORS
https://github.com/adamchainz/django-cors-headers

# Celery
http://docs.celeryproject.org/en/latest/userguide/configuration.html


## Creds:
```bash
admin@example.com
password
```
## Run Init User Modules for Admin
```bash
docker compose run automation python manage.py makemigrations
docker compose run automation python manage.py migrate
docker compose run automation pip install -r requirements.txt
docker compose run automation python manage.py collectstatic --noinput
docker compose run automation python manage.py createsuperuser
docker compose run automation python manage.py check
docker compose run automation python manage.py test
docker compose up --build automation
docker compose exec automation  python manage.py init_modules
docker compose exec automation python manage.py init_module_permissions
docker compose exec automation python manage.py  init_superuser_role
docker compose exec automation python manage.py  seed_accounts
```