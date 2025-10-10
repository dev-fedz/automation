from . import models


def active_staff_get():
    return models.User.active_objects.filter(is_staff=True)


def module_list():
    modules = []
    modules_exclude = [models.Module.Categories.BASE]
    for category in models.Module.Categories:
        if category.value not in modules_exclude:
            modules.append({
                'category': category,
                'modules': models.Module.objects.filter(category=category),
            })
    return modules


def user_role_modules_get(*, user: models.User):
    role_modules = models.RoleModule.objects.none()
    if user.is_superuser:
        role_modules = models.RoleModule.objects.all()
    else:
        for role in user.groups.all():
            role_modules = role_modules.union(role.rolemodule_set.all())
    return role_modules


def user_role_modules_data_get(*, user: models.User):
    role_modules = user_role_modules_get(user=user)
    result = []
    for rm in role_modules:
        perms = [p.codename for p in rm.permissions.all()]
        result.append({
            'name': rm.module.name,
            'description': rm.module.description,
            'codename': rm.module.codename,
            'permissions': perms,
        })
    # dedupe by codename
    dedup = {}
    for item in result:
        dedup[item['codename']] = item
    return list(dedup.values())
