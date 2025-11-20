from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0030_project_description"),
    ]

    operations = [
        migrations.CreateModel(
            name="ApiRunResultReport",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("order", models.PositiveIntegerField(default=0)),
                ("status", models.CharField(max_length=10, choices=[('passed', 'Passed'), ('failed', 'Failed'), ('error', 'Error')])),
                ("response_status", models.IntegerField(blank=True, null=True)),
                ("response_headers", models.JSONField(default=dict, blank=True)),
                ("response_body", models.TextField(blank=True)),
                ("response_time_ms", models.FloatField(blank=True, null=True)),
                ("assertions_passed", models.JSONField(default=list, blank=True)),
                ("assertions_failed", models.JSONField(default=list, blank=True)),
                ("error", models.TextField(blank=True)),
                ("testcase_id", models.CharField(max_length=50, blank=True)),
                (
                    "run",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="result_reports",
                        to="core.apirun",
                    ),
                ),
                (
                    "request",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="result_reports",
                        to="core.apirequest",
                        null=True,
                    ),
                ),
            ],
            options={
                "ordering": ["run", "order", "id"],
            },
        ),
    ]
