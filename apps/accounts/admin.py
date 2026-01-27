from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.utils.safestring import mark_safe

from . import models, services


@admin.register(models.User)
class UserAdmin(DjangoUserAdmin):
    list_display = (
        'username',
        'email',
        'first_name',
        'last_name',
        'is_staff',
        'two_factor_enabled',
    )
    list_filter = DjangoUserAdmin.list_filter + ('two_factor_enabled',)
    readonly_fields = ('two_factor_qr',)

    fieldsets = DjangoUserAdmin.fieldsets + (
        ('Two-Factor Authentication', {
            'fields': ('two_factor_enabled', 'two_factor_secret', 'two_factor_qr'),
        }),
    )

    actions = ['action_reset_2fa', 'action_disable_2fa']

    def two_factor_qr(self, obj):
        if not obj.two_factor_secret:
            return 'No secret set'
        otpauth_url = services.two_factor_build_uri(user=obj, secret=obj.two_factor_secret)
        qr = services.two_factor_qr_data_uri(otpauth_url=otpauth_url)
        return mark_safe(f"<img src='{qr}' alt='2FA QR' style='max-width:220px;' />")
    two_factor_qr.short_description = '2FA QR code'

    @admin.action(description='Reset 2FA secret (keeps disabled until confirmed)')
    def action_reset_2fa(self, request, queryset):
        for user in queryset:
            user.two_factor_secret = services.two_factor_generate_secret()
            user.two_factor_enabled = False
            user.save(update_fields=['two_factor_secret', 'two_factor_enabled'])

    @admin.action(description='Disable 2FA')
    def action_disable_2fa(self, request, queryset):
        queryset.update(two_factor_enabled=False)
