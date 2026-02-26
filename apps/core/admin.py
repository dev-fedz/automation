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


@admin.register(models.Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "created_at", "updated_at")
    search_fields = ("name",)
    ordering = ("name",)


@admin.register(models.TestScenario)
class TestScenarioAdmin(admin.ModelAdmin):
    list_display = ("title", "project", "created_at")
    search_fields = ("title", "description", "project__name")
    list_filter = ("project",)


@admin.register(models.TestCase)
class TestCaseAdmin(admin.ModelAdmin):
    list_display = ("testcase_id", "scenario", "created_at")
    search_fields = ("testcase_id", "description", "scenario__title")
    list_filter = ("scenario__project", "scenario")


# Register remaining core models for admin visibility
@admin.register(models.ApiCollectionDirectory)
class ApiCollectionDirectoryAdmin(admin.ModelAdmin):
    list_display = ("collection", "name", "parent", "order", "created_at")
    search_fields = ("name", "description", "collection__name")
    list_filter = ("collection",)
    ordering = ("collection", "parent", "order")


@admin.register(models.ApiRunResultReport)
class ApiRunResultReportAdmin(admin.ModelAdmin):
    list_display = ("id", "run", "request", "status", "testcase")
    list_filter = ("status", "run__collection")
    search_fields = ("run__collection__name", "request__name", "testcase__testcase_id")


@admin.register(models.AutomationReport)
class AutomationReportAdmin(admin.ModelAdmin):
    list_display = ("report_id", "triggered_by", "total_passed", "total_failed", "started", "finished")
    search_fields = ("report_id", "triggered_by__username")


@admin.register(models.TestModules)
class TestModulesAdmin(admin.ModelAdmin):
    list_display = ("title", "project", "created_at")
    search_fields = ("title", "description", "project__name")
    list_filter = ("project",)


@admin.register(models.TestScenarioAttachment)
class TestScenarioAttachmentAdmin(admin.ModelAdmin):
    list_display = ("original_name", "scenario", "uploaded_by", "size", "created_at")
    search_fields = ("original_name", "scenario__title")


@admin.register(models.ScenarioComment)
class ScenarioCommentAdmin(admin.ModelAdmin):
    list_display = ("id", "scenario", "user", "created_at")
    search_fields = ("content", "user__username", "scenario__title")


@admin.register(models.ScenarioCommentAttachment)
class ScenarioCommentAttachmentAdmin(admin.ModelAdmin):
    list_display = ("original_name", "comment", "uploaded_by", "size", "created_at")
    search_fields = ("original_name", "comment__content")


@admin.register(models.CommentLike)
class CommentLikeAdmin(admin.ModelAdmin):
    list_display = ("comment", "user", "created_at")
    search_fields = ("user__username", "comment__content")


@admin.register(models.CommentReaction)
class CommentReactionAdmin(admin.ModelAdmin):
    list_display = ("comment", "user", "reaction", "created_at")
    search_fields = ("user__username", "reaction", "comment__content")


@admin.register(models.TestCaseComment)
class TestCaseCommentAdmin(admin.ModelAdmin):
    list_display = ("id", "test_case", "user", "created_at")
    search_fields = ("content", "user__username", "test_case__testcase_id")


@admin.register(models.TestCaseCommentLike)
class TestCaseCommentLikeAdmin(admin.ModelAdmin):
    list_display = ("comment", "user", "created_at")


@admin.register(models.TestCaseCommentReaction)
class TestCaseCommentReactionAdmin(admin.ModelAdmin):
    list_display = ("comment", "user", "reaction", "created_at")


@admin.register(models.TestCaseAttachment)
class TestCaseAttachmentAdmin(admin.ModelAdmin):
    list_display = ("original_name", "test_case", "uploaded_by", "size", "created_at")
    search_fields = ("original_name", "test_case__testcase_id")


@admin.register(models.LoadTestRun)
class LoadTestRunAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "status", "created_by", "started_at", "finished_at")
    list_filter = ("status",)


@admin.register(models.UITestingRecord)
class UITestingRecordAdmin(admin.ModelAdmin):
    list_display = ("name", "project", "module", "scenario", "is_active", "created_at")
    list_filter = ("project", "module", "is_active")
    search_fields = ("name", "description")
