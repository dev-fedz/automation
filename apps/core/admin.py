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


@admin.register(models.TestPlan)
class TestPlanAdmin(admin.ModelAdmin):
    list_display = ("name", "approver", "created_at", "updated_at")
    search_fields = ("name", "objective", "approver")
    ordering = ("name",)


@admin.register(models.TestPlanMaintenance)
class TestPlanMaintenanceAdmin(admin.ModelAdmin):
    list_display = ("plan", "version", "effective_date", "updated_by", "approved_by")
    search_fields = ("plan__name", "version", "summary")
    list_filter = ("effective_date", "plan")


@admin.register(models.TestScenario)
class TestScenarioAdmin(admin.ModelAdmin):
    list_display = ("title", "plan", "created_at")
    search_fields = ("title", "description", "plan__name")
    list_filter = ("plan",)


@admin.register(models.TestCase)
class TestCaseAdmin(admin.ModelAdmin):
    list_display = ("title", "scenario", "priority", "owner")
    search_fields = ("title", "description", "scenario__title")
    list_filter = ("scenario__plan", "priority")


@admin.register(models.Risk)
class RiskAdmin(admin.ModelAdmin):
    list_display = ("title", "created_at", "updated_at")
    search_fields = ("title", "description")


@admin.register(models.MitigationPlan)
class MitigationPlanAdmin(admin.ModelAdmin):
    list_display = ("title", "created_at", "updated_at")
    search_fields = ("title", "description")


@admin.register(models.RiskAndMitigationPlan)
class RiskAndMitigationPlanAdmin(admin.ModelAdmin):
    list_display = ("risk", "mitigation_plan", "impact", "created_at")
    search_fields = ("risk__title", "mitigation_plan__title", "impact")
    list_filter = ("risk", "mitigation_plan")
