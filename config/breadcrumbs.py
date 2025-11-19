from django.urls import resolve


def build_breadcrumbs(request):
    """Return a list of breadcrumb segments for the current request.

    Each segment is a dict: {'label': 'Users', 'url': '/users/'} or final item without url.
    """
    breadcrumbs = [{'label': 'Home', 'url': '/'}]

    try:
        match = resolve(request.path_info)
        name = match.url_name or ''
    except Exception:
        name = ''

    # Top-level mappings
    if name in ('dashboard', 'dashboard_redirect'):
        breadcrumbs.append({'label': 'Dashboard'})
        return {'BREADCRUMBS': breadcrumbs}

    # User management group
    user_names = {
        'user-list-page': ('User Management', 'Users', '/users/'),
        'user-create-page': ('User Management', 'Users', '/users/create/'),
        'user-detail-page': ('User Management', 'Users', None),
        'user-edit-page': ('User Management', 'Users', None),
    }
    role_names = {
        'role-list-page': ('User Management', 'Role', '/roles/'),
        'role-create-page': ('User Management', 'Role', '/roles/create/'),
        'role-detail-page': ('User Management', 'Role', None),
        'role-edit-page': ('User Management', 'Role', None),
    }

    if name in user_names:
        group, item_label, url = user_names[name]
        breadcrumbs.append({'label': group})
        if url:
            breadcrumbs.append({'label': item_label, 'url': url})
        else:
            breadcrumbs.append({'label': item_label, 'url': '/users/'})
            # detail/edit/create will be appended below

        # action mapping
        if name == 'user-create-page':
            breadcrumbs.append({'label': 'Create'})
        elif name == 'user-edit-page':
            breadcrumbs.append({'label': 'Update'})
        elif name == 'user-detail-page':
            breadcrumbs.append({'label': 'View'})

        return {'BREADCRUMBS': breadcrumbs}

    if name in role_names:
        group, item_label, url = role_names[name]
        breadcrumbs.append({'label': group})
        if url:
            breadcrumbs.append({'label': item_label, 'url': url})
        else:
            breadcrumbs.append({'label': item_label, 'url': '/roles/'})

        if name == 'role-create-page':
            breadcrumbs.append({'label': 'Create'})
        elif name == 'role-edit-page':
            breadcrumbs.append({'label': 'Edit'})
        elif name == 'role-detail-page':
            breadcrumbs.append({'label': 'View'})

        return {'BREADCRUMBS': breadcrumbs}

    # Generic mappings for other pages (projects, automation, etc.)
    generic_map = {
        'automation-overview': ('Automation',),
        'automation-run': ('Automation', 'Run'),
    'automation-test-plans': ('Projects', 'Project'),
    'data-management-test-modules': ('Projects', 'Modules'),
        'automation-test-scenarios': ('Projects', 'Scenarios'),
        'automation-test-cases': ('Projects', 'Test Case'),
        'api-tester': ('API Tester',),
    }

    if name in generic_map:
        parts = generic_map[name]
        for p in parts:
            breadcrumbs.append({'label': p})
        return {'BREADCRUMBS': breadcrumbs}

    return {'BREADCRUMBS': breadcrumbs}
