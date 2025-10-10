from django.contrib import admin

from . import models


class ApiRequestInline(admin.TabularInline):
    model = models.ApiRequest
    extra = 0
    fields = [
        "name",
        "method",
        "url",
        "order",
    ]
    ordering = ("order",)


@admin.register(models.ApiCollection)
class ApiCollectionAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "created_at")
    search_fields = ("name", "description", "slug")
    inlines = [ApiRequestInline]
    filter_horizontal = ("environments",)


@admin.register(models.ApiEnvironment)
class ApiEnvironmentAdmin(admin.ModelAdmin):
    list_display = ("name", "created_at", "updated_at")
    search_fields = ("name", "description")


@admin.register(models.ApiRun)
class ApiRunAdmin(admin.ModelAdmin):
    list_display = ("id", "collection", "status", "started_at", "finished_at")
    list_filter = ("status", "collection")
    search_fields = ("collection__name",)
    date_hierarchy = "started_at"


@admin.register(models.ApiRunResult)
class ApiRunResultAdmin(admin.ModelAdmin):
    list_display = ("id", "run", "request", "status", "response_status")
    list_filter = ("status", "run__collection")
    search_fields = ("run__collection__name", "request__name")


@admin.register(models.ApiRequest)
class ApiRequestAdmin(admin.ModelAdmin):
    list_display = ("name", "collection", "method", "order")
    list_filter = ("collection", "method")
    search_fields = ("name", "url", "collection__name")


@admin.register(models.ApiAssertion)
class ApiAssertionAdmin(admin.ModelAdmin):
    list_display = ("request", "type", "field", "comparator")
    list_filter = ("type", "comparator")
    search_fields = ("request__name", "field")
