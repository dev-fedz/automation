import random
from django.contrib.auth.hashers import check_password
from django.contrib.auth.password_validation import validate_password
from rest_framework import exceptions
from django.db import transaction
from django.contrib.auth.models import Group

from . import models
import os, time
try:  # optional redis dependency
    import redis  # type: ignore
except Exception:  # pragma: no cover
    redis = None  # type: ignore

_redis_client = None
def _get_redis():
    global _redis_client
    if _redis_client is None:
        url = os.environ.get('REDIS_URL')
        if not url:
            return None
        try:
            if redis is None:
                return None
            _redis_client = redis.from_url(url)
        except Exception:  # pragma: no cover
            _redis_client = None
    return _redis_client

RATE_LIMIT_KEY = 'login:rate:{email}'
RATE_LIMIT_MAX_ATTEMPTS = int(os.environ.get('LOGIN_RATE_LIMIT_MAX', '10'))
RATE_LIMIT_WINDOW_SEC = int(os.environ.get('LOGIN_RATE_LIMIT_WINDOW', '60'))


def log_user_action(*, user: models.User | None, action: models.UserAuditTrail.Actions):
    if not user:
        return
    try:
        if hasattr(user, 'is_authenticated') and not user.is_authenticated:
            return
    except Exception:
        return
    models.UserAuditTrail.objects.create(user=user, action=action)

def rate_limit_check(email: str):
    client = _get_redis()
    if not client:
        return True  # no redis means no rate limit
    key = RATE_LIMIT_KEY.format(email=email)
    p = client.pipeline()
    p.incr(key)
    p.expire(key, RATE_LIMIT_WINDOW_SEC)
    attempts, _ = p.execute()
    if int(attempts) > RATE_LIMIT_MAX_ATTEMPTS:
        return False
    return True


def generate_password(n: int):
    characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123456789!@#$%^&*()"
    return ''.join(random.sample(characters, n))


def generate_otp(n: int):
    return ''.join(random.sample('0123456789', n))


def password_validate(*, user: models.User, password: str) -> bool:
    if not check_password(password, user.password):
        raise exceptions.ValidationError('Incorrect Current Password.')
    return True


def password_change(*, user: models.User, data: dict) -> bool:
    current_password = data.get('current_password')
    password = data.get('password1')
    if not check_password(current_password, user.password):
        raise exceptions.ValidationError('Incorrect Current Password.')
    if password != data.get('password2'):
        raise exceptions.ValidationError('New Passwords do not match.')
    try:
        validate_password(password=password)
    except exceptions.ValidationError as e:  # noqa: PERF203
        raise exceptions.ValidationError({'password1': list(e.messages)})
    user.set_password(password)
    user.is_temporary = False
    user.save()
    return True


def forget_password(*, user: models.User, data: dict) -> bool:
    password = data.get('password1')
    if password != data.get('password2'):
        raise exceptions.ValidationError("Passwords didn't match")
    try:
        validate_password(password=password)
    except exceptions.ValidationError as e:
        raise exceptions.ValidationError({'password1': list(e.messages)})
    user.set_password(password)
    user.otp = None
    user.login_attempt = 0
    user.status = 'U'
    user.save()
    return True


def user_create(*, data: dict, creator: models.User):
    role = data.pop('role')
    pw = generate_password(12)
    user = models.User.objects.create(is_staff=True, **data)
    user.groups.add(role)
    user.set_password(pw)
    user.is_temporary = True
    user.save()
    return user


def temporary_password(*, user: models.User):
    pw = generate_password(12)
    user.set_password(pw)
    user.status = 'U'
    user.login_attempt = 0
    user.is_temporary = True
    user.save()
    return True


def otp(*, user: models.User):
    code = generate_otp(6)
    user.otp = code
    user.save()
    return True


def user_update(*, user: models.User, data: dict):
    role = data.pop('role', None)
    for k, v in data.items():
        setattr(user, k, v)
    if user.status == 'U':
        user.login_attempt = 0
    user.save()
    if role:
        user.groups.set([role])
    return user


def login_attempts(email: str):
    user = models.User.objects.filter(email=email).first()
    if user:
        if user.login_attempt >= 2:
            user.status = 'L'
        if user.login_attempt < 3:
            user.login_attempt += 1
            user.save()


@transaction.atomic
def role_create(*, data: dict):
    role_modules = data.pop('role_modules')
    role = Group.objects.create(name=data.get('name'))
    if role_modules:
        role_module_create(role_modules=role_modules, role=role)
    return role


@transaction.atomic
def role_update(*, role: Group, data: dict):
    role_modules = data.pop('role_modules', None)
    for field, value in data.items():
        setattr(role, field, value)
    role.save()
    # IMPORTANT: an empty list means "clear all modules/permissions".
    # Only skip role-module updates when the client did not send role_modules at all.
    if role_modules is not None:
        # Clear existing permission relations and role-module associations before re-adding
        role.permissions.clear()
        role.rolemodule_set.all().delete()
        # Also detach m2m modules (cleanup any stale cached rels)
        role.modules.clear()
        role_module_create(role_modules=role_modules, role=role)
    return role


def role_module_create(*, role_modules: list[dict], role: Group):
    from .models import RoleModule, Module  # local import to avoid circular
    for rm in role_modules:
        module_id = rm.get('module')
        if not module_id:
            continue
        try:
            module_obj = Module.objects.get(pk=module_id)
        except Module.DoesNotExist:
            continue  # skip invalid module id
        permissions = rm.get('permissions') or []
        rm_obj = role.rolemodule_set.create(module=module_obj)
        if permissions:
            rm_obj.permissions.add(*permissions)
            role.permissions.add(*permissions)


def role_destroy(*, role: Group):
    role.rolemodule_set.all().delete()
    return role.delete()
